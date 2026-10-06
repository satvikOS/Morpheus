# Morpheus execution report — 6 October 2026

This revision delivers an executable research workstation, a measured C++ acquisition reference, local persistent model jobs and a small shared trainable representation. It does **not** complete the full autonomous mandate or establish permanent storage of every experience, dream recovery, clinical efficacy or a universal brain model. Those research hypotheses remain open. Engineering execution, observational results, synthetic tests and pending acceptance gates are separated below.

## M0–M5 delivery and limits

| Module | Implemented and reviewable | Remaining mandate work |
| --- | --- | --- |
| M0 — Dataset Zero | Exact raw-report text and initial ratings/context are sealed with SHA-256; attributed annotations append separately. Subject/session/episode/awakening IDs, capture timing and recall context, deterministic export and persistence failure handling are implemented. Legacy records retain unknown context. | Structured independent entity/event annotations, verified sleep-stage/marker linkage, integrated laboratory BIDS/NWB workflow and archival backup. Browser storage alone is not durable research archiving. |
| M1 — Recurrence | Lexical cosine, TF-IDF, tag/sensory similarity and subject/episode-aware background ranks exclude same-episode comparisons and deduplicate background pairs. Output identifies its descriptive rank and actual comparison count. | Learned semantic/multimodal representations, event/scene graphs, matched negative controls and validated inferential permutation/uncertainty procedures. Descriptive tail ranks are not permutation p-values. |
| M2 — Reinstatement | A hashed prospective protocol, bounded manual state machine, immutable follow-up/scoring history, explicit exclusions and a condition-hidden independent-assessor export are implemented. | Physiological sleep/awakening detection, hardware markers, verified randomization, actual blinded assessment and a preregistered prospective experiment. Current operator scores are unblinded; descriptive differences do not establish reinstatement. |
| M3 — Decoding | Nearest centroid and regularized diagonal LDA retain whole-session holdout/training-only scaling. Local SQLite jobs expose submit/list/poll/cancel/export. The shared Transformer jointly trains classification and measured-outcome heads with whole-independent-unit evaluation and JSON inference checkpoints. | Broad classical/temporal/fMRI baselines, calibrated uncertainty, matched single-task/architecture ablations, aligned language/image/audio encoders and validated dream-content reconstruction. Source-paper context does not imply reproduced published decoders. |
| M4 — Neurophysiology | C++20 bounded timestamp ring, MRPH v1 encode/decode, DSP/QC, synthetic paced UDP, independent raw recording and integrity manifests are implemented and measured. Python retains device/science/display adapters. | Real amplifier acquisition, measured device clocks/trigger uncertainty, concurrent snapshot handoff, deployment-CPU timing, sustained recording/network/device soak, reconnect/restart and recovery acceptance. Synthetic flags remain explicit. |
| M5 — Individual Atlas | Immutable finite named-feature snapshots with schema/source/QC provenance; separate compatible families; session means, repeated-window standard errors and adjacent-session feature similarity. | Learned longitudinal manifold, uncertainty-aware cross-session/anatomical alignment, physiological/report linkage and independently validated state representations. The current descriptive atlas is not a validated map of mind contents. |

Implementation details and contracts are in [research records](RESEARCH_RECORDS.md), [native execution](NATIVE_CPP.md), [shared representation](UNIFIED_MODEL.md) and [causal methods](CAUSAL_METHODS.md).

## Native measurements and migration evidence

Apple Silicon macOS, Apple Clang 21 and Rust 1.99.0 were used. Rust remains in the repository as an **executed** comparison oracle; it was not removed on the strength of a C++ rewrite.

| Check | Observed result | Practical boundary |
| --- | --- | --- |
| Release / ASan / UBSan core | 44,930 assertions pass, including 20,000 deterministic malformed-packet mutations, numeric bounds, sequence rollover, ring, DSP, SHA-256 and recording budgets. | No claim of complete fuzz coverage or hardware validation. |
| Cross-language parity | 83 valid wire cases are byte-identical across Python, C++ and actual Rust; Rust DSP comparisons and independent DFT/PSD checks pass. Seven original Rust tests pass. | C++ deliberately rejects malformed/trailing/nonfinite inputs accepted by portions of the older reference. |
| 256 channels, 4 kHz, one-frame UDP packets | Final local run: 5,000/5,000 received, zero UDP errors, 3,995.27 packets/s, raw-file and manifest hashes verified. | **410 pacing misses** under parallel build/training, versus one miss in an earlier repeat. Receipt and aggregate throughput do not prove deadline reliability. |
| Ten-second / one-hour 256-channel / 2 kHz ring soak | Ten-second: 20,000 frames, 1,250 packets, 4,000-frame capacity, 5,536 KiB RSS, zero misses. One-hour: **7,200,000 frames, 450,000 packets, 4,000 resident frames, RSS 4,880–5,536 KiB, 35 pacing misses**. | Synthetic ring/RSS only; receipt `/tmp/morpheus-native-soak-3600-20261006.json`. No recording/device/network soak, and deadline misses remain an open timing risk. |
| Failure paths | Disk budget, SIGTERM finalization, SIGKILL remaining partial and invalid configuration checks pass. | Partial-file recovery/redundancy and crash-between-rename-and-manifest recovery remain open. |
| Public C++ HTTP | Health/metadata and prefixed routes pass; 8 KiB/2-second bounds and 25 malformed-framing cases pass. | Read-only public metadata service; not an authenticated scientific job plane. |

Single-run C++/Rust operations per second were respectively: ring push **12.50M / 57.73M**, 256×16 encode **420,778 / 553,931**, decode **776,262 / 450,122**, 1,024-point Hann FFT **84,925 / 95,712**, RMS **1.19M / 2.11M**. Contracts differ in finite checking, allocation and length validation; these do not establish a blanket language advantage. SIMD and browser WASM are unbenchmarked. No ≤500 μs hardware or ≤5 ms software-marker timing guarantee has been demonstrated.

Final native/HTTP receipts are `tmp/final-native-tests.log` and `tmp/final-cloud-tests.log`; reproducible commands and sanitizer configuration are in [NATIVE_CPP.md](NATIVE_CPP.md).

## One shared model: what is actually integrated

The current prototype is a one-layer, four-head feature-token Transformer with pooled LayerNorm, a classification head and a scalar outcome head. One optimizer trains the common representation using classification CE plus `0.5 ×` measured-outcome MSE. Seven admitted software contributions bind to exact reviewed runtime components; **two published technique adaptations** are implemented: Transformer self-attention and shared multitask learning. The registry has three pending extensions. A 3,000-contribution paging test is a **fixture**, not 3,000 integrated research methods.

Graph/recipe/model version **1.1.0** adds explicit nullable outcomes. Classification retains all admitted labels; null ratings do not contribute outcome scaling, gradient or regression evaluation. Each of 6–16 independent units must contain at least two observations of every class and two measured outcomes. Missing ratings are never interpreted as a measured zero. Coverage/rating scope and inference extrapolation flags are retained. The current pinned contribution-manifest SHA-256 is `b13406bc292118c2a98c3312107eb3f2a6128a2bcb93667903ca5141ea3fa924`; previously sealed jobs retain their own manifest and hash.

Every dataset currently trains its own weights under the same architecture and fixed feature schema. Circuit and sleep inputs are **not** a jointly trained cross-species checkpoint. The requested massive model with thousands of genuinely implemented methods remains a future acceptance goal requiring compatible modality encoders, objective admission, licensed aligned data, measured ablations and sufficient compute.

Checkpoints are bounded plain JSON tensors with feature order/schema, preprocessing, source/license/assets, outcome scope/coverage, seed/settings, implementation and contribution hashes. Local inference requires an explicit canonical checkpoint SHA-256, rejects incompatible inputs and writes a new owner-only file without overwriting. Final inference weights refit all admitted rows after evaluation; they are not another held-out test or a resumable optimizer/RNG checkpoint.

## Actual public circuit pilot and controls

Pinned source: [DANDI 000009, version 0.220126.1903](https://doi.org/10.48324/dandi.000009/0.220126.1903), **CC BY 4.0**, with [primary provider metadata](https://api.dandiarchive.org/api/dandisets/000009/versions/0.220126.1903/info/). Sixteen candidate mouse files totaling **27,180,264 bytes** were verified; the fixed region/phase/QC plan admitted **7 animals, 7 sessions, 1,776 trials**. Extraction used PyNWB spike times and trial labels, not raw electrical-array downloads. Public local artifacts are retained under ignored `.local/dandi-optogenetics/run-4/`; they and learned weights are not uploaded through the public metadata service.

The equal-animal baseline-adjusted perturbation contrast was **−0.67696 spikes/s/neuron**, bootstrap 95% interval **[−1.76867, 0.14885]**, exact sign-control result **34/128 = 0.265625**. Baseline imbalance was at most **1.26011 Hz**, within the prespecified 5 Hz gate. The interval includes zero. Sign symmetry is an analysis assumption, not proof of the original randomized assignment. Non-stimulation is a control rather than sham; optical waveform onset was not verified. This is an unresolved observational contrast, not a replicated circuit mechanism.

The persisted shared-model pilot is historical **version 1.0.0** (fully measured outcomes), 30 epochs, width 32, **8,899 parameters**:

| Held-out measure / control | Result |
| --- | ---: |
| Equal-unit balanced classification accuracy | 0.48168; chance 0.5 |
| Unit-bootstrap accuracy interval | [0.46598, 0.49599] |
| Shared outcome-head MAE | 1.96031 |
| Training-fold mean control MAE | 1.97314 |
| Weighted-median control MAE | 1.96272 |
| Training-fold ridge control MAE | **1.84844** |

Classification is below chance. Regression improves approximately 0.12% over the median control and performs worse than ridge. A shared-learning benefit is unestablished. The regression target subtracts a baseline also present in the inputs, permitting mathematical coupling. Whole-animal holdout and training-only normalization reduce leakage but do not remove this coupling or observational confounding. The bootstrap summarizes held-out-unit scores with overlapping training folds; it is not a significance test or full model-refit uncertainty. Receipt: `tmp/public-shared-model-run-final.json`; checkpoint SHA-256 `8f3ebda6e4dcd8438e8d867857a34f94622157794f8c1c1a978a130e1cd956fb`. Do not relabel this run as a 1.1 masked-outcome or DREAM result.

**DREAM paired EEG/report pilot: completed as a local, exploratory run.** The fixed DATA1 selection used a public CC BY 4.0 Figshare package, signed-consent/University of Turku ethics provenance, 71 selected awakenings from eight participants, and 20 pre-awakening EEG spectral/RMS/QC features. One EDF failed the declared 60-second header gate without replacement, leaving **70 admitted awakenings**, three separate report classes (23 Experience, 23 NoExperience, 23 WithoutRecall), and **23 observed ratings / 47 explicit nulls**, all ratings in Experience. The main shared model's held-out balanced accuracy was **0.375000** (chance 1/3; descriptive unit-bootstrap interval [0.319444, 0.444444]) and observed-rating MAE **1.002487**, versus train-mean **1.003968**, train-median **0.895833** and fixed ridge **2.698733**. Matched stage-only and waveform-QC-only controls scored 0.305556 classification accuracy; their MAEs were 0.943971 and 1.391724. These results do not establish above-chance dream decoding, content reconstruction or a biological mechanism. Full source, selection, extraction, run/config/result/checkpoint hashes and independent review are in [DREAM_PILOT.md](DREAM_PILOT.md); unrated report classes remain unsupported for numerical outcome interpretation.

## Volume, workstation and data rights

The volume path reads bounded NIfTI scalar arrays, datatype/endianness/scaling and qform/sform world coordinates. Axial/coronal/sagittal inspection shares a crosshair and keyboard navigation. An actual **182×218×182 Harvard–Oxford-derived mask** was loaded; a keyboard K step changed slice 91→92 and world position `[-1, -17, 19]→[-1, -17, 20]`, with actual voxel intensity 1. This demonstrates real volume navigation, not validated semantic labeling or mental-state localization. Registered oblique resampling, comprehensive physical-aspect handling, cortical surfaces and 4D navigation remain incomplete. WebGL2 is the rendering path; WebGPU is capability detection only.

The local workstation was inspected across **12 views at 375, 768 and 1440 px**; document width matched each viewport and active navigation was verified. Screenshots are in `tmp/final-workspaces/`. A fresh run then reproduced a Public Data→3D Neuro Space→System `removeChild` error: Drei HTML labels used nested React roots with conflicting cleanup. Labels now belong to one main React DOM overlay; Three updates only their projected positions. Both the patched isolated development run and fresh production run retained all **14 visible source labels** and each passed **36 actual navigation clicks** across three complete cycles with **zero page errors**, including a delayed-cleanup check (`tmp/graph-navigation-patched-dev.json`, `tmp/graph-navigation-patched-production.json`). Full console/network acceptance and quantified sustained 30–60 fps performance remain pending; historical error caches cannot certify a release.

Public adapters distinguish metadata discovery from downloaded signals and analyzed results. DREAM registry version 9 contains **23 rows / 20 distinct datasets**; amendments are not new studies. Its CC BY 4.0 registry license does not transfer to every linked package. Restricted/access-gated sources remain gated. NeuroVault presets retain their original source links; dataset/atlas/software/weight rights require their own review and should not inherit the DANDI or DREAM registry license. Private reports, subject volumes and local acquisition are not public discovery payloads. See [DATASETS.md](DATASETS.md) and [DATA_SOURCES.md](DATA_SOURCES.md).

## Local/cloud boundary and verification ledger

Raw acquisition/recording stays local in native C++; Python supplies optional device/science adapters and bounded persistent SQLite model jobs. The browser is the control/display plane. Public Vercel routes expose discovery, reviewed architecture and service metadata; they do not become an authoritative acquisition clock, private-data upload path or durable in-memory model queue. Public-to-loopback browser access depends on actual origin/browser policy verification; local ports should not be publicly exposed as a workaround.

The final project defines **three services**: Next.js frontend, Python public gateway and C++ container health/metadata. A verified preview and the production deployment both built and served the OCI service; current deployment IDs, aliases and authenticated health receipts are recorded in [VERCEL.md](VERCEL.md). The cloud C++ service exposes bounded public health/metadata only; private acquisition and model jobs remain local.

| Acceptance receipt | Status at this report revision |
| --- | --- |
| Python regression suite | **58 passed**, including 14 DREAM importer tests and sealed artifact-export checks, `tmp/final-python-tests.log` |
| Node research/volume/worker/graph suite | **40 passed**, no failures/skips, `tmp/final-node-tests.log` |
| Node 24 production build / type checks | **Passed**, Next.js 15.5.27, `tmp/final-web-build.log` |
| C++ parity / integration / public HTTP | **Passed locally** within the measured limitations above |
| Remote CI IDs and completed job results | **Passed:** [Morpheus CI run 37445111184](https://github.com/satvikOS/Morpheus/actions/runs/37445111184) — Web workstation, signal-gateway syntax, Rust native, shared representation and C++ acquisition/cloud checks all passed; Vercel deployment check also passed |
| Preview deployment / three-service health checks | **Passed:** `dpl_CDkr7WpDLnc9VaxAXQtQJs248iUv`, preview URL and authenticated health receipts in [VERCEL.md](VERCEL.md); frontend, signal-gateway and cloud C++ routes responded successfully |
| Production deployment / three-service health checks | **Passed:** `dpl_8k4fg4WF4zdSJXBsX6FoTF7k9574`, alias [morpheus-three.vercel.app](https://morpheus-three.vercel.app), frontend/signal-gateway/cloud C++ health all returned successfully; file-tree privacy audit is recorded in [VERCEL.md](VERCEL.md) |
| Fresh production navigation / graph labels | **Passed:** 36 actual clicks, 14 visible labels, zero page errors; receipt above |
| Full current-revision browser console / network errors | **PENDING — insert gateway-configured console/network receipt** |
| Full-hour synthetic ring/RSS soak | **Passed with measured limitations:** 3,600 seconds, 7.2M frames, 450k packets, RSS 4,880–5,536 KiB, 35 pacing misses; receipt `/tmp/morpheus-native-soak-3600-20261006.json` |
| DREAM trained-model and independent-unit controls | **Passed as a measured local pilot:** 70 admitted awakenings / 8 units, 23 observed ratings, main BA 0.375000 (chance 1/3), MAE 1.002487; matched stage/QC controls and exact-hash independent review recorded in `docs/DREAM_PILOT.md` |

CI now specifies Node 24, Python API/science tests, a dedicated CPU PyTorch shared-model job, native C++/Rust parity, bounded cloud HTTP checks and retained Rust tests. Passing local tests do not imply those remote jobs completed. Remaining acceptance includes actual device timing and sustained recording under load, storage recovery/reconnect/restart fault coverage, production authorization/durable cloud orchestration, scientific replication and matched ablations, validated multimodal encoders and the requested larger jointly trained model.
