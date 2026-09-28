# Morpheus Workstation Architecture

## Principle

The browser is the workstation surface. Real-time acquisition and heavy neural processing remain native and local.

## Layers

### 1. Web Console
- Next.js / React / TypeScript
- Vercel-hosted
- monitoring, experiment control, annotation, visualization
- Three.js / React Three Fiber for the 3D visual lab

### 2. Signal Gateway
- FastAPI
- WebSocket relay
- LSL discovery + sample ingestion
- BrainFlow device abstraction
- local-first recording and analysis

### 3. Scientific Processing
- MNE
- NumPy / SciPy
- pyxdf
- later: PyTorch and model services

## Low-latency strategy

- Keep sensor I/O native.
- Keep LSL on the local machine / LAN.
- Relay only the samples required for the UI.
- Use bounded buffers to avoid runaway latency.
- Prefer WebSocket over repeated HTTP for waveform transport.
- Record source data locally instead of routing raw recordings through Vercel.
- Use Vercel for UI and stateless web APIs only.

## 3D Visual Lab

The visual lab is a GPU-accelerated browser workspace intended for:
- spatial dream-scene reconstruction
- point-cloud / mesh visualization
- volumetric and latent-space inspection
- future MRI/fMRI surface overlays
- temporal scene playback
