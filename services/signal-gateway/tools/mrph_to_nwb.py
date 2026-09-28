from __future__ import annotations

import argparse
import hashlib
import json
import struct
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from pynwb import NWBHDF5IO, NWBFile, TimeSeries

SESSION_MAGIC = b"MRPHSESSION\x01"
PACKET_HEADER = struct.Struct("<4sHHIIfHH")
PACKET_MAGIC = b"MRPH"
PACKET_VERSION = 1


def read_exact(handle, count: int) -> bytes:
    data = handle.read(count)
    if len(data) != count:
        raise EOFError(f"Expected {count} bytes, received {len(data)}")
    return data


def load_native_session(path: Path):
    timestamps: list[float] = []
    samples: list[list[float]] = []
    packet_meta: list[dict[str, int | float]] = []

    with path.open("rb") as handle:
        magic = read_exact(handle, len(SESSION_MAGIC))
        if magic != SESSION_MAGIC:
            raise ValueError("Not a Morpheus native session.")

        started_unix_ns = struct.unpack("<Q", read_exact(handle, 8))[0]

        while True:
            size_bytes = handle.read(4)
            if not size_bytes:
                break
            if len(size_bytes) != 4:
                raise ValueError("Truncated packet-length field.")

            packet_size = struct.unpack("<I", size_bytes)[0]
            if packet_size < PACKET_HEADER.size:
                raise ValueError("Invalid MRPH packet size.")

            packet = read_exact(handle, packet_size)
            (
                packet_magic,
                version,
                flags,
                sequence,
                stream_id,
                sample_rate,
                channel_count,
                frame_count,
            ) = PACKET_HEADER.unpack_from(packet, 0)

            if packet_magic != PACKET_MAGIC or version != PACKET_VERSION:
                raise ValueError(
                    f"Unsupported packet at sequence {sequence}: "
                    f"magic={packet_magic!r}, version={version}"
                )

            stride = 8 + int(channel_count) * 4
            expected = PACKET_HEADER.size + stride * int(frame_count)
            if len(packet) < expected:
                raise ValueError(
                    f"Truncated MRPH packet {sequence}: {len(packet)} < {expected}"
                )

            offset = PACKET_HEADER.size
            for _ in range(int(frame_count)):
                timestamp = struct.unpack_from("<d", packet, offset)[0]
                offset += 8
                frame = list(
                    struct.unpack_from(
                        f"<{int(channel_count)}f",
                        packet,
                        offset,
                    )
                )
                offset += int(channel_count) * 4
                timestamps.append(float(timestamp))
                samples.append(frame)

            packet_meta.append(
                {
                    "sequence": int(sequence),
                    "stream_id": int(stream_id),
                    "sample_rate": float(sample_rate),
                    "channels": int(channel_count),
                    "frames": int(frame_count),
                    "flags": int(flags),
                }
            )

    if not samples:
        raise ValueError("Native session contains no frames.")

    channels = max(len(frame) for frame in samples)
    matrix = np.full((len(samples), channels), np.nan, dtype=np.float32)
    for row, frame in enumerate(samples):
        matrix[row, : len(frame)] = frame

    return (
        started_unix_ns,
        np.asarray(timestamps, dtype=np.float64),
        matrix,
        packet_meta,
    )


def build_nwb(
    input_path: Path,
    output_path: Path,
    description: str,
) -> None:
    started_ns, timestamps, data, packet_meta = load_native_session(input_path)
    start_time = datetime.fromtimestamp(
        started_ns / 1_000_000_000,
        tz=timezone.utc,
    )

    first_timestamp = float(timestamps[0])
    relative_timestamps = timestamps - first_timestamp
    digest = hashlib.sha256(input_path.read_bytes()).hexdigest()

    nwb = NWBFile(
        session_description=description,
        identifier=f"{input_path.stem}-{digest[:12]}",
        session_start_time=start_time,
        notes=(
            "Converted from a Morpheus MRPH native packet recording. "
            f"Source SHA-256: {digest}"
        ),
    )

    unique_rates = sorted(
        {
            float(item["sample_rate"])
            for item in packet_meta
            if float(item["sample_rate"]) > 0
        }
    )

    series = TimeSeries(
        name="MorpheusNativeSignal",
        data=data,
        unit="a.u.",
        timestamps=relative_timestamps,
        description=(
            "Native Morpheus frames decoded from MRPH v1 packets. "
            "Signal units remain a.u. unless device calibration metadata "
            "establishes physical units."
        ),
    )
    nwb.add_acquisition(series)

    metadata = {
        "source_file": input_path.name,
        "source_sha256": digest,
        "packet_count": len(packet_meta),
        "frame_count": int(data.shape[0]),
        "channel_count": int(data.shape[1]),
        "sample_rates_hz": unique_rates,
        "protocol": "MRPH v1",
    }

    nwb.add_scratch(
        json.dumps(metadata, sort_keys=True),
        name="MorpheusNativeMetadata",
        description="Morpheus native recording provenance.",
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with NWBHDF5IO(str(output_path), "w") as io:
        io.write(nwb)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert a Morpheus native MRPH session to NWB."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--description",
        default="Morpheus native non-invasive neurophysiology research session",
    )
    args = parser.parse_args()

    build_nwb(args.input, args.output, args.description)
    print(args.output)


if __name__ == "__main__":
    main()
