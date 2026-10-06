# Dream EEG/report training pilot

The DATA1 adapter produces training input for the existing Morpheus shared encoder from real pre-awakening EEG and independently collected report categories. It targets report status and measured perceptual-complexity ratings. The EEG does not contain a stored report, image, movie, or recovered autobiographical memory in this adapter.

## Source, rights, and consent

The source is Valdas Noreika, Mila Oravecz, and Lisa Svartsjö's **Noreika_DATA1**, DREAM set 16, amendment 0: [Figshare version 1](https://doi.org/10.6084/m9.figshare.24058740.v1), public file 42196143, `Noreika_DATA1.zip`, 1,614,575,476 bytes. Both the versioned article metadata and included README specify **CC BY 4.0**. The archive is public and unembargoed; there is no restricted-access login. The original study's [primary methods](https://pmc.ncbi.nlm.nih.gov/articles/PMC7362719/) report University of Turku Ethical Board approval and signed informed consent following the Declaration of Helsinki. This audit establishes the provenance of an existing public research package; it does not assert permission to identify or contact participants, collect new human data, or conduct interventions.

The package attributes the protocol and category/rating procedures to [Wong et al. 2020](https://doi.org/10.1093/nc/niaa006) and [Noreika et al. 2009](https://doi.org/10.1016/j.ijpsycho.2009.06.002). The former published a separately selected 54-recording, nine-person blinded benchmark whose EEG spectral classification did not significantly exceed chance. This 71-recording retrospective supervised pilot uses the full DATA1 package and a different fixed selection, includes WithoutRecall, and is **not a reproduction of that published benchmark**.

The current public archive metadata provides MD5 `6534806c2d0862cbedfdf6f7b91d7ddd`. The whole 1.6 GB ZIP is not downloaded, so its MD5 is **not independently verified**. Exact selected entries are verified with ZIP CRC32, decompressed byte counts, and individually recorded SHA256 digests. The five metadata entries are hashed separately. Important metadata digests are:

| Metadata | SHA256 |
| --- | --- |
| Records.csv | `1aa3bcf52f5d3f75da533d6583118ebecf8755ff4f082b9c3dbc2581ca786be8` |
| Data/Reports.csv | `08c2d4de458195526edfcfba3cb2d65bc51b4a2d41271612a946c644e5c10c71` |
| ExperimentalDescription.txt | `af5a6271ccd983da809056fb42befcc2abc89552b73ad08d2f80e991ef1d3acb` |

## Fixed selection before waveform analysis

The adapter joins Records.csv and Data/Reports.csv by exact filename and case identity and rejects inconsistent report labels. The source metadata fixes 60 seconds, 2000 Hz, 25 EEG channels. Auxiliary EOG/EMG channels vary; individual EDF headers must still confirm the fixed duration, required EEG channels, physical calibration, and rate. Patient/recording header identities and dates are not exported.

Only independently collected awakenings with canonical report codes 0/1/2 and final scored stage N2/N3 are eligible. Negative ambiguous/unknown codes and other/unknown stages remain recorded as exclusions. NoExperience and WithoutRecall are never merged. Whole participants need at least two awakenings of every retained class. Within each eligible participant/class, selection takes at most three filenames ranked by SHA256 of `dream-data1:2026:filename`. Neither EEG values nor rating magnitudes are inspected for this rank. Missing rating coverage is a declared admission gate, not an imputation rule.

The sealed pre-QC selection is 71 awakenings from eight people (source IDs 2, 4, 5, 8, 11, 13, 15, 16):

| Report category | Code | Selected | N2 | N3 | Measured complexity |
| --- | --- | ---: | ---: | ---: | ---: |
| NoExperience | 0 | 24 | 9 | 15 | 0 |
| WithoutRecall | 1 | 23 | 11 | 12 | 0 |
| Experience | 2 | 24 | 11 | 13 | 23 |

Selection SHA256 is `6d03eafce61bfc769e9de322fed875e5fb55d6602b1386150ee80c1fd8f2b526`. The selected compressed entries total 356,604,127 bytes (about 340 MiB). Exact HTTP 206/Content-Range reads are mandatory; the adapter rejects servers that return the whole archive. A durable cumulative body-byte ledger includes metadata and failed partial reads and stops at 512 MiB. Downloaded verified entries can be resumed without redownloading; altered or unledgered files require investigation. Source and derived artifacts remain under ignored `.local/dream-pilot`, with restrictive local file permissions.

The selection deliberately balances report categories within people. It does not estimate their population prevalence. Sleep-stage proportions differ between classes, and stage may affect absolute EEG power. Subject holdout helps prevent person leakage but does not remove stage, recording, reporting, arousal, or artifact confounds.

## Fixed input features and QC

Before waveform downloads, the adapter seals an extraction contract linked to the selection. Contract SHA256 is `747828fc3577320f38138a49703dec81711ace5b029ef341aa50c3f8a6b60156`. The input is the source 60-second segment immediately before each awakening; the source's exact within-segment stage composition is not independently re-scored.

The 20 features use only raw, physically calibrated EEG samples:

1. Regional mean log10 band power in microvolt-squared for frontal(F3/F4/Fz), central(C3/C4/Cz), and posterior(P3/P4/Pz/O1/O2) electrodes: delta [0.5,4), theta [4,8), alpha [8,12), sigma [12,16), beta [16,30)Hz;15 features.
2. Mean channel RMS amplitude after full-window mean subtraction, log10 microvolts; three regional features.
3. Maximum required-channel ADC clipping fraction and prolonged digital-flatline fraction; two waveform-derived engineering QC features.

PSD uses four-second symmetric Hann windows, 50% overlap, per-window mean subtraction, calibrated one-sided density and half-open-band integration. No additional filter, ICA, artifact repair, channel replacement, re-reference, or interpolated samples are applied. Log values use a 1e-12 numerical floor. Source EDF prefilter strings are retained; current headers describe unavailable(`NaN`) filter settings, which cannot be interpreted as verified absence of filtering.

Fixed engineering rejection thresholds are more than 1% samples at/beyond ADC extrema or more than 5% samples in unchanged digital runs lasting at least one second, on any required channel. Source artifact proportions are blank and remain unknown. These screens do not establish artifact-free EEG or substitute for independent artifact adjudication. QC features themselves may correlate with report categories; an artifact-nuisance ablation is still needed before interpreting biological mechanisms.

Stage, report category, subject/session identity, demographics, text, and complexity ratings are **not input features**. Report category is a supervised target, and complexity is a separate measured target. Every row is one real awakening. Neither spectral windows nor electrodes become additional independent participants or training rows.

## Outcomes and model admission

`Dream complexity` is the source two-blind-rater perceptual-complexity score on Orlinsky's modified 1–7 ordinal scale; averaged source value 1.5 is preserved. NoExperience/WithoutRecall and unscored recalled reports have `outcome:null`, with the original raw value, exact source column, missingness reason, filename and EDF SHA retained. They are never assigned 0, and regression is not computed from EEG features or label codes.

Only 23 of 71 pre-QC targets are observed, all in Experience. Treating ordinal distances as an interval regression target is an explicit exploratory approximation. Normalization, regression loss, baseline estimates and MAE must use observed ratings only. Predictions for categories with no observed ratings must be marked unsupported extrapolations. Outcome coverage by category is retained in the run and checkpoint.

After fixed QC, the adapter reevaluates complete participant/class/measurement coverage. Each admitted person still needs at least two real awakenings per class and two actual ratings. It requires at least six people and 48 genuine awakenings. A failed gate yields a versioned unavailable training payload; no thresholds are lowered, labels recoded, missing values invented, or replacement EEG selected after seeing features.

The emitted request uses `method:unified-model`, `model:morpheus-shared-encoder`, an openly licensed `public-neural-recording` source and observational `inputTiming:pre-awakening`, seed 2026, width 32, 30 epochs. The existing local runtime fits normalization within each training fold and holds out whole participants. Final checkpoint fitting occurs only after those evaluations. The frozen contribution graph does not automatically admit a new dream-reconstruction method or turn this data paper into weights.

Two additional requests retain exactly the same admitted awakenings, class labels, missing/observed ratings, seed, width, epochs and outcome contract. The stage-only control uses two N2/N3 indicators from external source annotations. The QC-only control uses only `adc_clipping_fraction` and `prolonged_flatline_fraction`, fixed indices 18/19 in the sealed EEG contract. Their feature schemas have distinct `-stage-control` and `-qc-control` suffixes. These requests are matched nuisance screens chosen before model scores, not causal tests or architecture-matched ablations: two feature-identity embeddings instead of twenty change parameter count. The main request still contains no stage feature.

## Completed local extraction

The actual cumulative download was **356,776,715 bytes** (about 340.25 MiB), including metadata and ZIP range overhead. All 71 selected EDFs were verified. Download-manifest SHA256 is `8751332bd393c15f2cca87a5e2bbe24017bab960c5c99af4296d765c8a0c8af5`.

The fixed duration check excluded `ID_254_S11_N4_A5.edf` (NoExperience): its actual EDF header did not provide the required 60-second window although its CSV metadata declared 60 seconds. It was not cropped, replaced, or reranked. The other 70 recordings passed the declared ADC/flatline screens, and all eight people still met every class and observed-rating gate. The resulting labels are **23 NoExperience, 23 WithoutRecall, 24 Experience**. Actual ratings remain 23, all in Experience. Post-QC N2/N3 counts are 9/14, 11/12, and 11/13 respectively.

All three emitted requests passed the actual `validate_unified_request` runtime boundary with `pre-awakening` preserved. The main source envelope is about 36 KiB and retains the original per-case rating values, missingness, source-column identity, report code, stage annotation and EDF digest, in addition to the complete metadata hashes. Artifacts:

| Local artifact under `.local/dream-pilot` | SHA256 |
| --- | --- |
| features.json | `8825d12cf1749419c05a8e7d2275db6f6efc13fccdc8d4b843ad581918884dd5` |
| training-input.json | `1a11e9aa16b87b27d9f295bc2c72fe7d08edf29d768442f849ce26b790f67f2e` |
| training-input-stage-control.json | `deff31c174a0162d9d330025997aa6900b3cbd7bf962c6b4c6255e884dbf9aac` |
| training-input-qc-control.json | `1fcc92e4db0707415f96c906cc2ed2a94d02c6365ee8b97fa50a2443e9039ee0` |

The importer suite passed all **14 tests** using the model environment. A separate stdlib-only run passed 10 metadata/boundary tests and explicitly skipped four NumPy numerical tests. These are extraction and request-validation results; numerical training results belong to the actual persisted model runs.

## Measured training results and independent review

The main input and both matched controls completed through the actual local UI/API job workflow using runtime `morpheus-shared-representation-1.1.0`, seed 2026, width 32 and 30 epochs. Each used the same 70 awakenings, eight people, three classes, 23 observed complexity ratings and 47 null targets. Scores average whole-person held-out folds with equal person influence; classification additionally balances the three classes. Regression errors cover only the genuinely rated reports, not NoExperience or WithoutRecall. The unit is the source ordinal complexity point, under the previously stated interval approximation.

| Input | Features | Parameters | Balanced accuracy | Descriptive 95% unit-score bootstrap | Observed-rating MAE | Train-mean MAE | Train-median MAE | Fixed ridge MAE |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| EEG spectrum/RMS/QC | 20 | 9,444 | 0.375000 | [0.319444, 0.444444] | 1.002487 | 1.003968 | 0.895833 | 2.698733 |
| Source stage only | 2 | 8,868 | 0.305556 | [0.250000, 0.361111] | 0.943971 | 1.003968 | 0.895833 | 0.974636 |
| Waveform QC only | 2 | 8,868 | 0.305556 | [0.180556, 0.416667] | 1.391724 | 1.003968 | 0.895833 | 1.031431 |

The balanced-accuracy chance reference is 1/3. The EEG point score is numerically above that reference, but its descriptive interval includes it. The bootstrap resamples eight held-out-person scores from models with overlapping training folds; it does not refit models, capture full model-training uncertainty, or provide a preregistered significance test. No above-chance biological effect is established by these figures.

The EEG model's MAE is approximately the train-fold constant-mean baseline and is **worse than the constant-median baseline**. The stage-only regression also has lower error than the EEG regression. The poor fixed-ridge result, using 20 inputs and only about 20 observed training ratings per fold with a fixed 0.001 penalty, does not establish superiority to suitably evaluated classical models. Hyperparameters were fixed for this pilot; comparative model selection requires independent nested evaluation rather than tuning against these reported folds.

Stage/QC controls are useful matched-row screens, but their below-chance classification point scores do not remove stage-mediated EEG effects, artifact/reporting confounds, or interactions. The lower-dimensional controls also have 576 fewer feature-embedding parameters. Independent replication, larger participant samples, stage-matched analysis and nuisance-adjusted/feature ablations remain necessary before attributing classifications to dreaming itself.

The independent review recomputed every metadata digest and all 71 downloaded EDF byte counts/SHA256/CRC values against the sealed selection. It confirmed that persisted configs match the original inputs, source envelopes, label/rating values and control settings. All eight folds have disjoint training/test IDs, hold out the entire designated participant, and test every admitted awakening exactly once. Their 23 observed outcome-test IDs are exactly the non-null input targets.

Separately computed float64 equal-person training means/scales match saved float32 preprocessing, with maximum absolute feature discrepancy 3.18e-7 and train-mean baseline discrepancy 1.22e-7. Missing ratings do not enter the outcome moments. Independent execution of all three frozen configs reproduced their **complete result hashes and checkpoint hashes exactly**. The run implementation hash is `7935c5d0ee298673f945de9da610d7cee71f9ef7e92e1969013fdf3dc3cb4b7a`; contribution manifests, source/importer hashes, config/result digests and checkpoint-source identities were verified.

| Input | Completed run ID | Config SHA256 | Result SHA256 |
| --- | --- | --- | --- |
| EEG | `d2ce66c6-1430-4653-a3ec-a72e2d16944c` | `c66e443cb2343798a92d965124cf7003524eedce5361bd76e7aceb11ec344620` | `712dc79bca4d3b0f7dcc3fd246db5f7c82746cd903045cf55ad1576cceaae774` |
| Stage | `49b24588-1cbb-4670-96d3-4f2d4c4901e7` | `618bf3c5423b1a603901e8d47357d613c7f732121f8a9778454dc8f036e23503` | `78203ffe1fbc81540f45eab41ddda49ae40af4edb0efd976e99de01d17816d56` |
| QC | `fa770f41-cc8e-4276-b295-354b2cad261e` | `2d9c26b25b8ea9c7b395a0c0160898798686b51442bfbb2adf4777bc5a0a0be4` | `6ae881262b18cc20ad0d124e9c1173acaba97719963a41e9d473ff2c06d8caa2` |

| Input | Checkpoint SHA256 | Canonical API run-export SHA256 |
| --- | --- | --- |
| EEG | `98e3a1cd3b65bc656fe11979c937d3e431da6e301873cc198a6c4471b6120265` | `d7f4b8bad3d8793acc3b068806c8cd4ba10c3f52a117cce00d1895bb9d9fbc40` |
| Stage | `2aeba60b640e378c657b84d5587d55e80078403671c36182de7789bd08a5c13f` | `5f923b2085596cd18a33110ecc83a4850e2e0954318f444fb5ac1615fdb7f804` |
| QC | `e89e1633a1eb11ccf6c8e0755f3547fa696d9d92b393ea7862d020f0f58432e3` | `a9438ac6629d28ba513b0fc1c3cd31f3c1c693fd06b92c35b6bfaa4910d24180` |

All three safe JSON checkpoints were restored and produced 70 finite predictions for their original input rows. This verifies serialization/inference operation. Those checkpoints were fitted on all 70 admitted rows **after** held-out evaluation; inference on those same rows is in-sample and is not a new held-out test. `outcome_extrapolation` reflects rating coverage for the model-predicted class. For an unseen row, a false flag does not verify the true report category or establish that its rating falls within the measured Experience-only target scope.

Local full run exports are `tmp/dream-main-run.json`, `tmp/dream-stage-control-run.json`, and `tmp/dream-qc-control-run.json`; the structured review is `tmp/dream-independent-audit.json`. These files include local model weights/source provenance and remain ignored artifacts. The final small DREAM checkpoint uses the same shared two-objective architecture, but does not merge the earlier four-feature animal-data checkpoint or prove transfer between feature schemas. Content reconstruction, permanent memory storage and therapeutic outcomes were not tested.

## Reproduction and verification

From the repository root with the model Python dependencies installed:

```sh
.venv/bin/python services/signal-gateway/tools/dream_features.py audit
.venv/bin/python services/signal-gateway/tools/dream_features.py download
.venv/bin/python services/signal-gateway/tools/dream_features.py extract
.venv/bin/python -m unittest discover -s tests -p test_dream_features.py -v
```

`audit` refuses to overwrite a sealed selection. `.local/dream-pilot/selection.json` records all 324 source cases as selected or excluded, including uncertain report codes. `extraction-contract.json` pins feature/QC parameters before waveform reads. `download-manifest.json` records every selected EDF SHA. `features.json` retains quality-passed rows, gate status and every exclusion. When the final gate passes, `training-input.json` is the local file for import through the unified model panel; no private data is uploaded to the hosted site.

The regression suite checks true category separation, missing outcomes, identity/schema agreement, selection invariance to rating magnitude, stage/whole-person gates, source sealing, cumulative download bounds, mandatory 206 responses, EDF calibration and unit conversion, alpha/beta sinusoid band-power conservation, truncation/missing channels and clipping/flatline rejection. NumPy spectral tests skip explicitly in a Python environment that lacks model dependencies; metadata and boundary tests still run.

Extraction and model metrics must be reported from the actual local artifacts after completion, including post-QC class counts and observed-rating coverage. A classifier score is evidence about this declared report task and sample only; it does not establish dream-content reconstruction, permanent memory storage, or a clinical effect.
