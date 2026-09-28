# Morpheus Signal Gateway

The Vercel app is the workstation UI. Native neural acquisition stays local.

## Initial integrations

- **Lab Streaming Layer (LSL)** for synchronized neural, physiological, behavioral, and marker streams.
- **BrainFlow** as the initial hardware abstraction for supported EEG / biosignal boards.

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8787
```

Windows PowerShell:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8787
```

Endpoints:
- `GET /health`
- `GET /streams`

Planned next:
- WebSocket sample relay
- marker injection
- XDF recording control
- BrainFlow board discovery
- MNE-compatible export
- latency/dropout metrics
