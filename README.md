# Morpheus

Morpheus is an experimental neurotechnology and computational-neuroscience workstation studying how much information about subjective experience can be measured, identified, decoded and reconstructed from neural representations.

Dreams are the first research domain because they combine internally generated imagery, sound, body sensation, emotion, narrative, memory and sometimes deliberate agency.

> Engineering execution is not scientific validation. Morpheus can begin with radical hypotheses, but every scientific claim must earn its evidence.

## v0.8 applied research

The shared Morpheus model is now a trainable feature-token Transformer with classification and measured-response heads optimized together. Its research contribution graph pins the architecture, losses, implemented controls and runtime bindings in every local run/checkpoint. The public pilot uses seven animals and 1,776 trials; it establishes a working training pipeline, with near-chance classification and near-baseline regression. Aligned report/image/audio/temporal encoders and thousands of implemented contributions remain work to earn through compatible data and evaluation. See [shared model](docs/UNIFIED_MODEL.md).

**Methods & Runs** executes three reviewed local adapters: session-held-out nearest centroid, regularized diagonal LDA, and independent-unit perturbation/control contrasts. Each run retains inputs, a versioned method recipe, source/design declarations, evaluation, events and SHA-256 manifests in local SQLite. Enable jobs with `MORPHEUS_MODEL_RUN_DIR` on a loopback gateway. Private jobs remain disabled in the cloud.

Crossref cursor paging supports large literature admission queues. A discovered paper cannot execute until its input contract, controls, implementation and tests are reviewed. Source context and reproducing a cited experiment are distinguished. See [method recipes](lib/method-recipes.ts), [research records](docs/RESEARCH_RECORDS.md), [C++ verification](docs/NATIVE_CPP.md), and [decisions](docs/DECISIONS.md).

## Execution architecture

```text
                    MORPHEUS WORKSTATION

  hardware / LSL / BrainFlow / native source
                       |
                       v
              LOCAL ACQUISITION PLANE
       +-----------------------------------+
       | C++20 core / retained Rust oracle |
       | bounded timestamped ring         |
       | MRPH v1 binary frame batches     |
       | FFT / band power / notch / RMS   |
       +-----------------------------------+
                       |
              local recording + SHA-256
                       |
            optional local UDP bridge
                       |
              FastAPI ecosystem adapter
              LSL / BrainFlow / PyNWB
                       |
          +------------+-------------+
          |                          |
     WebRTC samples          binary WebSocket
     unordered/no retry          fallback
          |                          |
          +------------+-------------+
                       |
                browser Worker
                       |
             display SharedArrayBuffer
              /                 \
   Offscreen signal scope   low-rate UI state
```

The local/native acquisition plane is authoritative. The browser buffer is a bounded, disposable display copy.

The hosted Vercel application remains useful for orchestration, public data, simulations, visualization and research workflow development. It is not treated as an authoritative acquisition clock or raw-session storage service.

## Native engine

### `native/morpheus-core-cpp`

The CMake C++20 core implements MRPH v1 parity, bounded rings, reusable DSP/QC, hashed recording and a synthetic UDP gateway. `scripts/native-test.sh` executes actual Python/C++/Rust protocol and DSP comparisons plus recording/failure integration. Rust remains because a general C++ speed advantage has not been demonstrated. Hardware drivers and a one-hour soak remain unverified.

### `native/morpheus-core` (retained reference)

The Rust core provides:

- timestamped bounded multi-channel ring buffers
- MRPH v1 binary packet encoding/decoding
- deterministic stream IDs and packet sequence accounting
- RMS
- min/max envelope reduction
- radix-2 FFT power spectrum
- frequency-band integration
- biquad notch filtering
- unit tests

### `native/morpheus-gateway`

The executable native gateway exercises:

- native ring buffers
- configurable channel/sample rates
- bounded binary batching
- UDP relay into the local adapter
- direct local MRPH recording
- SHA-256 finalized-session manifests

Its built-in source is an engineering generator for exercising the native path. Vendor-specific direct hardware drivers are separate acquisition adapters and are not claimed complete.

Example:

```bash
export MORPHEUS_SAMPLE_RATE=1024
export MORPHEUS_CHANNELS=64
export MORPHEUS_BATCH_FRAMES=16
export MORPHEUS_UDP_TARGET=127.0.0.1:8790
export MORPHEUS_RECORD_DIR="$HOME/morpheus-native-sessions"

cargo run --release --manifest-path native/morpheus-gateway/Cargo.toml
```

## Local ecosystem gateway

The Python gateway remains an adapter for neuroscience tooling:

- Lab Streaming Layer discovery/chunk ingestion
- BrainFlow board metadata/adapters
- marker LSL outlet
- WebRTC and binary WebSocket relay
- optional native-MRPH UDP relay
- local engineering recorder
- offline PyNWB conversion

Example:

```bash
cd services/signal-gateway
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-local.txt

export MORPHEUS_LOCAL_RECORDING_DIR="$HOME/morpheus-sessions"
export MORPHEUS_MODEL_RUN_DIR="$HOME/morpheus-model-runs"
export MORPHEUS_NATIVE_UDP_BIND=127.0.0.1:8790
uvicorn app.main:app --host 127.0.0.1 --port 8787
```

Then point the browser acquisition endpoint to `http://127.0.0.1:8787`.

## MRPH v1

MRPH v1 transports batches rather than one JSON object per neural sample.

A packet contains:

- protocol magic/version
- flags
- sequence number
- stream ID
- nominal sample rate
- channel count
- frame count
- f64 timestamp + interleaved f32 channels for every frame

Morpheus therefore reports **frames/second** and **packets/second** separately. Sequence gaps are counted explicitly.

## M0–M5 execution programs

### M0 — Dataset Zero
- prospective local dream capture with immutable subject/session/episode context
- IndexedDB persistence
- SHA-256 sealing
- separated annotations and raw report
- exportable local corpus

### M1 — Recurrence & Continuity
- deterministic pairwise similarity
- lexical/tag/modality components
- unique episode-aware same-subject background comparison
- descriptive ranks, TF-IDF/lexical controls and comparison-family size; no inferential p-value

### M2 — Dream Reinstatement
- fixed interruption delay conditions
- intention/control condition
- local trial registry
- synchronized marker integration
- immutable protocol/rubric hashes and assessor packets without condition labels
- manual assignment and unblinded scoring provenance
- delay-response summary

### M3 — Neural Decoding Baselines
- local feature snapshots
- leave-one-session-out baseline
- nearest-centroid and regularized diagonal-LDA jobs
- balanced accuracy/confusion matrix
- permutation null

### M4 — Live Neurophysiology
- tested C++20 signal/protocol core with retained Rust parity reference
- binary batched browser ingest
- LSL / BrainFlow adapter plane
- bounded display memory
- local recording
- sequence/drop/timing provenance
- NWB conversion tooling

### M5 — Individual Neural Atlas
- subject/session registry
- labeled state snapshots
- local persistence
- state centroids
- cross-state similarity
- M3 evaluation handoff
- immutable feature provenance and session-level longitudinal summaries

These software pathways are executable. They do not establish that high-fidelity dream reconstruction, recovery of inaccessible historic dreams, or the underlying persistence hypothesis has been scientifically demonstrated.

## Public neuroscience data

Live anonymous adapters:

- DANDI
- OpenNeuro
- NeuroVault
- Allen Brain Map
- Zenodo
- DREAM: open experience-report records with recall states preserved

The source matrix additionally represents credentialed, registration-gated or controlled sources without presenting them as anonymous APIs.

The 3D public-data graph persists discovered metadata records in IndexedDB and relates repositories, datasets and modalities. It does not fabricate nodes when upstream APIs return no data.

## Neuro Spatial

The neuro-spatial workspace includes:

- public NeuroVault NIfTI study presets
- local NIfTI-1/NIfTI-2 import
- WebGL2 3D texture ray casting
- linked voxel I/J/K slices, crosshairs, raw intensities and header world coordinates
- transfer-function controls
- active-volume-derived voxel fields
- active-volume-derived intensity-bin geometry with proximity edges
- UHD display mode

Intensity-bin geometry is not measured anatomical connectivity. Slice previews use voxel space; oblique anatomy and physical aspect are not registered. NIfTI decompression and scalar counts are bounded. Only the first 4D frame is displayed.

## Data policy

Do not commit:

- personal dream reports
- participant identifiers
- raw identifiable neural recordings
- health records
- credentials or API keys

Sensitive ground truth and authoritative recordings remain local/private.

## Safety

Initial Morpheus research is observational, computational and non-invasive. Invasive procedures, stimulation, pharmaceuticals and clinical experimentation require appropriate qualified and institutional oversight.

## License

No repository LICENSE file is present. Dataset licences and data-use restrictions remain source-specific; source links grant no rights to external code, weights or recordings.
