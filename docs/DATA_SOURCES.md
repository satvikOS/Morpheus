# Public Neuroscience Data Sources

Morpheus uses read-only adapters around public neuroscience repositories. Adapters normalize upstream responses into a shared workstation dataset model.

## Wired adapters

### DANDI Archive
Route: `/api/public-data/dandi`

Primary use:
- NWB
- electrophysiology
- optical physiology
- public neurophysiology datasets

### OpenNeuro
Route: `/api/public-data/openneuro`

Primary use:
- BIDS datasets
- MRI / fMRI
- EEG / MEG / iEEG where available
- public neuroimaging baselines

### NeuroVault
Route: `/api/public-data/neurovault`

Primary use:
- statistical brain maps
- atlases
- parcellations
- neuroimaging collections

### Allen Brain Atlas
Route: `/api/public-data/allen`

Primary use:
- anatomical ontology
- human brain reference structures
- molecular / gene-expression atlas context

### Unified catalog
Route: `/api/public-data/catalog`

Queries the adapters independently and reports per-source health/latency. A failing upstream source is isolated from the remaining sources.

## Sources requiring credentials or controlled access

Datasets that require authentication, data-use agreements, controlled-access credentials, or participant-level authorization must not be represented as anonymously live. Add them only through an explicit credentialed connector and track their data-use terms.
