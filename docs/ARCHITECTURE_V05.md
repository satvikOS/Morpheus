# Morpheus Workstation v0.5 Architecture

This document separates active execution paths from planned work. It is intentionally written as an engineering verification note rather than a product claim.

## Active signal path

```text
LSL / device
    |
local FastAPI gateway
    |
    +-- WebRTC sample DataChannel (unordered / no retransmit)
    |       |
    |       v
    |   ingestion Worker
    |       |
    |       v
    |   SharedArrayBuffer ring
    |       |
    |       +--> OffscreenCanvas WebGL2 signal renderer
    |       |
    |       +--> low-rate React snapshots for diagnostics / model summaries
    |
    +-- Worker-owned WebSocket fallback
```

Raw sample JSON is parsed in the ingestion Worker, not in React. The renderer reads shared ring memory directly when cross-origin isolation is available.

The browser-side ring is currently implemented with SharedArrayBuffer + Atomics in a Worker. The repository also contains a Rust native ring-buffer core for the local execution plane. Morpheus does **not** claim that the browser ring is Wasm-backed yet.

## Signal rendering

The live scope uses:

- OffscreenCanvas
- dedicated rendering Worker
- WebGL2
- antialiasing disabled for the signal path
- min/max envelope reduction when source density exceeds horizontal pixel density
- raw and average-reference views
- polarity controls
- keyboard controls
- optional physical display calibration

Physical `mm/s` is only displayed after the operator provides a measured CSS-pixels-per-millimetre calibration. Physical amplitude scaling is only enabled when the acquisition metadata declares a microvolt channel unit. Otherwise the renderer stays explicitly relative.

This is a research display implementation. It is not represented as an IFCN-certified clinical EEG display.

## Event timing

Morpheus v0.5 does not use network arrival time as the only possible event timestamp.

The client periodically estimates the mapping:

```text
browser performance clock -> gateway clock domain
```

using repeated round trips and keeps the lowest-latency samples. Each marker carries:

- browser monotonic event time
- estimated gateway-clock event time
- measured synchronization uncertainty
- client clock domain

A reliable ordered WebRTC control DataChannel is preferred for markers. HTTP is the fallback.

The gateway validates the mapped timestamp against arrival time and measured uncertainty. When acceptable, it writes the mapped event time into the gateway / LSL clock domain and separately records arrival time. When synchronization quality is not acceptable, it records gateway arrival time and labels the timestamp method accordingly.

Browser interaction timing is not a substitute for a hardware trigger when the protocol requires tighter precision than the measured uncertainty.

## Data provenance

Local recording produces:

- append-only JSONL engineering capture
- synchronized marker records
- SHA-256 digest of the finalized session file
- sidecar session manifest containing digest, byte count, sample count and marker count
- offline NWB conversion utility

Dataset Zero text records remain browser-local in IndexedDB and seal the exact raw report text with SHA-256.

## Operational UI

The evidence bar is persistent and exposes:

- evidence mode
- transport
- packet / decode errors
- clock synchronization uncertainty
- recording state
- shared-memory availability

Critical and warning states use dedicated red / amber alarm surfaces. Those colors are intentionally reserved for operational faults and simulation/timing warnings.

Operational views for workspace, acquisition, experiment control and full neuro-spatial inspection remain mounted while switching between them. Heavy rendering paths receive an `active` state so hidden views can suspend rendering without destroying their local state.

## Current spatial limitation

The NIfTI / 3D volume engine already performs real WebGL2 3D-texture ray marching and multiplanar slicing, but the React Three Fiber spatial viewport is still a main-thread renderer in v0.5.

Moving the full interactive 3D scene to OffscreenCanvas/WebGPU is a separate engine migration and should not be claimed complete until it is actually active and benchmarked.

## Compliance language

IEC 62366-1, ANSI/AAMI HE75, IEC 60601-1-8 and IFCN guidance are treated as design inputs where relevant. The repository must not describe Morpheus as certified, compliant, clinical, diagnostic, or medical-device software without the corresponding controlled usability/risk files, verification evidence and regulatory process.
