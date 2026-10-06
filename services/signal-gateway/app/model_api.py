"""Explicitly enabled local science service; never initialize this in Vercel."""
import asyncio
import json
import os
import threading
import sqlite3
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from app.model_runtime import LocalModelRuntime, MODELS, VERSION, canonical

router = APIRouter(prefix="/models", tags=["local-model-runs"])
_runtime = None
_lock = threading.Lock()


def enabled() -> bool:
    return os.environ.get("VERCEL") != "1" and bool(os.environ.get("MORPHEUS_MODEL_RUN_DIR"))


def check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return  # Direct local CLI access; bind the gateway to loopback.
    try:
        parsed = urlsplit(origin)
    except ValueError as error:
        raise HTTPException(403, "Origin is not authorized for private local model data.") from error
    allowed = {"https://morpheus-three.vercel.app", *filter(None, os.environ.get("MORPHEUS_ALLOWED_ORIGINS", "").split(","))}
    if origin not in allowed and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
        raise HTTPException(403, "Origin is not authorized for private local model data.")


def engine(request: Request) -> LocalModelRuntime:
    global _runtime
    check_origin(request)
    if not enabled():
        raise HTTPException(409, "Set MORPHEUS_MODEL_RUN_DIR on a local gateway to enable persistent jobs.")
    with _lock:
        if _runtime is None:
            try:
                _runtime = LocalModelRuntime(Path(os.environ["MORPHEUS_MODEL_RUN_DIR"]).expanduser().resolve())
            except (OSError, sqlite3.Error, ValueError) as error:
                raise HTTPException(503, "Local model storage is unavailable. Check the configured directory and disk space.") from error
    return _runtime


@router.get("/registry")
def registry():
    from app.unified_model import dependency_available, VERSION as SHARED_VERSION
    shared = {"id": "morpheus-shared-encoder", "version": SHARED_VERSION, "name": "Morpheus shared representation",
              "implementation": "local-pytorch-feature-token-transformer", "available": dependency_available(),
              "weights": "trained locally on admitted data; JSON checkpoint", "input": "versioned pre-task-event features with classification and measured-outcome targets",
              "limitations": "Bounded multi-task pilot; multimodal dream reconstruction is not implemented."}
    return {"version": VERSION, "enabled": enabled(), "execution": "local-science-adapter", "models": [*MODELS, shared],
            "limits": {"jobs": 4, "workers": 1, "rows": 2048, "features": 64, "permutations": 200}}


@router.get("/runs")
def runs(request: Request):
    try:
        return {"runs": engine(request).list()}
    except (OSError, sqlite3.Error, ValueError) as error:
        raise HTTPException(503, "Local model records are unavailable. Check storage and restore a verified backup if needed.") from error


@router.get("/runs/{identifier}")
def get_run(identifier: str, request: Request):
    try:
        run = engine(request).get(identifier)
    except (OSError, sqlite3.Error, ValueError) as error:
        raise HTTPException(503, "Local model record is unavailable. Check storage and restore a verified backup if needed.") from error
    if run is None:
        raise HTTPException(404, "Run not found.")
    return run


@router.post("/runs", status_code=202)
async def submit(request: Request):
    runtime = engine(request)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 4 * 1024 * 1024:
            raise HTTPException(413, "Model input exceeds the four MiB limit.")
    try:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError("Model request must be an object.")
        # Validation/hashing runs off the acquisition event loop.
        run = await asyncio.to_thread(runtime.submit, payload)
        return {k: v for k, v in run.items() if k != "config"}
    except (ValueError, TypeError) as error:
        raise HTTPException(422, str(error)) from error
    except OverflowError as error:
        raise HTTPException(429, str(error)) from error
    except (OSError, sqlite3.Error) as error:
        raise HTTPException(503, "Local model storage is unavailable. Check disk space and retry.") from error


def artifact(identifier: str, request: Request, checkpoint: bool) -> Response:
    try:
        run = engine(request).get(identifier)
    except (OSError, sqlite3.Error, ValueError) as error:
        raise HTTPException(503, "Local model artifact is unavailable. Check storage and retry.") from error
    if run is None:
        raise HTTPException(404, "Run not found.")
    payload = run
    if checkpoint:
        payload = (run.get("result") or {}).get("checkpoint")
        if run["status"] != "COMPLETED" or not isinstance(payload, dict):
            raise HTTPException(409, "A completed shared-model checkpoint is required.")
    # Preserve Python's sealed numeric serialization. A browser parse/stringify
    # round trip changes 0.0 to 0 and invalidates the advertised canonical hash.
    return Response(content=canonical(payload), media_type="application/json",
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/runs/{identifier}/export")
def export_run(identifier: str, request: Request):
    return artifact(identifier, request, False)


@router.get("/runs/{identifier}/checkpoint")
def export_checkpoint(identifier: str, request: Request):
    return artifact(identifier, request, True)


@router.post("/runs/{identifier}/cancel")
def cancel(identifier: str, request: Request):
    runtime = engine(request)
    try:
        existing = runtime.get(identifier)
    except (OSError, sqlite3.Error, ValueError) as error:
        raise HTTPException(503, "Local model record is unavailable. Check storage and retry.") from error
    if existing is None:
        raise HTTPException(404, "Run not found.")
    return {"id": identifier, "cancellation_requested": runtime.cancel(identifier)}


def close_runtime():
    global _runtime
    with _lock:
        if _runtime is not None:
            _runtime.close()
            _runtime = None
