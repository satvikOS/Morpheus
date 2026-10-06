# Executable perturbation and shared-model pipeline

Morpheus applies a reusable control-and-measurement framework to existing public circuit recordings. The implemented path is pinned public NWB bytes → fixed extraction plan → paired animal/session measurements → unit-level contrast and uncertainty → pre-event feature rows for the shared encoder. It executes software analysis; it neither controls biological stimulation nor establishes dream recovery.

## Local entry points

`services/signal-gateway/app/causal_analysis.py` has no third-party dependencies:

```python
config = validate_causal_request(payload)
result = evaluate_causal(config, cancelled=threading_event)
```

The local job adapter dispatches `method: "causal-perturbation"`. Validation returns a new canonical configuration with `model: "causal-perturbation"`, method version `paired-cluster-perturbation-1.0.0`, sorted copied trial records and SHA-256. Changing a validated measurement/configuration invalidates its hash and requires a new run.

The public-data importer needs **PyNWB 4.2.0 in the local workstation environment**. It never loads raw electrical recording arrays. Its fixed DANDI API source supplies bounded metadata, immutable asset IDs and upstream SHA-256; cached or newly downloaded bytes must match those checksums before NWB parsing.

```sh
.venv/bin/python services/signal-gateway/tools/dandi_optogenetics.py \
  --cache-dir /Users/account_clawteam1/Morpheus/.local/dandi-optogenetics \
  --output-dir /Users/account_clawteam1/Morpheus/.local/dandi-optogenetics/new-run
```

Each output directory is a new immutable run. The command refuses to overwrite prior run artifacts. Hard limits are 16 MiB per file, 64 MiB per run, 6–24 candidate animals and one lexicographically selected extracellular `+ogen` asset per candidate animal. Default selection examines 16 animals. An asset is selected before inspecting its neural effect; mismatched regions/phases and failed input gates are recorded explicitly.

## Request and inference contract

```json
{
  "method": "causal-perturbation",
  "source": {
    "kind": "public-animal-optogenetic",
    "datasetId": "DANDI:000009",
    "datasetVersion": "0.220126.1903",
    "url": "https://dandiarchive.org/dandiset/000009/0.220126.1903"
  },
  "design": {
    "assignment": "observational",
    "independentUnitsConfirmed": true,
    "registration": {"registered": false}
  },
  "outcome": {"name": "Task delay mean-neuron firing rate", "unit": "spikes/second/neuron"},
  "controlCondition": "control",
  "baselineTolerance": 5,
  "seed": 2026,
  "bootstrapSamples": 1000,
  "permutations": 2000,
  "rows": [
    {"trialId": "asset-id:trial-id", "unitId": "mouse-id", "sessionId": "asset-id",
     "condition": "stimulated", "outcome": 9, "baseline": 7, "qcPassed": true}
  ]
}
```

The example row illustrates the schema; a runnable request requires 24–8192 observations and 6–128 independent animals/participants. Every animal/session block contains both stimulated and the chosen `sham` or `control` condition; each independent animal has at least two trials per condition. Trial IDs are unique globally. All submitted rows pass the same saved eligibility/QC rule, with exclusions retained by the importer.

Baseline is optional but present on all rows or none. When supplied, a saved nonnegative `baselineTolerance` is mandatory. Any animal/session condition-mean baseline imbalance above that tolerance stops inference; a failing animal is not silently dropped. Missing baseline yields `NOT_RECORDED`, not a passed balance assessment. Tolerance is an extraction-plan engineering threshold in outcome units, not a validated biological cutoff.

The estimand is computed in this order:

1. Mean `outcome − baseline` within each condition of each animal/session block, or mean outcome when baseline is absent.
2. Stimulated-minus-control contrast within the block.
3. Equal-session average within each animal.
4. Equal-animal average across independent animals.

Extra trials, neurons or sessions never inflate the independent sample count. The 95% percentile bootstrap samples entire animal aggregates, preserving repeated-session clustering. Six animals is an input floor permitting two-sided sign-test resolution below .05, not a power guarantee or reliable small-sample CI coverage claim.

The two-sided null test flips whole-animal effect signs. Up to 16 animals it enumerates every sign pattern; above 16 it draws 200–10000 seeded Monte Carlo patterns and uses `(extreme + 1)/(draws + 1)`. Monte Carlo output includes a Wilson 95% interval for the underlying null-tail probability. Work is capped at two million cluster operations. Cancellation is checked during aggregation, bootstrap and sign enumeration.

**“Exact” describes enumeration of the sign distribution.** It is an inferential null under independent clusters and sign exchangeability/symmetry; it is not automatically the original trial-assignment distribution. Randomization provenance alone does not prove that this null matches the assignment mechanism. The output carries this assumption, its explicit null hypothesis, resolution, effect CI and unadjusted per-run p-value. Multiple outcomes/methods/runs need a prespecified correction.

`assignment: "randomized"` requires a recorded assignment manifest hash and descriptive method. Claiming registration requires a plan ID and `lockedBeforeCollection: true`. These declarations are preserved and classified but are not independently authenticated by this software. Synthetic inputs always remain `engineering-fixture`; observational sources/designs remain `observational-association`; eligible non-synthetic randomized designs are identified as exploratory or registered randomized designs. No state means biological methods were reproduced.

## Applied public circuit-data pilot

The tested source is [DANDI:000009, version 0.220126.1903](https://dandiarchive.org/dandiset/000009/0.220126.1903), DOI [10.48324/dandi.000009/0.220126.1903](https://doi.org/10.48324/dandi.000009/0.220126.1903), CC-BY-4.0 as recorded by its [primary version metadata](https://api.dandiarchive.org/api/dandisets/000009/versions/0.220126.1903/info/). It accompanies Guo/Inagaki et al., [10.1038/nature22324](https://doi.org/10.1038/nature22324). The [provider's example](https://docs.dandiarchive.org/example-notebooks/000009/DataJoint/DJ-NWB-Guo-Inagaki-2017/notebooks/Guo-Inagaki-2017-examples/) documents the source-specific subject/trial/perturbation schema. Its asymmetric correctness filters were not copied into this contrast.

The adapter fixes left-ALM perturbation and left-Thalamus recording sites. The independent unit is `subject.subject_id`; the NWB `Units` table contains neurons, which are aggregated within a trial. It retains all good-quality, valid-window trials with recorded left/right task instruction regardless of correctness or early licking. Both windows must fit the trial and end before the cue. Stimulated trials have a recorded delay-phase label. No-stimulation trials are **control**, not sham.

Outcome is mean firing across the session's recorded neurons, measured in a fixed 0.10–0.60 second window after `pole_out_time`; baseline is the equal-length −0.60 to −0.10 second window. Inspected files lack a continuous optical waveform, so this is a task-event-locked contrast under a perturbation label. Exact light onset, assignment records, trial-order balance and cell-population equivalence are unverified. The plan is locked before extraction, after the original data collection, and is explicitly retrospective.

The executed pinned pilot on 6 October 2026 produced:

| Measurement | Observed result |
| --- | --- |
| Public files / bytes verified | 16 mice / 27,180,264 bytes |
| Region/control eligible animals | 7 |
| Matched sessions / eligible trials | 7 / 1,776 |
| Equal-animal baseline-adjusted contrast | −0.676955632 spikes/second/neuron |
| Animal-bootstrap 95% CI | [−1.768669488, 0.148846584] |
| Two-sided animal sign-flip result | 34/128 patterns; p = 0.265625 |
| Maximum absolute baseline imbalance | 1.260112647 Hz/neuron; fixed 5 Hz gate passed |
| Evidence classification | Observational association |

This pilot does not resolve an effect under that particular retrospective estimand. It is not a reconstruction, treatment result, or replication of the original paper's figures. The interval crosses zero, and the per-run test depends on its stated sign assumptions.

Outputs include `extraction-plan.json`, `input-manifest.json`, `causal-request.json`, `causal-result.json`, `import-manifest.json` and `unified-model-input.json`. The input-manifest hash links the source checksums/selection gates to both analysis outputs without creating circular output hashes. The final run manifest records status and hashes of resulting artifacts.

## One common trainable feature contract

`unified-model-input.json` uses the shared encoder job contract:

```json
{
  "method": "unified-model",
  "model": "morpheus-shared-encoder",
  "epochs": 30,
  "hiddenWidth": 32,
  "seed": 2026,
  "source": {
    "kind": "public-neural-recording",
    "datasetId": "DANDI:000009",
    "datasetVersion": "0.220126.1903",
    "license": "CC-BY-4.0",
    "featureSchema": "dandi000009-pre-event-population-1.0.0"
  },
  "design": {"inputTiming": "pre-task-event", "assignment": "observational", "independentUnitsConfirmed": true},
  "rows": []
}
```

Each real row contains immutable `id`, animal `subjectId`, asset `sessionId`, four ordered `features`, matching `featureNames`, perturbation `label`, and continuous `outcome`. Source metadata also includes the primary URL and bounded asset IDs/paths/SHA-256.

| Feature | Information allowed at inference input |
| --- | --- |
| `baseline_mean_rate_hz` | Pre-event population mean firing |
| `baseline_neuron_rate_population_sd_hz` | Pre-event firing spread across recorded neurons |
| `baseline_zero_neuron_fraction` | Fraction of recorded neurons with no pre-event spikes |
| `task_instruction_right` | Recorded task instruction, right=1 / left=0 |

Perturbation labels, post-event firing, the continuous target, animal/session identity, and genotype are excluded from features. The classification target is `stimulated` versus `control`; the continuous target is post-event mean firing minus baseline. Optical onset is unverified, so pre-task-event timing does not establish pre-intervention timing. Baseline also appears subtracted in the target; mathematical coupling can contribute apparent outcome prediction and must accompany reported performance.

Whole-animal holdout is required. Scaling, encoder and heads fit only training animals; repeated trials from a held-out animal cannot enter training. This is a public animal circuit-data engineering pilot of the shared model interface. Generalization to dream reports, human recordings, cinema or disease questions requires separate validated adapters, licensed data and their own held-out targets.

## Applying more research through the same model

A contribution becomes executable only when its source/version/rights, measurement schema, independent unit, target, input timing, exclusions, null/control design, held-out split and verification status are recorded. Papers can inform these constraints or head objectives without contributing trained weights. A source with incompatible measurement timing or target semantics requires an explicit new adapter/schema version; adding a citation never upgrades a model result. Unsupported methods remain unimplemented until their executable adapter and validation gates exist.

Methodology provenance in each causal output records foundational optical-control context [10.1038/nn1525](https://doi.org/10.1038/nn1525), animal ensemble-control context [10.1126/science.aaw5202](https://doi.org/10.1126/science.aaw5202), mouse retrieval context [10.1126/science.aaa5542](https://doi.org/10.1126/science.aaa5542), and the actual public-source DOI. These are source relationships, not claims that the statistics implement those papers' biological procedures.

## Verification

```sh
.venv/bin/python -m unittest discover -s tests -p test_causal_analysis.py
```

The 13 tests exercise positive/null/negative fixtures, equal-animal weighting, missing controls, duplicate IDs, small independent n, quality flags, nonfinite/oversized values, recorded-assignment/registration gates, baseline confounding, source provenance, fixed alpha, immutable canonical records, cancellation, Monte Carlo bounds, checksum/size-bounded caching, output immutability and a real synthetic NWB schema mapping. The NWB mapping test verifies correctness/early-lick labels are retained and pre-event feature summaries exclude the post-event target. A full artifact-contract test checks animal identity, the unified job envelope, confirmed independent units and input/output hash links. The separate public run above verifies the pinned provider path on actual bytes.
