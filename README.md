# Morpheus

Morpheus is an experimental neurotechnology and computational neuroscience research platform focused on a long-range question:

> How much information about subjective human experience can be measured, identified, decoded, and reconstructed from persistent neural representations?

The project begins with dreams because they combine internally generated imagery, sound, body sensation, emotion, narrative, memory, and sometimes deliberate agency.

## Architecture

- **Web console:** Next.js + React + TypeScript, deployable on Vercel.
- **Signal gateway:** Python + FastAPI, running locally or on lab hardware.
- **Streaming standard:** Lab Streaming Layer (LSL).
- **Device abstraction:** BrainFlow where supported.
- **Research stack:** Python, MNE, NumPy, SciPy, scikit-learn, PyTorch.
- **Browser transport:** REST/WebSocket from the local gateway.
- **Data:** local-first; sensitive raw dream and neural data stays out of Git.

Vercel hosts the interface, not the acquisition hardware. Native LSL/BrainFlow acquisition runs locally and exposes sanitized live metadata/data to the UI.

## Milestones

- M0 — Dataset Zero
- M1 — Recurrence
- M2 — Reinstatement
- M3 — Neural decoding baseline
- M4 — Live physiology
- M5 — Individual neural atlas

## Scientific rule

Morpheus can begin with radical hypotheses, but every claim must earn its evidence.

## Safety

Initial work is observational, computational, and non-invasive. Invasive procedures, stimulation, pharmaceuticals, or clinical experimentation require qualified medical/institutional oversight.

## License

Apache-2.0 for code. Dataset licenses are tracked per source.
