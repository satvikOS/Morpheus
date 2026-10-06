# Local research records and descriptive analyses

This implementation strengthens data acquisition and auditability. It does not establish that every experience is permanently stored, that a dream has been recovered, or that report similarity demonstrates neural reinstatement.

## M0: sealed capture with append-only interpretation

New `dataset-zero-v2` records retain the exact text submitted, including leading/trailing whitespace and newlines. SHA-256 is recomputed before persistence. A digest establishes a content-integrity comparison; it is not evidence of authorship, biological truth or an independent timestamp.

The immutable capture envelope includes pseudonymous subject, session, sleep episode and awakening IDs, optional awakening time, computed report latency, awakening method, sleep-stage field, protocol version, recording/marker references and whether a related dream was recalled before sleep. The UI captures IDs, timing and prior recall; unsupported sleep-stage, recording and marker fields stay unknown/empty. Users must reuse episode IDs for reports from the same episode. This is manually reported provenance, not verified sleep physiology.

Raw text, digest, initial capture ratings/tags/modalities and capture context cannot be overwritten through the store. `appendDreamAnnotation` adds separately attributed, timestamped revision objects. Existing annotations cannot be edited or removed through an update. The UI currently adds free-text self annotations; structured entities, events, locations and recurrence judgments exist in the schema for future independent annotation workflows.

Version 1 records remain readable with their original text and digest. Missing context remains unknown. The existing IndexedDB key layout is preserved rather than rewriting raw reports in a schema upgrade. Legacy localStorage entries are merged by ID; a conflicting sealed record is rejected. Successful migration retains an inactive recovery copy and removes the active import key. Explicit deletion removes recovery copies too. JSON export includes the versioned records and annotation history in deterministic ID order.

IndexedDB is the primary browser corpus; localStorage remains a fallback only when IndexedDB is unavailable. Database failures are propagated, not silently converted to an empty corpus. The panel retains an unsaved narrative after a failed write and displays the storage error. Browser storage is not an archival guarantee: users should export backups before deleting site data. Native neurophysiology recordings remain outside this browser text corpus.

## M1: background ranks are not permutation p values

The prior implementation repeatedly sampled a tiny comparator pool and reported the resulting tail fraction as a permutation statistic. Repeating the same comparator cannot create additional independent null observations.

The new screen reports lexical cosine, TF-IDF cosine, tag overlap and sensory overlap. TF-IDF is an exploratory corpus representation, not a trained neural embedding or held-out scientific evaluation. The original weighted similarity remains separately visible to preserve its baseline interpretation.

Candidate pairs from a known same subject/episode are excluded. Background comparisons require known episode IDs from the same subject as both targets, exclude both target episodes, deduplicate episode IDs and use disjoint comparator pairs once. Legacy rows with unknown subject/episode context cannot qualify as background episodes. The number displayed is the actual count of distinct disjoint comparator pairs; within-subject episodes may still be correlated and are not asserted to be statistically independent.

A background tail fraction uses `(1 + greater_or_equal_background_scores) / (1 + background_count)`. This describes ranking against observed background pairs. The background pairs are not verified nonrecurrences, selection is not randomized, and this is not a formal permutation test. No significance or recurrence identity is claimed. Every scanned target pair counts toward a conservative family screening bound `min(1, tail_fraction * scanned_pairs)`, computed before limiting the displayed candidates. That bound is also descriptive, not a corrected p value. A separately tested Benjamini–Hochberg utility is provided for future preregistered valid statistical tests and is deliberately not applied to these ranks.

## M2: prospective local protocol snapshots

Version 2 trials seal the manually assigned delay/intention condition, operator, pre-report reference, scoring rubric and analysis plan before scoring. Their protocol digest is checked on each persistence call. This is local prospective registration; no external registry or independent timestamp is claimed. Condition randomization is not implemented and is visibly recorded as manual.

The bounded state machine logs `CREATED`, `AWAKENED`, `FOLLOWUP`, `SCORED` and `EXCLUDED` transitions with timestamp, reason and optional marker reference. Invalid transitions, backdating, history rewrites and retrospective protocol changes are rejected. Pending trials restore after navigation. A missing awakening marker can still lead to follow-up, but no verified timing is inferred from that path.

Operator scoring requires pre/post report IDs and a 0–5 integer. Since the workstation shows the operator the condition, these scores are always unblinded. Independent assessor packet export removes delay, intention, session, operator, original timestamps and the existing score. It includes report references and the registered rubric. The separate packet ID must be linked offline by the researcher; exporting a packet does not establish that a blinded assessor has scored it. A secure independent scoring/import/adjudication workflow is still future work.

Completed scores cannot be overwritten. Trials can be excluded with a retained reason. Descriptive summaries separate delay, intention/control, protocol version and claimed blinding; excluded rows remain stored but are omitted from the summary. Legacy blinding flags remain historical claims, not retrospectively verified blinding. Means and rates are not causal inference or population evidence. Full protocol/history exports and condition-hidden packet exports serve different purposes.

## M5: session trajectories and quality provenance

Atlas snapshots are validated for finite features, consistent unique feature names, subject/session identity, channel count and sampling information. New persistence adds source kind (`simulation_fixture`, `local_acquisition_unverified`, or `unknown`), feature schema, preprocessing/recording metadata when known and explicit engineering-only evidence. Snapshots cannot be overwritten.

Flatline/clipping ratios ≥0.05 are engineering screening flags, not clinically validated artifact criteria. Unknown source provenance is flagged. The workstation displays session means, repeated-snapshot standard errors, quality-flag counts and adjacent-session feature cosine. A single snapshot has unknown standard error. Simulated, acquired and unknown measurements, incompatible feature names/schemas, and different sampling/channel configurations remain separate. Worker calls reject mixed source/schema families.

These are hand-crafted signal features; cosine depends on their scale and repeated windows can overlap. The view does not estimate an independently validated neural manifold, individual memory contents, longitudinal biological stability or decoder generalization.

## Verification

`node --test tests/research-records.test.cjs` exercises exact-text/digest preservation, append-only annotations, latency validation, legacy export, quota failures, digest tampering, honest tiny-corpus screening, same-episode and subject exclusions, real background counts, full comparison-family accounting, BH correction, immutable protocols/history, state transitions, operator blinding restrictions, condition-hidden exports, descriptive strata/exclusions and atlas source/uncertainty separation.

Browser rendering, real IndexedDB transactions and end-to-end acquisition are verified by the broader workstation integration pass. Real datasets, independent scorer studies and hardware validation remain separate research work.
