# Morpheus Engineering Standards

## System boundaries

Morpheus is split into three execution planes.

1. **Workstation UI** — Next.js/React. Visualization, orchestration, local record capture, light analysis.
2. **Acquisition gateway** — native/local FastAPI process. Hardware I/O, LSL clock domain, event markers, authoritative recording.
3. **Compute workers** — browser workers for light DSP today; local/GPU services for validated high-cost models and volume operations.

Latency-critical hardware work must not depend on a public serverless round trip.

## Reliability

- Bounded buffers only for real-time UI streams.
- One upstream public-data failure must not take down other adapters.
- API calls have explicit timeouts and normalized error responses.
- UI modules are isolated behind an application error boundary.
- Simulation data is explicitly marked synthetic.
- Raw personal dream/neural data is local by default.
- Public API adapters are read-only.
- Unsupported scientific claims are never represented as validated outputs.

## Security

The application applies response headers for MIME sniffing protection, clickjacking protection, referrer minimization, feature restrictions, same-origin opener isolation, and a restrictive CSP compatible with WebGL/workers.

Never commit:
- participant identifiers
- raw private dream reports
- raw identifiable neural recordings
- credentials
- API secrets
- health records

## Performance

- High-rate packet ingestion writes into preallocated Float32 ring buffers.
- React receives downsampled/bounded viewport snapshots rather than every packet.
- Web Workers isolate DSP from the main UI thread.
- 3D volume rendering uses GPU 3D textures and fragment-shader ray marching.
- UHD mode increases pixel density deliberately rather than forcing maximum DPR at all times.

## Scientific software rules

Every M0–M5 program defines:
- objective
- null hypothesis
- inputs
- outputs
- promotion gates
- versioned methods

A research milestone may be engineered before it is scientifically validated. The UI must keep those states distinct.
