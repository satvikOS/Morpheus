from __future__ import annotations

import asyncio
import json
import math
import time
from collections import deque
from datetime import datetime, timezone
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


class MarkerRequest(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    timestamp: float | None = None
    payload: dict[str, Any] | None = None


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
        "recording": False,
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
async def websocket_samples(ws: WebSocket) -> None:
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

    try:
        inlet = StreamInlet(discovered[0], max_buflen=2, recover=True)
    except Exception:
        await synthetic_stream(ws)
        return

    while True:
        try:
            sample, timestamp = await asyncio.to_thread(inlet.pull_sample, 0.2)
            if sample is None:
                await asyncio.sleep(0.004)
                continue

            await ws.send_text(
                json.dumps(
                    {
                        "stream": inlet.info().name(),
                        "ts": float(timestamp),
                        "channels": [float(value) for value in sample],
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
