# Engineering and research decisions — 2026-10-06

## Apply methods through reviewed adapters

Literature discovery is an admission pipeline. A paper contributes an explicit method/input contract, controls, bounded implementation, review, tests and measured output. Reviewed recipe envelopes are allowlisted by the local runtime and retained in canonical job inputs. Crossref paging scales discovery beyond the curated source set; unknown papers remain review candidates. Four bounded adapters currently execute, including a jointly trained shared representation with two heads. They are Morpheus adaptations; linked source experiments are not claimed reproduced.

Optogenetic methods contribute manipulation-versus-measurement separation, paired controls, independent-animal weighting, confound checks and uncertainty estimation. The causal workbench analyzes existing trial outcomes without controlling stimulation hardware. Synthetic fixtures validate software. Public experimental contrasts retain source versions, data hashes and design limitations; declared randomization or an input hash alone cannot verify a causal claim.

## Preserve ambitious hypotheses as hypotheses

Persistent latent memory and access failure are research hypotheses. Subjective autobiographical and dream reports are important reports, but are not independently verified recordings of events. Morpheus tests recoverable information, reliability and generalization without presenting permanent storage of every experience, prenatal recollection, faithful dream video or treatment efficacy as established findings.

## Separate acquisition, science and cloud

Native local recording remains authoritative; browser buffers are disposable display copies. Background science jobs use a bounded single-worker queue and SQLite outside the acquisition event loop. Explicit local opt-in and loopback-only UI dispatch prevent private snapshots from becoming hosted jobs. The Vercel C++ service exposes bounded public metadata/health routes.

## Retain Rust until migration has earned removal

C++20 passes actual Python/Rust wire and DSP comparisons, malformed-packet tests, bounded-recording integration and sanitizers. Some Rust operations remain faster in measured runs. Keep the Rust reference and CI until workload-level latency, long-soak and hardware acquisition gates justify replacement. Synchronous recording can affect pacing; deadline misses are reported.

## Respect independent observations

M1 similarities use unique episode-aware backgrounds and descriptive ranks. M3 fits scaling on training folds and holds out entire sessions. Causal analysis aggregates sessions within animals before equal-animal weighting. Trial counts and neuron counts cannot substitute for independent subjects/animals.

## Seal source records before annotation

M0 verifies exact raw-report SHA-256 before persistence, seals context, and appends annotations separately. M2 seals protocols/rubrics and records manual assignment/unblinded scoring. M5 snapshots seal normalized features, schema and source/QC context. Hashes provide integrity; they do not prove authorship or biological truth.

## Display the volume actually loaded

Read scalar datatype, endianness, scaling and qform/sform from NIfTI headers, reject oversized/truncated inputs, cap decompressed bytes and scalar count, and synchronize slice indices with intensity/world-coordinate readouts. Intensity clustering and proximity geometry are labelled explicitly. Registered oblique resampling, physical-aspect views, time navigation and cortical surfaces remain future capabilities.

## Make evidence discoverable in the interface

The workstation uses readable mineral/forest surfaces, a lightweight vector mark, consistent focus states, a keyboard command palette, deep links and applied-method panels. Registry status reflects implemented/tested availability. Small-screen overflow and real workflow behavior are checked before deployment claims.

## Apply compatible objectives to one shared representation

Transformer feature tokens and joint multitask learning update one encoder, rather than presenting a paper catalog as integrated knowledge. Numerical features and measured targets require versioned admission. Thousands-scale metadata paging is tested with a fixture; thousands of actual implemented contributions have not been integrated. Different dataset pilots use the same architecture with their own trained weights and feature schemas; no cross-species joint checkpoint or universal brain model is claimed.

Missing continuous targets remain null. Their classification labels stay available, while outcome normalization, loss and MAE use observed measurements only. Independent subjects require at least two observed targets; outcome scope and per-class coverage travel with the inference checkpoint. A rating predicted for a class lacking measured targets is explicitly an extrapolation.

## Patch the resolved CSS dependency before deployment

Next.js 15.5.27 resolved PostCSS 8.4.31, affected by upstream CSS-stringification and source-map path advisories. A targeted override resolves PostCSS 8.5.29 through both Next.js and Tailwind. The lockfile was regenerated in an isolated directory because npm retained the old nested entry on in-place reconciliation. A clean install reports zero production dependency advisories on 2026-10-06; this is a point-in-time audit, not a guarantee against future findings. [Upstream advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp).
