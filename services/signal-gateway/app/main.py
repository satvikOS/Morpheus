from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

try:
    from pylsl import StreamInlet, resolve_streams
except Exception:
    StreamInlet = None
    resolve_streams = None

app = FastAPI(title="Morpheus Signal Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost(:\d+)?|.*\.vercel\.app)",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

def discover_lsl() -> list[dict[str, Any]]:
    if resolve_streams is None:
        return []
    try:
        streams = resolve_streams(wait_time=0.25)
    except Exception:
        return []
    return [{
        "name": s.name(),
        "type": s.type(),
        "channel_count": s.channel_count(),
        "nominal_srate": s.nominal_srate(),
        "source_id": s.source_id() or f"{s.name()}:{s.uid()}",
    } for s in streams]

@app.get("/health")
def health() -> dict[str, Any]:
    streams = discover_lsl()
    return {
        "status": "online",
        "streams": len(streams),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/streams")
def streams() -> dict[str, Any]:
    return {"streams": discover_lsl()}

@app.get("/metrics")
def metrics() -> dict[str, Any]:
    streams = discover_lsl()
    return {
        "stream_count": len(streams),
        "channel_count": sum(int(s["channel_count"] or 0) for s in streams),
        "server_time": time.time(),
    }

@app.websocket("/ws/samples")
async def websocket_samples(ws: WebSocket) -> None:
    await ws.accept()

    if resolve_streams is None or StreamInlet is None:
        while True:
            try:
                t = time.time()
                sample = [0.32 * __import__("math").sin(t * 4.0), 0.12 * __import__("math").sin(t * 10.0)]
                await ws.send_text(json.dumps({"stream": "synthetic", "ts": t, "channels": sample}))
                await asyncio.sleep(0.02)
            except WebSocketDisconnect:
                return

    inlet = None
    while inlet is None:
        try:
            found = resolve_streams(wait_time=0.35)
            if found:
                inlet = StreamInlet(found[0], max_buflen=2, recover=True)
                break
            await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            return
        except Exception:
            await asyncio.sleep(0.75)

    while True:
        try:
            sample, ts = await asyncio.to_thread(inlet.pull_sample, 0.2)
            if sample is None:
                await asyncio.sleep(0.005)
                continue
            await ws.send_text(json.dumps({
                "stream": inlet.info().name(),
                "ts": float(ts),
                "channels": [float(x) for x in sample],
            }))
        except WebSocketDisconnect:
            return
        except Exception:
            await asyncio.sleep(0.05)

@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "Morpheus Signal Gateway",
        "purpose": "Low-latency local LSL / BrainFlow acquisition bridge",
    }
