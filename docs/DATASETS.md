# Research datasets and public DREAM metadata

The library distinguishes a source link, public metadata, downloaded signals, analyzed features, and a reproduced result. Current library references do not imply that raw recordings have been loaded.

## DREAM registry

The [DREAM primary data paper](https://www.nature.com/articles/s41467-025-61945-1) describes an initial collection of 20 datasets, 505 participants and 2,643 awakenings with paired sleep M/EEG and subjective experience classifications. Individual packages may contain additional report text and metadata; content varies by study.

`GET /api/public-data/dream` retrieves the current registry from the [public Figshare API](https://api.figshare.com/v2/articles/22133105) and its `Datasets.csv` file. It returns only narrow dataset-level summaries: active source ID, title, amendment, record/subject counts, access label, source link and provenance. It does not fetch raw PSG, individual dream reports, or participant-level demographic records. The workstation refresh is an explicit metadata action.

The registry was checked on 6 October 2026: version 9 contains 23 registry rows representing 20 distinct dataset IDs. Additional rows are amendments, not additional studies. The latest Tononi amendment describes 287 records; older revisions are excluded. Keep the latest amendment with `Revoked = FALSE` and `Latest amendment = TRUE`, and reject duplicate active IDs or a changed schema. Participant counts cannot be summed as a unique-person count because study cohorts may overlap.

The route permits only the fixed public registry and the registry's numeric `ndownloader.figshare.com/files/…` metadata endpoint, applies request timeouts and a 2 MB metadata limit, validates CSV structure, and exposes no caller-controlled upstream URL. Fetch failures return an error; previous metadata shown in the UI retains its fetch time. The route's source MD5 is upstream provenance, not a claim that Morpheus independently verified file integrity.

The [registry](https://bridges.monash.edu/articles/dataset/The_DREAM_database/22133105) is CC BY 4.0. The registry's license does not automatically cover each linked package, software or third-party material. Inspect each source's consent/access conditions, license and dataset version before download. Restricted datasets remain marked private and link to the public registry rather than being treated as anonymously downloadable.

## Labels are measurements

| Registry label | Default interpretation |
| --- | --- |
| `Experience` | The participant reports an experience. |
| `No experience` | The participant reports an absence of experience. This is a report, not direct proof of absence. |
| `Without recall` | Reported experience without recalled content; preserve separately. |
| `No experience or without recall` | Ambiguous for the experience-versus-no-experience endpoint; exclude by default. |
| `Unknown` | Missing or unknown target; exclude by default. |

Sleep stage is distinct from a dream report. A REM/NREM classifier does not by itself decode content. A dataset containing sleep EEG without reports cannot provide supervised dream-content labels. Dataset identity, subject identity and session identity should remain explicit throughout splitting, and preprocessing should be fit using training folds only.

## Other referenced sources

| Source | Intended role | Access and license boundary |
| --- | --- | --- |
| [Human Dream Decoding](https://github.com/KamitaniLab/HumanDreamDecoding) | Category-level sleep-onset fMRI reproduction | Official repository states ODC BY data and MIT scripts; Brainliner download availability remains unchecked. |
| [Infant encoding data](https://doi.org/10.5061/dryad.b2rbnzsr2) | Developmental encoding research | Referenced by the authors; Dryad license and files have not been independently inspected here. |
| [Deep image reconstruction, ds001506](https://openneuro.org/datasets/ds001506) | Viewed-image / imagery features | Check the snapshot, images, pretrained weights and repository terms separately. |
| [Semantic decoding, ds004510](https://openneuro.org/datasets/ds004510) and [ds003020](https://openneuro.org/datasets/ds003020) | Subject-specific language and cross-task semantics | Public source links are in the paper. Resistance-experiment data were not publicly released; confirm each snapshot's terms. |
| [Natural Scenes Dataset](https://www.naturalscenesdataset.org/) | Awake-perception and recognition benchmarks | Follow NSD access conditions and separate COCO image rights. Keep repeated image identities in one evaluation partition. |

The current DREAM adapter is a metadata registry connector. Raw-file acquisition, MNE/BIDS/NWB conversion, full signal quality review, model training and replication require separately versioned pipelines and artifacts.
