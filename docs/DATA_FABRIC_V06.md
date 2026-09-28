# Morpheus Workstation v0.6 — Neuro Spatial and Public Data Fabric

## Why the 3D viewport exists

The Neuro Spatial workspace is for actual brain-space data, not generic 3D demonstration geometry.

v0.6 removes the generic scene-geometry mode from the operational viewport and makes brain volumes the primary surface.

The preset loader currently exposes public NIfTI volumes through a Morpheus-controlled proxy:

- MNI152 FreeSurfer-conformed 1 mm reference volume
- Harvard–Oxford cortical + subcortical 2 mm atlas
- Harvard–Oxford subcortical 1 mm atlas
- Schaefer + Neuromorphometrics 3 mm parcellation

The upstream records are NeuroVault entries. Their original source records remain visible in the UI.

The existing local NIfTI importer remains available for subject-specific or laboratory volumes.

## Public data knowledge graph

The Public Data workspace now keeps a session-scoped graph of unique records returned by the live public adapters.

Every ingest cycle:

1. queries the configured anonymous APIs,
2. de-duplicates records by source/id/version,
3. adds unseen datasets to the retained graph,
4. connects each dataset to its repository,
5. connects datasets to observed modality nodes,
6. keeps the graph bounded to avoid unbounded browser memory growth.

The graph is a visualization of metadata relationships and ingestion activity. It is not itself an upstream scientific knowledge graph and must not be confused with EBRAINS KG.

## Live anonymous adapters

Current anonymous read adapters:

- DANDI REST API
- OpenNeuro GraphQL
- NeuroVault REST API
- Allen Brain Map RMA API
- Zenodo REST API

## Explicit access-gated sources

The workstation also represents important neuroscience sources that cannot truthfully be treated as anonymous live APIs:

- EBRAINS Knowledge Graph — authenticated API
- Human Connectome Project / ConnectomeDB — registration and data-use terms
- UK Biobank — controlled research access
- Brainnetome Atlas — downloadable data with licence restrictions
- Child Mind Institute Healthy Brain Network — federated portal
- BICCN / Brain Image Library — federated project resources
- Max Planck institute resources — multiple repositories, including OpenNeuro
- MNI / The Neuro — distributed open-science resources

These nodes are visible in the source matrix but are not shown as "offline" failures. They are classified by access mode.

## Clock guard

The hosted Vercel gateway is not a stable acquisition clock domain.

v0.6 therefore exposes a gateway instance identifier and a `stable_for_markers` capability flag. Browser clock estimation is refused when the gateway reports a hosted/serverless runtime or when repeated timing probes come from inconsistent gateway instances.

This prevents an unstable hosted simulation service from presenting a large clock-offset artifact as if it were synchronization uncertainty.

For real experiments, synchronization remains a local-gateway concern and any protocol demanding tighter bounds than the measured uncertainty should use hardware triggering / DAQ-clock synchronization.

## Human factors

The v0.6 UI moves further away from decorative "HUD" styling:

- generic 3D primitives are removed from the research viewport,
- renderer diagnostics are removed from the active compact signal canvas,
- the simulation marker is reduced to a non-obscuring corner indicator,
- source access state is differentiated from outages,
- typography and neutral surfaces are increased for readability,
- operational amber/red remain reserved for warnings and faults.

These are engineering design inputs. They are not claims of medical-device certification or clinical compliance.
