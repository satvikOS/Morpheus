from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from pylsl import resolve_streams
except Exception:
    resolve_streams = None

app=FastAPI(title="Morpheus Signal Gateway",version="0.0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost(:\d+)?|.*\.vercel\.app)",
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

def discover_lsl()->list[dict[str,Any]]:
    if resolve_streams is None:return []
    try: streams=resolve_streams(wait_time=0.35)
    except Exception:return []
    return [{
        "name":s.name(),
        "type":s.type(),
        "channel_count":s.channel_count(),
        "nominal_srate":s.nominal_srate(),
        "source_id":s.source_id() or f"{s.name()}:{s.uid()}",
    } for s in streams]

@app.get("/health")
def health()->dict[str,Any]:
    streams=discover_lsl()
    return {"status":"online","streams":len(streams),"timestamp":datetime.now(timezone.utc).isoformat()}

@app.get("/streams")
def streams()->dict[str,Any]:
    return {"streams":discover_lsl()}

@app.get("/")
def root()->dict[str,str]:
    return {"service":"Morpheus Signal Gateway","purpose":"Local LSL / BrainFlow acquisition bridge"}
