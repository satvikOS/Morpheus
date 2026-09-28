from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from pynwb import NWBHDF5IO, NWBFile, TimeSeries
from pynwb.epoch import TimeIntervals


def load_session(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    markers: list[dict[str, Any]] = []
    meta: dict[str, Any] = {}

    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on line {line_number}: {exc}") from exc

            kind = record.get("kind")
            if kind == "sample":
                samples.append(record)
            elif kind == "marker":
                markers.append(record)
            elif kind == "session_start":
                meta.update(record)

    if not samples:
        raise ValueError("Session contains no sample records.")

    return samples, markers, meta


def build_nwb(
    input_path: Path,
    output_path: Path,
    session_description: str,
) -> None:
    samples, markers, meta = load_session(input_path)

    session_start = parse_start(meta)
    identifier = str(meta.get("session_id") or input_path.stem)
    nwb = NWBFile(
        session_description=session_description,
        identifier=identifier,
        session_start_time=session_start,
    )

    max_channels = max(len(record.get("channels") or []) for record in samples)
    data = np.full((len(samples), max_channels), np.nan, dtype=np.float32)
    timestamps = np.empty(len(samples), dtype=np.float64)
    simulated = np.zeros(len(samples), dtype=np.uint8)

    first_timestamp = float(samples[0]["timestamp"])
    for row, record in enumerate(samples):
        values = [float(value) for value in record.get("channels") or []]
        if values:
            data[row, : len(values)] = values
        timestamps[row] = float(record["timestamp"]) - first_timestamp
        simulated[row] = 1 if record.get("simulated") else 0

    signal_series = TimeSeries(
        name="MorpheusSignal",
        data=data,
        unit="a.u.",
        timestamps=timestamps,
        description=(
            "Morpheus packet samples exported from the local gateway. "
            "Channel unit is intentionally 'a.u.' unless acquisition metadata "
            "establishes calibrated physical units."
        ),
    )
    nwb.add_acquisition(signal_series)

    simulation_series = TimeSeries(
        name="MorpheusSimulationFlag",
        data=simulated,
        unit="bool",
        timestamps=timestamps,
        description="1 indicates a synthetic engineering sample; 0 indicates a relayed acquisition sample.",
    )
    nwb.add_acquisition(simulation_series)

    intervals = TimeIntervals(
        name="MorpheusMarkers",
        description="Experiment markers emitted through the Morpheus gateway.",
    )
    intervals.add_column(name="label", description="Marker label")
    intervals.add_column(name="clock_domain", description="Authoritative clock domain")
    intervals.add_column(name="sequence", description="Gateway marker sequence")
    intervals.add_column(name="source_timestamp", description="Original gateway/LSL timestamp")

    for marker in markers:
        source_ts = float(marker.get("timestamp", first_timestamp))
        relative = source_ts - first_timestamp
        intervals.add_interval(
            start_time=relative,
            stop_time=relative,
            label=str(marker.get("label", "")),
            clock_domain=str(marker.get("clock_domain", "unknown")),
            sequence=int(marker.get("sequence", 0)),
            source_timestamp=source_ts,
        )

    if markers:
        nwb.add_time_intervals(intervals)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with NWBHDF5IO(str(output_path), "w") as io:
        io.write(nwb)


def parse_start(meta: dict[str, Any]) -> datetime:
    value = meta.get("iso_time")
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert a Morpheus local JSONL session to NWB.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--description",
        default="Morpheus non-invasive neurophysiology research session",
    )
    args = parser.parse_args()
    build_nwb(args.input, args.output, args.description)
    print(args.output)


if __name__ == "__main__":
    main()
