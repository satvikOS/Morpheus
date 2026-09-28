from __future__ import annotations

import asyncio
import json
import math
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from pylsl import (
        StreamInfo as LSLStreamInfo,
        StreamInlet,
        StreamOutlet,
        resolve_streams,
    )
except Exception:
    LSLStreamInfo = None
    StreamInlet = None
    StreamOutlet = None
    resolve_streams = None

try:
    from brainflow.board_shim import BoardShim
except Exception:
    BoardShim = None

app = FastAPI(title="Morpheus Signal Gateway", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost(:\d+)?|.*\.vercel\.app)",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

MARKERS: deque[dict[str, Any]] = deque(maxlen=200)
_marker_outlet: Any = None


class LocalRecorder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._file: Any = None
        self.session_id: str | None = None
        self.path: str | None = None
        self.samples = 0
        self.markers = 0

    @property
    def enabled(self) -> bool:
        return bool(os.environ.get("MORPHEUS_LOCAL_RECORDING_DIR"))

    @property
    def active(self) -> bool:
        return self._file is not None

    def start(self, session_id: str | None = None) -> dict[str, Any]:
        if not self.enabled:
            return {
                "started": False,
                "reason": "Local recording is disabled. Set MORPHEUS_LOCAL_RECORDING_DIR on the local gateway.",
            }

        with self._lock:
            if self._file is not None:
                return {
                    "started": True,
                    "session_id": self.session_id,
                    "path": self.path,
                    "already_active": True,
                }

            root = Path(os.environ["MORPHEUS_LOCAL_RECORDING_DIR"]).expanduser().resolve()
            root.mkdir(parents=True, exist_ok=True)
            sid = session_id or datetime.now(timezone.utc).strftime("session-%Y%m%dT%H%M%SZ")
            safe_sid = "".join(char for char in sid if char.isalnum() or char in "-_")[:96] or "session"
            path = root / f"{safe_sid}.jsonl"
            self._file = path.open("a", encoding="utf-8", buffering=1)
            self.session_id = safe_sid
            self.path = str(path)
            self.samples = 0
            self.markers = 0
            self._write({
                "kind": "session_start",
                "session_id": safe_sid,
                "timestamp": time.time(),
                "iso_time": datetime.now(timezone.utc).isoformat(),
                "format": "morpheus-jsonl-v1",
            })
            return {"started": True, "session_id": safe_sid, "path": str(path)}

    def _write(self, payload: dict[str, Any]) -> None:
        if self._file is None:
            return
        self._file.write(json.dumps(payload, separators=(",", ":")) + "\n")

    def write_sample(self, stream: str, timestamp: float, channels: list[float], simulated: bool) -> None:
        with self._lock:
            if self._file is None:
                return
            self._write({
                "kind": "sample",
                "stream": stream,
                "timestamp": timestamp,
                "channels": channels,
                "simulated": simulated,
            })
            self.samples += 1

    def write_marker(self, marker: dict[str, Any]) -> None:
        with self._lock:
            if self._file is None:
                return
            self._write({"kind": "marker", **marker})
            self.markers += 1

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._file is None:
                return {"stopped": False, "reason": "No local recording is active."}

            self._write({
                "kind": "session_stop",
                "timestamp": time.time(),
                "samples": self.samples,
                "markers": self.markers,
            })
            self._file.close()
            result = {
                "stopped": True,
                "session_id": self.session_id,
                "path": self.path,
                "samples": self.samples,
                "markers": self.markers,
            }
            self._file = None
            self.session_id = None
            self.path = None
            return result

    def state(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "active": self.active,
            "session_id": self.session_id,
            "path": self.path,
            "samples": self.samples,
            "markers": self.markers,
        }


RECORDER = LocalRecorder()


class MarkerRequest(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    timestamp: float | None = None
    payload: dict[str, Any] | None = None


class RecordingStartRequest(BaseModel):
    session_id: str | None = Field(default=None, max_length=96)


def discover_lsl() -> list[dict[str, Any]]:
    if resolve_streams is None:
        return []
    try:
        discovered = resolve_streams(wait_time=0.18)
    except Exception:
        return []

    return [
        {
            "name": stream.name(),
            "type": stream.type(),
            "channel_count": stream.channel_count(),
            "nominal_srate": stream.nominal_srate(),
            "source_id": stream.source_id() or f"{stream.name()}:{stream.uid()}",
        }
        for stream in discovered
    ]


def get_marker_outlet() -> Any:
    global _marker_outlet
    if _marker_outlet is not None:
        return _marker_outlet
    if LSLStreamInfo is None or StreamOutlet is None:
        return None

    try:
        info = LSLStreamInfo(
            name="MorpheusMarkers",
            type="Markers",
            channel_count=1,
            nominal_srate=0,
            channel_format="string",
            source_id="morpheus-markers-v1",
        )
        _marker_outlet = StreamOutlet(info)
    except Exception:
        _marker_outlet = None
    return _marker_outlet


@app.get("/health")
@app.get("/api/signal-gateway/health")
def health() -> dict[str, Any]:
    discovered = discover_lsl()
    return {
        "status": "online",
        "streams": len(discovered),
        "mode": "lsl" if resolve_streams is not None else "simulation-capable",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/streams")
@app.get("/api/signal-gateway/streams")
def streams() -> dict[str, Any]:
    return {"streams": discover_lsl()}


@app.get("/metrics")
@app.get("/api/signal-gateway/metrics")
def metrics() -> dict[str, Any]:
    discovered = discover_lsl()
    return {
        "stream_count": len(discovered),
        "channel_count": sum(int(stream["channel_count"] or 0) for stream in discovered),
        "marker_count": len(MARKERS),
        "server_time": time.time(),
        "lsl_available": resolve_streams is not None,
    }


@app.get("/capabilities")
@app.get("/api/signal-gateway/capabilities")
def capabilities() -> dict[str, Any]:
    return {
        "lsl": resolve_streams is not None,
        "brainflow": BoardShim is not None,
        "websocket_samples": True,
        "markers": True,
        "synthetic_fallback": True,
        "recording": RECORDER.enabled,
        "recording_active": RECORDER.active,
        "raw_recording_policy": "local-only",
    }


@app.get("/brainflow/boards/{board_id}")
@app.get("/api/signal-gateway/brainflow/boards/{board_id}")
def brainflow_board(board_id: int) -> dict[str, Any]:
    if BoardShim is None:
        return {
            "available": False,
            "board_id": board_id,
            "reason": "BrainFlow is not installed in this runtime. Use the local Morpheus gateway.",
        }

    try:
        descriptor = BoardShim.get_board_descr(board_id)
        return {
            "available": True,
            "board_id": board_id,
            "descriptor": descriptor,
        }
    except Exception as exc:
        return {
            "available": False,
            "board_id": board_id,
            "reason": str(exc),
        }


@app.get("/recording")
@app.get("/api/signal-gateway/recording")
def recording_state() -> dict[str, Any]:
    return RECORDER.state()


@app.post("/recording/start")
@app.post("/api/signal-gateway/recording/start")
def recording_start(request: RecordingStartRequest) -> dict[str, Any]:
    return RECORDER.start(request.session_id)


@app.post("/recording/stop")
@app.post("/api/signal-gateway/recording/stop")
def recording_stop() -> dict[str, Any]:
    return RECORDER.stop()


@app.post("/markers")
@app.post("/api/signal-gateway/markers")
def markers(marker: MarkerRequest) -> dict[str, Any]:
    ts = float(marker.timestamp or time.time())
    record = {
        "label": marker.label,
        "timestamp": ts,
        "payload": marker.payload or {},
    }
    MARKERS.appendleft(record)
    RECORDER.write_marker(record)

    outlet = get_marker_outlet()
    emitted_to_lsl = False
    if outlet is not None:
        try:
            outlet.push_sample([marker.label], timestamp=ts)
            emitted_to_lsl = True
        except Exception:
            emitted_to_lsl = False

    return {
        "accepted": True,
        "marker": record,
        "lsl_emitted": emitted_to_lsl,
    }


@app.get("/markers")
@app.get("/api/signal-gateway/markers")
def recent_markers() -> dict[str, Any]:
    return {"markers": list(MARKERS)}


async def synthetic_stream(ws: WebSocket) -> None:
    phase = 0.0
    while True:
        try:
            now = time.time()
            phase += 0.02
            sample = [
                0.31 * math.sin(phase * 6.2) + 0.07 * math.sin(phase * 14.5),
                0.18 * math.sin(phase * 8.1 + 0.7),
                0.11 * math.sin(phase * 3.3 + 1.2),
                0.08 * math.sin(phase * 18.0 + 0.3),
                0.16 * math.sin(phase * 5.1 + 1.8) + 0.04 * math.sin(phase * 21.0),
                0.13 * math.sin(phase * 7.4 + 2.2),
                0.09 * math.sin(phase * 11.6 + 0.9),
                0.07 * math.sin(phase * 3.8 + 2.9),
            ]
            RECORDER.write_sample("Morpheus Synthetic Reference", now, sample, True)
            await ws.send_text(
                json.dumps(
                    {
                        "stream": "Morpheus Synthetic Reference",
                        "ts": now,
                        "channels": sample,
                        "simulated": True,
                    }
                )
            )
            await asyncio.sleep(0.02)
        except WebSocketDisconnect:
            return


@app.websocket("/ws/samples")
@app.websocket("/api/signal-gateway/ws/samples")
async def websocket_samples(ws: WebSocket, source_id: str | None = None) -> None:
    await ws.accept()

    if resolve_streams is None or StreamInlet is None:
        await synthetic_stream(ws)
        return

    try:
        discovered = resolve_streams(wait_time=0.65)
    except Exception:
        discovered = []

    if not discovered:
        await synthetic_stream(ws)
        return

    selected = discovered[0]
    if source_id:
        selected = next(
            (
                stream
                for stream in discovered
                if stream.source_id() == source_id
                or stream.uid() == source_id
                or stream.name() == source_id
            ),
            discovered[0],
        )

    try:
        inlet = StreamInlet(selected, max_buflen=2, recover=True)
    except Exception:
        await synthetic_stream(ws)
        return

    stream_name = selected.name()

    while True:
        try:
            sample, timestamp = await asyncio.to_thread(inlet.pull_sample, 0.2)
            if sample is None:
                await asyncio.sleep(0.004)
                continue

            channel_values = [float(value) for value in sample]
            RECORDER.write_sample(stream_name, float(timestamp), channel_values, False)
            await ws.send_text(
                json.dumps(
                    {
                        "stream": stream_name,
                        "ts": float(timestamp),
                        "channels": channel_values,
                        "simulated": False,
                    }
                )
            )
        except WebSocketDisconnect:
            return
        except Exception:
            await asyncio.sleep(0.03)


@app.get("/")
@app.get("/api/signal-gateway")
def root() -> dict[str, str]:
    return {
        "service": "Morpheus Signal Gateway",
        "version": "0.3.0",
        "purpose": "Low-latency LSL acquisition, synchronization, and workstation relay",
    }
