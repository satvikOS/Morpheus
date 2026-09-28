# Morpheus

Morpheus is an experimental neurotechnology and computational neuroscience research workstation focused on one long-range question:

> How much information about subjective human experience can be measured, identified, decoded, and reconstructed from persistent neural representations?

Dreams are the first research domain because they combine internally generated imagery, sound, body sensation, emotion, narrative, memory, and sometimes deliberate agency.

## Current workstation

The repository now contains a functioning research OS rather than a static concept UI.

### Acquisition
- FastAPI signal gateway
- Lab Streaming Layer discovery and sample relay
- BrainFlow hardware descriptor support when running locally
- synchronized marker endpoint and LSL marker outlet
- 8-channel synthetic reference stream when no hardware source is available
- bounded multi-channel browser ring buffers
- up to 16 simultaneously visualized channels
- local-only session recording when `MORPHEUS_LOCAL_RECORDING_DIR` is configured

### Dataset Zero / M0–M1
- immutable raw dream reports
- browser-side SHA-256 sealing
- local-first storage and JSON export
- separated annotations, tags, modalities, lucidity and confidence
- deterministic local recurrence-candidate analysis

### Experiment control / M2–M4
- timestamped marker console
- local recording control
- reinstatement protocol surface
- M0–M5 dependency registry
- explicit null hypotheses and promotion gates

### Public neuroscience data
Unified adapters currently query:
- DANDI
- OpenNeuro
- NeuroVault
- Allen Brain Atlas
- Zenodo

A failing upstream adapter is isolated from the rest of the data fabric.

### Model / compute workers
- browser Web Worker DSP
- time-domain metrics
- reference spectral-band estimation
- staged boundaries for local neural inference and GPU workers

### Simulations
Synthetic engineering fixtures include:
- awake EEG-like multichannel signals
- REM-like signals
- N3 slow-wave signals
- P300 ERP
- BOLD HRF
- connectivity signals
- connectome graph phantom
- 3D structural brain volume phantom

Simulated data is explicitly marked synthetic and must not be interpreted as physiological ground truth.

### 3D Neuro Space
- Three.js / React Three Fiber
- GPU 3D texture volume rendering
- GLSL ray marching
- NIfTI-1 / NIfTI-2 import
- axial, coronal and sagittal multiplanar views
- transfer-function controls
- point-cloud atlas rendering
- connectome rendering
- scene workspace
- interactive and UHD display modes

The active production renderer is WebGL2-compatible. WebGPU capability may be detected by the browser, but Morpheus does not claim WebGPU is active until a dedicated WebGPU backend is implemented and validated.

## Execution architecture

```text
                         MORPHEUS WORKSTATION
                              Next.js
                                 |
       -----------------------------------------------------
       |                  |                 |               |
 Dataset Zero        Public data        Simulation      Neuro 3D
 local/private         adapters           engine        GPU viewport
       |                                      |
       |                              Browser DSP worker
       |                                      |
       -------------------- control -------------------------
                                 |
                          Local Signal Gateway
                              FastAPI
                                 |
                   ---------------------------
                   |            |            |
                  LSL       BrainFlow      Markers
                   |            |            |
                 EEG / physiological / future sensors
```

Vercel hosts the orchestration, visualization and public-data application. Real hardware acquisition and authoritative raw recording belong on the local workstation or lab compute node.

## Research programs

- **M0 — Dataset Zero:** immutable prospective dream ground truth
- **M1 — Recurrence & Continuity:** objective similarity and sequence structure
- **M2 — Dream Reinstatement:** controlled interruption and continuation experiments
- **M3 — Neural Decoding Baselines:** reproduce public-data baselines before subject-specific claims
- **M4 — Live Neurophysiology:** synchronized non-invasive acquisition and event markers
- **M5 — Individual Neural Atlas:** subject-specific representational alignment across perception, imagery, memory and sleep

Engineering readiness is not scientific validation. Morpheus deliberately keeps those states separate.

## Local gateway

```bash
cd services/signal-gateway
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export MORPHEUS_LOCAL_RECORDING_DIR="$HOME/morpheus-sessions"
uvicorn app.main:app --reload --port 8787
```

Windows PowerShell:

```powershell
cd services/signal-gateway
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

$env:MORPHEUS_LOCAL_RECORDING_DIR="$HOME\morpheus-sessions"
uvicorn app.main:app --reload --port 8787
```

Point the workstation acquisition endpoint to the local gateway.

## Data policy

Do not commit:
- personal dream reports
- participant identifiers
- raw identifiable neural recordings
- health records
- credentials or API keys

The public repository contains code, schemas, synthetic fixtures, experiment definitions and public-data integrations. Sensitive research ground truth remains local/private.

## Scientific rule

Morpheus can begin with radical hypotheses, but every claim must earn its evidence. Experiments should be designed so the motivating hypothesis can fail.

## Safety

Initial work is observational, computational and non-invasive. Invasive procedures, stimulation, pharmaceuticals, or clinical experimentation require qualified medical/institutional oversight.

## License

Apache-2.0 for code. Dataset licenses and data-use restrictions remain source-specific.


## v0.4 workstation architecture

Morpheus v0.4 moves the live display path away from React state:

```text
LSL / BrainFlow
      |
 local gateway
      |
      +---- WebRTC DataChannel (preferred local path)
      |          |
      |          v
      |   SharedArrayBuffer ring
      |          |
      |          v
      |      WebGL2 scope
      |
      +---- Worker-owned WebSocket fallback
                 |
                 v
          SharedArrayBuffer ring
```

The browser UI reads bounded signal windows from shared memory. React receives low-rate snapshots for diagnostics/model-worker summaries rather than every biosignal packet.

The default screen is now a multi-pane operational workspace so acquisition, marker control, spatial visualization, and critical system state remain simultaneously visible. A persistent evidence boundary clearly differentiates live acquisition, simulation, and idle states.

Dataset Zero now uses IndexedDB for the local text corpus and a press-and-hold sealing interlock. Continuous biosignal data remains outside browser storage.

The local gateway can be containerized, can expose an optional WebRTC data channel when the local dependency profile is installed, and includes an offline JSONL-to-NWB conversion path.
