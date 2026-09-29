# Morpheus Workstation v0.7 — Native Research Engine

Morpheus v0.7 changes the execution boundary. The hosted application remains a visualization, orchestration and public-data surface. Authoritative acquisition and recording are local concerns.

## Runtime topology

```text
DAQ / LSL / BrainFlow / native source
                 |
                 v
       local acquisition plane
       +----------------------+
       | Rust morpheus-core   |
       | bounded ring         |
       | MRPH v1 packets      |
       | FFT / notch / RMS    |
       +----------------------+
                 |
       local recording / hash
                 |
                 +--> optional UDP handoff to local adapter
                 |        |
                 |        +--> WebRTC reliable ordered sample DataChannel
                 |        +--> binary WebSocket fallback
                 |
                 v
          browser ingest Worker
                 |
                 v
      disposable display SharedArrayBuffer
          |                    |
          v                    v
 Offscreen signal renderer   low-rate UI snapshots
```

The native and browser rings have different authority. The native/local acquisition plane owns the research stream and recording. The browser ring is a bounded display copy and can be discarded without changing the recorded session.

## MRPH v1 binary frame batches

The browser no longer requires one JSON object per neural sample.

MRPH v1 header:

| Field | Type |
| --- | --- |
| magic | 4 bytes, `MRPH` |
| version | little-endian u16 |
| flags | little-endian u16 |
| sequence | little-endian u32 |
| stream id | little-endian u32 |
| sample rate | little-endian f32 |
| channel count | little-endian u16 |
| frame count | little-endian u16 |

Each frame contains one f64 timestamp followed by `channel_count` f32 values.

Sequence gaps are counted by the browser ingestion Worker and are scoped to a stream ID, so changing sources does not appear as loss. Malformed packets and missing sequence numbers are both shown as acquisition data gaps. Packet rate and frame/sample rate are reported independently. The sample DataChannel is reliable and ordered; partially reliable delivery is not suitable for evidence acquisition because it silently discards packets under congestion.

## Native Rust core

`native/morpheus-core` now contains:

- timestamped bounded multi-channel ring
- MRPH v1 encoder/decoder
- deterministic stream identifiers
- RMS
- min/max envelope reduction
- radix-2 FFT power spectrum
- frequency-band integration
- biquad notch filter
- unit tests for protocol, ring and DSP behavior

`native/morpheus-gateway` is an executable local runtime that exercises the native ring, MRPH packetization, UDP relay and direct local binary recording. Its initial source generator is an engineering source; vendor-specific hardware drivers remain separate acquisition adapters and must not be represented as complete until implemented and verified against actual hardware.

## Local native-to-browser bridge

The Python service remains useful as an ecosystem adapter for LSL, BrainFlow and PyNWB. When `MORPHEUS_NATIVE_UDP_BIND` is configured locally, it can relay already-packetized MRPH datagrams to the browser without decoding and rebuilding channel arrays.

The hosted Vercel service does not open this local UDP bridge.

## Recording

The native gateway can write MRPH packet streams directly to local storage and finalizes a SHA-256 manifest when the process stops cleanly. The existing Python local recorder and JSONL-to-NWB conversion remain available during the migration.

A digest establishes integrity. It does not by itself establish authorship or regulatory-grade chain of custody.

## Public neuroscience graph

The Public Data surface keeps unique metadata entities in IndexedDB and adds newly observed repository results to a persistent 3D graph. Graph nodes represent repository, dataset/entity and modality relationships. If upstream APIs return no datasets, Morpheus shows only the repository topology rather than inventing research records.

## Neuro Spatial

The 3D workspace uses actual active NIfTI data for all primary modes:

- volume ray cast
- voxel field derived from the active volume
- region topology derived from active volume intensities/labels

Public NeuroVault NIfTI presets and local NIfTI files are first-class sources. A derived region topology is a visualization of regions/proximity, not a claim of anatomical structural connectivity.

## M0–M5 software execution

- M0: immutable local dream corpus and SHA-256 sealing
- M1: recurrence scoring plus deterministic non-match null comparisons
- M2: pre-registered delay conditions, trial registry, synchronized markers, blinded score and delay-response summary
- M3: leave-one-session-out nearest-centroid baseline plus permutation null
- M4: native MRPH core, batched ingestion, LSL/BrainFlow adapters, local recording and timing provenance
- M5: subject/session feature snapshots, state centroids and cross-state similarity

These are executable software paths. They do **not** mean the scientific hypotheses have been validated or that high-fidelity dream reconstruction has been achieved.
