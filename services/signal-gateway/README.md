# Morpheus Signal Gateway

The signal gateway is the native/local acquisition boundary for Morpheus. The hosted Vercel application is the workstation UI; real hardware I/O and authoritative raw recording stay close to the machine connected to the sensors.

## Current integrations

- **Lab Streaming Layer (LSL)** for synchronized neural, physiological, behavioral and marker streams.
- **BrainFlow** for supported EEG / biosignal board metadata and future device adapters.
- **FastAPI + WebSocket** for bounded workstation relay.
- **Local JSONL recording** for engineering sessions when explicitly enabled.
- **MorpheusMarkers LSL outlet** for synchronized experiment markers.

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export MORPHEUS_LOCAL_RECORDING_DIR="$HOME/morpheus-sessions"
uvicorn app.main:app --reload --port 8787
```

Windows PowerShell:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:MORPHEUS_LOCAL_RECORDING_DIR="$HOME\morpheus-sessions"
uvicorn app.main:app --reload --port 8787
```

## Endpoints

- `GET /health`
- `GET /streams`
- `GET /metrics`
- `GET /capabilities`
- `GET /brainflow/boards/{board_id}`
- `GET /markers`
- `POST /markers`
- `GET /recording`
- `POST /recording/start`
- `POST /recording/stop`
- `WS /ws/samples`

The Vercel Services deployment also exposes matching `/api/signal-gateway/*` routes.

## Recording

Raw recording is disabled unless `MORPHEUS_LOCAL_RECORDING_DIR` is set. This prevents the hosted service from being treated as storage for personal neural data.

The initial engineering format is newline-delimited JSON with:
- session start/stop metadata
- sample timestamp
- stream name
- channel values
- simulation flag
- synchronized markers

For research-grade acquisition, the roadmap remains XDF/NWB session recording with complete device, clock, preprocessing and protocol provenance.

## Next native layer

- XDF / NWB writer service
- multiple simultaneous LSL inlets
- per-stream buffering and backpressure metrics
- artifact / dropout / impedance quality monitors
- device lifecycle control through BrainFlow
- Rust/C++ hot path where profiling demonstrates Python overhead
- local GPU inference workers


## WebRTC data channel

The local dependency profile includes `aiortc`. When installed, the gateway exposes:

- `POST /webrtc/offer`

The browser first negotiates an unordered, zero-retransmit `morpheus-samples` DataChannel. If negotiation fails or the local profile is unavailable, Morpheus automatically falls back to the Worker-owned WebSocket transport. WebRTC is therefore an optimization for the local workstation path, not a requirement for the hosted Vercel service.

```bash
pip install -r requirements-local.txt
```

## Docker

```bash
docker compose up --build
```

The standard Compose profile exposes the gateway on port 8787 and stores sessions under `.morpheus-recordings`. LSL uses local multicast discovery, so laboratories that require host networking can use:

```bash
docker compose -f docker-compose.yml -f docker-compose.host.yml up --build
```

Native execution remains preferable when the host/container networking layer interferes with LSL multicast discovery.

## NWB conversion

The local dependency profile includes PyNWB. Engineering JSONL recordings can be converted into an NWB file without uploading the session:

```bash
python tools/jsonl_to_nwb.py \
  /path/to/session.jsonl \
  /path/to/session.nwb
```

The converter preserves sample timestamps, simulation flags, and gateway marker metadata. It intentionally uses `a.u.` for signal units unless calibrated source metadata establishes a physical unit; Morpheus does not invent EEG calibration metadata.
