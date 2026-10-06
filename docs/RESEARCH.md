# Research library and evidence boundaries

Morpheus investigates how much experience-specific information remains measurable after ordinary recall changes. The platform accepts ambitious hypotheses and evaluates bounded predictions. The universal claim that every experience is permanently recorded is not established by this software or the cited studies.

The workstation's Research library connects primary studies, data sources, methods and all seven existing hypotheses. The source of truth is `lib/research-registry.ts`; `GET /api/research/library?q=memory&domain=memory` provides a searchable, typed registry. Eight research areas include dreams, memory access, visual imagery, language, early memory, art and cinema, disease research, and optogenetics.

## What statuses mean

| Status | Meaning |
| --- | --- |
| `NOT_REVIEWED` | A reference has not received source review. |
| `SOURCE_REVIEWED` | Primary publication summary and relevant source links were checked; a full methods audit remains open. |
| `METHODS_REVIEWED` | Reserved for a recorded review of the complete methods and evaluation. No current paper is assigned this status. |
| `NOT_REPRODUCED` | Morpheus has not independently executed and reproduced the study. |
| `ENGINEERING_BASELINE` | Software implements a baseline. Scientific validity still depends on the data and study design. |
| `REPRODUCED` | Reserved for a versioned reproduction artifact, independent evaluation and evidence record. No external model currently has this status. |

Source checking occurred on 6 October 2026. None of the external research implementations has been reproduced in this workstation. Links to code and datasets are references, not installed models or analyzed data. License checks are explicitly bounded: verified terms are named; other entries instruct the researcher to inspect upstream terms.

## Evidence informing the program

| Study | What it measures | Relevance and boundary |
| --- | --- | --- |
| [Horikawa et al., 2013](https://pubmed.ncbi.nlm.nih.gov/23558170/) | Sleep-onset fMRI and reported object categories | Supports category-level sleep imagery decoding under measured conditions. Does not demonstrate dream video or recovery of old dreams. |
| [Konkoly et al., 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8162929/) | Intentional signals during verified lucid REM | Supports constrained two-way communication in some dreamers. Most attempts did not yield a response. |
| [Wong et al., 2025](https://www.nature.com/articles/s41467-025-61945-1) | Paired M/EEG and awakening experience reports | Offers a multi-study resource for report-status classification. Absence of recall is a separate category. |
| [Ryan et al., 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC5583719/) | Reactivation of tagged mouse fear-memory ensembles after induced amnesia | Demonstrates retained learned information under one form of impaired access; does not establish universal storage. |
| [Guskjolen et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29983316/) | Reactivation of infant-learning ensembles in mice | Supports recovery of some learned information over a tested interval. It cannot verify human prenatal autobiographical recall. |
| [Yates et al., 2025](https://pubmed.ncbi.nlm.nih.gov/40112047/) | Infant hippocampal activity and short-delay image recognition behavior | Finds encoding-related signals around one year of age. Decades-long retention and rich autobiographical encoding were not tested. |
| [Partanen et al., 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC3773755/) | Newborn responses after prenatal sound exposure | Supports prenatal auditory learning. Adult recall of a womb episode is a different question. |
| [Ko et al., 2025](https://www.nature.com/articles/s41586-025-08993-1) | Mouse engram reorganization | Shows that persistent memory can change in precision and generalize. Retaining gist does not establish retention of every detail. |
| [Shen et al., 2019](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1006633) | fMRI features and image reconstruction | Supports viewed-image and limited artificial-shape imagery reconstruction. Generative priors need explicit controls. |
| [Tang et al., 2023](https://www.nature.com/articles/s41593-023-01304-9) | Individually trained fMRI semantic decoding | Supports semantic reconstruction under cooperation and calibration. Semantic similarity does not establish exact wording or historic dream recovery. |
| [Allen et al., 2022](https://www.nature.com/articles/s41593-021-00962-x) | Repeated natural-image perception and recognition | Provides an awake-perception benchmark. It does not contain dream recordings. |

## Optogenetics and Karl Deisseroth

[Stanford Medicine's 5 October 2026 announcement](https://med.stanford.edu/news/all-news/2026/10/deisseroth-nobel-prize.html) reports that Karl Deisseroth shares the 2026 Nobel Prize in physiology or medicine with Peter Hegemann and Georg Nagel for discoveries leading to optogenetics. Award recognition is stored separately from experimental evidence and does not promote any Morpheus model to scientific validation.

[Boyden, Zhang, Bamberg, Nagel and Deisseroth (2005)](https://pubmed.ncbi.nlm.nih.gov/16116447/) established millisecond optical control of mammalian neuronal activity using channelrhodopsin-2. The library credits the paper's full author group and recognizes that optogenetics developed through several foundational contributions.

[Marshel, Kim and colleagues (2019)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6711485/), with Deisseroth as senior author, used targeted optical perturbation of mouse cortical ensembles to study perception-linked dynamics and behavior. This causal evidence complements the engram-reactivation work of Ryan and colleagues. It differs from correlational observation with human EEG or fMRI and does not recover a subjective historical scene.

[Kauvar, Richman, Liu and colleagues (2025)](https://pubmed.ncbi.nlm.nih.gov/40440375/), with Deisseroth among the senior authors, studied conserved fast and sustained responses to brief adverse stimuli in humans and mice. A sustained affective state is relevant to the transition from sensory experience to emotion; it is not evidence of permanent recording. Human observations and animal perturbations remain separate evidence categories.

These methods are research references. Morpheus does not implement genetic targeting, optical neural stimulation, or a human therapeutic intervention.

## Three bounded experiments

1. **Report-status classification (H-DECODE).** Use eligible DREAM EEG windows and distinguish reported experience from reported no experience. Keep experience without recall, ambiguous labels and unknown labels separately. Hold out entire participants, then sites for a cross-site claim; compare EEG-plus-stage features with stage-only and artifact/nuisance baselines. Record balanced accuracy, class confusion, subject-bootstrap confidence intervals and an exchangeability-respecting permutation null. A positive result classifies report status, not a dream's complete content.
2. **Prospective recurrence (H-CONTINUITY / H-REINSTATE).** Seal immediate raw reports before reviewing earlier records. Predefine structural similarity and continuation criteria, score blind, include all unsuccessful trials, and compare with length-, topic- and time-matched nonmatches. Randomize intention and interruption conditions when testing their effect. Report candidate ranks, effect size, uncertainty and permutation results. This tests recorded report structure; a neural reinstatement claim requires independent neural evidence.
3. **Information after failed free recall (H-PERSIST / H-ACCESS).** Collect prospective encoding ground truth and neural measurements, then test fixed delays such as 1 day, 1 week and 1 month. Define free-recall failure in advance, keep recognition as a separate outcome, and evaluate event identification on held-out stimuli or trials with cue-only, never-experienced and shuffled-signal controls. Fit preprocessing only on training data. A positive outcome establishes measurable information for a specified feature and interval; a sensitive negative outcome limits that method. Neither establishes what happens to all experiences forever.

The existing centroid worker is an engineering baseline. These protocols add requirements; their inclusion in the library does not imply that recordings, training, participant recruitment or scientific validation have already occurred.

## Art, cinema and disease research

Perception, imagery, language and affect provide paths toward creative tools, film analysis and rendering of voluntarily supplied dream reports. Report-inspired visual art can be valuable on its own. A scientific reconstruction must separately show that neural input constrains identified features beyond a generative prior and retain uncertainty.

Disease-associated changes in memory access and representation are a future research domain. Animal circuit findings and human observational patterns motivate questions; they do not establish diagnosis, treatment, disease defeat or clinical efficacy. Disease datasets require their own cohort definitions, evaluation and replication.
