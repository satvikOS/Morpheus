from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import struct
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from app.protocol import (
    MRPH_FLAG_SIMULATED,
    MRPH_HEADER,
    MRPH_MAGIC,
    MRPH_VERSION,
    encode_sample_batch,
)

try:
    from pylsl import (
        StreamInfo as LSLStreamInfo,
        StreamInlet,
        StreamOutlet,
        local_clock,
        resolve_streams,
    )
except Exception:
    LSLStreamInfo = None
    StreamInlet = None
    StreamOutlet = None
    local_clock = None
    resolve_streams = None

try:
    from brainflow.board_shim import BoardShim
except Exception:
    BoardShim = None

try:
    from aiortc import RTCPeerConnection, RTCSessionDescription
except Exception:
    RTCPeerConnection = None
    RTCSessionDescription = None

app = FastAPI(title="Morpheus Signal Gateway", version="0.7.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost(:\d+)?|.*\.vercel\.app)",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

MARKERS: deque[dict[str, Any]] = deque(maxlen=200)
_marker_outlet: Any = None
WEBRTC_PEERS: set[Any] = set()
WEBRTC_TASKS: set[asyncio.Task[Any]] = set()
MARKER_SEQUENCE = 0
NATIVE_SUBSCRIBERS: set[asyncio.Queue[bytes]] = set()
NATIVE_LAST_META: dict[str, Any] = {}
NATIVE_TRANSPORT: Any = None
GATEWAY_INSTANCE_ID = str(uuid.uuid4())
HOSTED_RUNTIME = os.environ.get("VERCEL") == "1"
CLOCK_STABLE_FOR_MARKERS = not HOSTED_RUNTIME


def _record_batch(
    stream: str,
    samples: list[list[float]],
    timestamps: list[float],
    simulated: bool,
) -> None:
    for sample, timestamp in zip(samples, timestamps, strict=True):
        RECORDER.write_sample(stream, float(timestamp), sample, simulated)


class NativeUdpProtocol(asyncio.DatagramProtocol):
    def datagram_received(self, data: bytes, addr: Any) -> None:
        if len(data) < MRPH_HEADER.size:
            return
        try:
            magic, version, flags, sequence, stream_id, sample_rate, channels, frames = MRPH_HEADER.unpack_from(data, 0)
        except struct.error:
            return
        if magic != MRPH_MAGIC or version != MRPH_VERSION:
            return

        NATIVE_LAST_META.update(
            {
                "name": "Morpheus Native Gateway",
                "type": "Neurophysiology",
                "channel_count": int(channels),
                "nominal_srate": float(sample_rate),
                "channel_format": "float32",
                "source_id": "morpheus-native",
                "uid": f"morpheus-native-{stream_id:08x}",
                "hostname": str(addr[0]) if isinstance(addr, tuple) and addr else "local",
                "channel_labels": [f"CH{index + 1:03d}" for index in range(int(channels))],
                "channel_units": ["" for _ in range(int(channels))],
                "protocol": "mrph-v1",
                "sequence": int(sequence),
                "frames_per_packet": int(frames),
                "simulated": bool(flags & MRPH_FLAG_SIMULATED),
            }
        )

        stale: list[asyncio.Queue[bytes]] = []
        for queue in tuple(NATIVE_SUBSCRIBERS):
            try:
                queue.put_nowait(data)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                    queue.put_nowait(data)
                except Exception:
                    stale.append(queue)

        for queue in stale:
            NATIVE_SUBSCRIBERS.discard(queue)


async def _start_native_udp_bridge() -> None:
    global NATIVE_TRANSPORT
    bind = os.environ.get("MORPHEUS_NATIVE_UDP_BIND", "").strip()
    if not bind or HOSTED_RUNTIME:
        return

    host, sep, port_text = bind.rpartition(":")
    if not sep:
        host = "127.0.0.1"
        port_text = bind

    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        NativeUdpProtocol,
        local_addr=(host or "127.0.0.1", int(port_text)),
    )
    NATIVE_TRANSPORT = transport


@app.on_event("startup")
async def startup_native_bridge() -> None:
    try:
        await _start_native_udp_bridge()
    except Exception:
        # The browser/LSL gateway remains usable if the optional native bridge
        # cannot bind. Capability reporting makes this state explicit.
        pass


@app.on_event("shutdown")
async def shutdown_native_bridge() -> None:
    global NATIVE_TRANSPORT
    if NATIVE_TRANSPORT is not None:
        NATIVE_TRANSPORT.close()
        NATIVE_TRANSPORT = None


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

            stopped_at = time.time()
            self._write({
                "kind": "session_stop",
                "timestamp": stopped_at,
                "samples": self.samples,
                "markers": self.markers,
            })
            self._file.flush()
            self._file.close()

            session_path = Path(self.path or "")
            digest = _sha256_file(session_path)
            manifest_path = session_path.with_suffix(session_path.suffix + ".manifest.json")
            manifest = {
                "schema": "morpheus-session-manifest-v1",
                "session_id": self.session_id,
                "recording_path": str(session_path),
                "sha256": digest,
                "bytes": session_path.stat().st_size if session_path.exists() else 0,
                "samples": self.samples,
                "markers": self.markers,
                "stopped_at": stopped_at,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
            manifest_path.write_text(
                json.dumps(manifest, indent=2, sort_keys=True),
                encoding="utf-8",
            )

            result = {
                "stopped": True,
                "session_id": self.session_id,
                "path": str(session_path),
                "manifest_path": str(manifest_path),
                "sha256": digest,
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


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def gateway_clock() -> tuple[float, str]:
    if local_clock is not None:
        return float(local_clock()), "lsl_local_clock"
    return float(time.perf_counter()), "python_perf_counter"


RECORDER = LocalRecorder()


class MarkerRequest(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    payload: dict[str, Any] | None = None
    request_id: str | None = Field(default=None, max_length=128)
    client_monotonic: float | None = None
    client_clock_domain: str | None = Field(default=None, max_length=64)
    estimated_gateway_time: float | None = None
    sync_uncertainty_ms: float | None = Field(default=None, ge=0, le=10000)


class RecordingStartRequest(BaseModel):
    session_id: str | None = Field(default=None, max_length=96)


class WebRTCOffer(BaseModel):
    sdp: str = Field(min_length=1)
    type: str = Field(default="offer")
    source_id: str | None = None


def discover_lsl() -> list[dict[str, Any]]:
    if resolve_streams is None:
        return []
    try:
        discovered = resolve_streams(wait_time=0.18)
    except Exception:
        return []

    results: list[dict[str, Any]] = []
    for stream in discovered:
        labels: list[str] = []
        units: list[str] = []
        try:
            channel = stream.desc().child("channels").child("channel")
            for _ in range(int(stream.channel_count() or 0)):
                if channel.empty():
                    break
                labels.append(channel.child_value("label") or f"CH{len(labels) + 1:02d}")
                units.append(channel.child_value("unit") or "")
                channel = channel.next_sibling()
        except Exception:
            labels = []
            units = []

        results.append(
            {
                "name": stream.name(),
                "type": stream.type(),
                "channel_count": stream.channel_count(),
                "nominal_srate": stream.nominal_srate(),
                "channel_format": stream.channel_format(),
                "source_id": stream.source_id() or f"{stream.name()}:{stream.uid()}",
                "uid": stream.uid(),
                "hostname": stream.hostname(),
                "channel_labels": labels,
                "channel_units": units,
            }
        )

    return results


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
    discovered = discover_lsl()
    if NATIVE_TRANSPORT is not None:
        discovered.insert(
            0,
            NATIVE_LAST_META.copy()
            if NATIVE_LAST_META
            else {
                "name": "Morpheus Native Gateway",
                "type": "Neurophysiology",
                "channel_count": 0,
                "nominal_srate": 0,
                "channel_format": "float32",
                "source_id": "morpheus-native",
                "uid": "morpheus-native",
                "hostname": "local",
                "channel_labels": [],
                "channel_units": [],
                "protocol": "mrph-v1",
            },
        )
    return {"streams": discovered}


@app.get("/clock")
@app.get("/api/signal-gateway/clock")
def clock() -> dict[str, Any]:
    clock_time, clock_domain = gateway_clock()
    return {
        "clock_time": clock_time,
        "clock_domain": clock_domain,
        "wall_time": time.time(),
        "monotonic_ns": time.perf_counter_ns(),
        "instance_id": GATEWAY_INSTANCE_ID,
        "stable_for_markers": CLOCK_STABLE_FOR_MARKERS,
        "runtime": "hosted" if HOSTED_RUNTIME else "local",
    }


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
        "binary_batch_protocol": "mrph-v1",
        "native_udp_bridge": NATIVE_TRANSPORT is not None,
        "native_udp_bind": os.environ.get("MORPHEUS_NATIVE_UDP_BIND") if NATIVE_TRANSPORT is not None else None,
        "webrtc_data_channel": RTCPeerConnection is not None,
        "markers": True,
        "synthetic_fallback": True,
        "recording": RECORDER.enabled,
        "recording_active": RECORDER.active,
        "raw_recording_policy": "local-only",
        "gateway_instance_id": GATEWAY_INSTANCE_ID,
        "clock_stable_for_markers": CLOCK_STABLE_FOR_MARKERS,
        "runtime": "hosted" if HOSTED_RUNTIME else "local",
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


def record_marker(marker: MarkerRequest) -> dict[str, Any]:
    global MARKER_SEQUENCE
    MARKER_SEQUENCE += 1

    arrival_time, clock_domain = gateway_clock()
    estimated = (
        float(marker.estimated_gateway_time)
        if marker.estimated_gateway_time is not None
        else None
    )
    uncertainty = (
        float(marker.sync_uncertainty_ms)
        if marker.sync_uncertainty_ms is not None
        else None
    )

    use_mapped_event_time = (
        estimated is not None
        and uncertainty is not None
        and uncertainty <= 5.0
        and abs(estimated - arrival_time) <= 2.0
    )

    authoritative_timestamp = estimated if use_mapped_event_time else arrival_time
    timestamp_method = (
        "browser_event_mapped_to_gateway_clock"
        if use_mapped_event_time
        else "gateway_arrival"
    )

    record = {
        "sequence": MARKER_SEQUENCE,
        "request_id": marker.request_id,
        "received_monotonic_ns": time.perf_counter_ns(),
        "label": marker.label,
        "timestamp": authoritative_timestamp,
        "arrival_timestamp": arrival_time,
        "wall_timestamp": time.time(),
        "client_monotonic": marker.client_monotonic,
        "client_clock_domain": marker.client_clock_domain,
        "estimated_gateway_time": estimated,
        "sync_uncertainty_ms": uncertainty,
        "clock_domain": clock_domain,
        "timestamp_method": timestamp_method,
        "temporal_status": (
            "software_clock_mapped"
            if use_mapped_event_time
            else "gateway_arrival_only"
        ),
        "hardware_trigger_verified": False,
        "payload": marker.payload or {},
    }

    MARKERS.appendleft(record)
    RECORDER.write_marker(record)

    outlet = get_marker_outlet()
    emitted_to_lsl = False
    if outlet is not None:
        try:
            outlet.push_sample(
                [marker.label],
                timestamp=float(authoritative_timestamp),
            )
            emitted_to_lsl = True
        except Exception:
            emitted_to_lsl = False

    return {
        "accepted": True,
        "marker": record,
        "lsl_emitted": emitted_to_lsl,
    }


@app.post("/markers")
@app.post("/api/signal-gateway/markers")
def markers(marker: MarkerRequest) -> dict[str, Any]:
    return record_marker(marker)


@app.get("/markers")
@app.get("/api/signal-gateway/markers")
def recent_markers() -> dict[str, Any]:
    return {"markers": list(MARKERS)}


async def synthetic_stream(ws: WebSocket) -> None:
    phase = 0.0
    sample_rate = 256.0
    batch_size = 8
    sequence = 0

    while True:
        try:
            base, _ = gateway_clock()
            frames: list[list[float]] = []
            timestamps: list[float] = []

            for frame_index in range(batch_size):
                phase += 1.0 / sample_rate
                sample = [
                    0.31 * math.sin(2 * math.pi * 6.2 * phase) + 0.07 * math.sin(2 * math.pi * 14.5 * phase),
                    0.18 * math.sin(2 * math.pi * 8.1 * phase + 0.7),
                    0.11 * math.sin(2 * math.pi * 3.3 * phase + 1.2),
                    0.08 * math.sin(2 * math.pi * 18.0 * phase + 0.3),
                    0.16 * math.sin(2 * math.pi * 5.1 * phase + 1.8) + 0.04 * math.sin(2 * math.pi * 21.0 * phase),
                    0.13 * math.sin(2 * math.pi * 7.4 * phase + 2.2),
                    0.09 * math.sin(2 * math.pi * 11.6 * phase + 0.9),
                    0.07 * math.sin(2 * math.pi * 3.8 * phase + 2.9),
                ]
                frames.append(sample)
                timestamps.append(base + frame_index / sample_rate)

            stream_name = "Morpheus Synthetic Reference"
            _record_batch(stream_name, frames, timestamps, True)
            await ws.send_bytes(
                encode_sample_batch(
                    stream_name,
                    sample_rate,
                    frames,
                    timestamps,
                    True,
                    sequence,
                )
            )
            sequence = (sequence + 1) & 0xFFFFFFFF
            await asyncio.sleep(batch_size / sample_rate)
        except WebSocketDisconnect:
            return


async def _synthetic_datachannel(channel: Any) -> None:
    phase = 0.0
    sample_rate = 256.0
    batch_size = 8
    stream_name = "Morpheus Synthetic Reference"
    sequence = 0

    while getattr(channel, "readyState", "") == "open":
        base, _ = gateway_clock()
        frames: list[list[float]] = []
        timestamps: list[float] = []

        for frame_index in range(batch_size):
            phase += 1.0 / sample_rate
            frames.append(
                [
                    0.31 * math.sin(2 * math.pi * 6.2 * phase) + 0.07 * math.sin(2 * math.pi * 14.5 * phase),
                    0.18 * math.sin(2 * math.pi * 8.1 * phase + 0.7),
                    0.11 * math.sin(2 * math.pi * 3.3 * phase + 1.2),
                    0.08 * math.sin(2 * math.pi * 18.0 * phase + 0.3),
                    0.16 * math.sin(2 * math.pi * 5.1 * phase + 1.8) + 0.04 * math.sin(2 * math.pi * 21.0 * phase),
                    0.13 * math.sin(2 * math.pi * 7.4 * phase + 2.2),
                    0.09 * math.sin(2 * math.pi * 11.6 * phase + 0.9),
                    0.07 * math.sin(2 * math.pi * 3.8 * phase + 2.9),
                ]
            )
            timestamps.append(base + frame_index / sample_rate)

        _record_batch(stream_name, frames, timestamps, True)
        channel.send(
            encode_sample_batch(
                stream_name,
                sample_rate,
                frames,
                timestamps,
                True,
                sequence,
            )
        )
        sequence = (sequence + 1) & 0xFFFFFFFF
        await asyncio.sleep(batch_size / sample_rate)


async def _native_datachannel(channel: Any) -> None:
    queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=8)
    NATIVE_SUBSCRIBERS.add(queue)
    try:
        while getattr(channel, "readyState", "") == "open":
            packet = await queue.get()
            channel.send(packet)
    finally:
        NATIVE_SUBSCRIBERS.discard(queue)


async def _native_websocket(ws: WebSocket) -> None:
    queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=8)
    NATIVE_SUBSCRIBERS.add(queue)
    try:
        while True:
            packet = await queue.get()
            await ws.send_bytes(packet)
    except WebSocketDisconnect:
        return
    finally:
        NATIVE_SUBSCRIBERS.discard(queue)


async def _lsl_datachannel(channel: Any, source_id: str | None) -> None:
    if resolve_streams is None or StreamInlet is None:
        await _synthetic_datachannel(channel)
        return

    try:
        discovered = resolve_streams(wait_time=0.65)
    except Exception:
        discovered = []

    if not discovered:
        await _synthetic_datachannel(channel)
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
        await _synthetic_datachannel(channel)
        return

    stream_name = selected.name()
    sample_rate = float(selected.nominal_srate() or 0.0)
    batch_max = max(1, min(64, int(sample_rate / 30) if sample_rate > 0 else 16))
    sequence = 0

    while getattr(channel, "readyState", "") == "open":
        try:
            chunk, timestamps = await asyncio.to_thread(
                inlet.pull_chunk,
                0.2,
                batch_max,
            )
            if not chunk:
                await asyncio.sleep(0.001)
                continue

            frames = [[float(value) for value in frame] for frame in chunk]
            times = [float(value) for value in timestamps]
            _record_batch(stream_name, frames, times, False)
            channel.send(
                encode_sample_batch(
                    stream_name,
                    sample_rate,
                    frames,
                    times,
                    False,
                    sequence,
                )
            )
            sequence = (sequence + 1) & 0xFFFFFFFF
        except Exception:
            await asyncio.sleep(0.01)


async def _lsl_websocket(ws: WebSocket, selected: Any) -> None:
    try:
        inlet = StreamInlet(selected, max_buflen=2, recover=True)
    except Exception:
        await synthetic_stream(ws)
        return

    stream_name = selected.name()
    sample_rate = float(selected.nominal_srate() or 0.0)
    batch_max = max(1, min(64, int(sample_rate / 30) if sample_rate > 0 else 16))
    sequence = 0

    while True:
        try:
            chunk, timestamps = await asyncio.to_thread(
                inlet.pull_chunk,
                0.2,
                batch_max,
            )
            if not chunk:
                await asyncio.sleep(0.002)
                continue

            frames = [[float(value) for value in frame] for frame in chunk]
            times = [float(value) for value in timestamps]
            _record_batch(stream_name, frames, times, False)
            await ws.send_bytes(
                encode_sample_batch(
                    stream_name,
                    sample_rate,
                    frames,
                    times,
                    False,
                    sequence,
                )
            )
            sequence = (sequence + 1) & 0xFFFFFFFF
        except WebSocketDisconnect:
            return
        except Exception:
            await asyncio.sleep(0.01)


@app.post("/webrtc/offer")
@app.post("/api/signal-gateway/webrtc/offer")
async def webrtc_offer(offer: WebRTCOffer) -> Any:
    if RTCPeerConnection is None or RTCSessionDescription is None:
        return JSONResponse(
            status_code=501,
            content={
                "available": False,
                "reason": "WebRTC is a local-gateway capability. Install requirements-local.txt.",
            },
        )

    pc = RTCPeerConnection()
    WEBRTC_PEERS.add(pc)

    @pc.on("datachannel")
    def on_datachannel(channel: Any) -> None:
        if channel.label == "morpheus-samples":
            @channel.on("open")
            def on_sample_open() -> None:
                task = asyncio.create_task(
                    _native_datachannel(channel)
                    if offer.source_id == "morpheus-native" and NATIVE_TRANSPORT is not None
                    else _lsl_datachannel(channel, offer.source_id)
                )
                WEBRTC_TASKS.add(task)
                task.add_done_callback(WEBRTC_TASKS.discard)
            return

        if channel.label == "morpheus-control":
            @channel.on("message")
            def on_control_message(message: Any) -> None:
                try:
                    payload = json.loads(message if isinstance(message, str) else message.decode("utf-8"))
                    if payload.get("type") != "marker":
                        return

                    result = record_marker(
                        MarkerRequest(
                            label=str(payload.get("label") or ""),
                            payload=payload.get("payload") or {},
                            request_id=payload.get("request_id"),
                            client_monotonic=payload.get("client_monotonic"),
                            client_clock_domain=payload.get("client_clock_domain"),
                            estimated_gateway_time=payload.get("estimated_gateway_time"),
                            sync_uncertainty_ms=payload.get("sync_uncertainty_ms"),
                        )
                    )
                    channel.send(
                        json.dumps(
                            {
                                "type": "marker_ack",
                                "request_id": payload.get("request_id"),
                                **result,
                            }
                        )
                    )
                except Exception as exc:
                    channel.send(
                        json.dumps(
                            {
                                "type": "marker_ack",
                                "request_id": None,
                                "accepted": False,
                                "error": str(exc),
                            }
                        )
                    )

    @pc.on("connectionstatechange")
    async def on_connectionstatechange() -> None:
        if pc.connectionState in {"failed", "closed", "disconnected"}:
            WEBRTC_PEERS.discard(pc)
            if pc.connectionState != "closed":
                await pc.close()

    await pc.setRemoteDescription(
        RTCSessionDescription(sdp=offer.sdp, type=offer.type)
    )
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {
        "available": True,
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
    }


@app.websocket("/ws/samples")
@app.websocket("/api/signal-gateway/ws/samples")
async def websocket_samples(ws: WebSocket, source_id: str | None = None) -> None:
    await ws.accept()

    if source_id == "morpheus-native" and NATIVE_TRANSPORT is not None:
        await _native_websocket(ws)
        return

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

    await _lsl_websocket(ws, selected)


@app.get("/")
@app.get("/api/signal-gateway")
def root() -> dict[str, str]:
    return {
        "service": "Morpheus Signal Gateway",
        "version": "0.7.0",
        "purpose": "Low-latency LSL acquisition, synchronization, and workstation relay",
    }
