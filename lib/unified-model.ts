/** A reviewed research-to-training graph for one model, with no metadata-to-code execution. */
export const UNIFIED_GRAPH_SCHEMA = "morpheus-unified-model-graph-v1";
export const UNIFIED_MANIFEST_SCHEMA = "morpheus-unified-contributions-v1";
export const UNIFIED_GRAPH_VERSION = "1.1.0";
export const UNIFIED_MODEL_ID = "morpheus-shared-encoder";
export const UNIFIED_RECIPE_ID = "morpheus-shared-representation-v1";
export const UNIFIED_MODEL_VERSION = "1.1.0";
export type UnifiedSlotId = "state-classification" | "measured-outcome-regression" | "training-fold-scaling" | "held-out-unit-evaluation" | "perturbation-controls" | "shared-representation-backbone" | "joint-multitask-objective";
export type ContributionStatus = "ADMITTED" | "PENDING_IMPLEMENTATION" | "PENDING_REVIEW";
type IntegrationStatus = "IMPLEMENTED_AND_TESTED" | "CONTRACT_DEFINED" | "NOT_IMPLEMENTED";
type RuntimeBinding = { path: string; symbol: "train_unified" | "validate_unified_request"; component: string; implementationVersion: string };
type ContributionSource = { paperId: string; doi: string; url: string; relationship: "application_context_only" | "implemented_technique_adaptation"; sourceReview: "PRIMARY_SOURCE_CONTEXT_REVIEWED" | "PRIMARY_SOURCE_TECHNIQUE_REVIEWED" };
export type UnifiedContribution = {
  id: string; version: string; title: string;
  status: ContributionStatus; integrationStatus: IntegrationStatus;
  role: "ENGINEERING_ADAPTATION" | "ENGINEERING_CONTROL" | "PROPOSED_EXTENSION";
  slotIds: UnifiedSlotId[]; sourcePaperIds: string[]; sources: ContributionSource[];
  modelImpact: string; runtimeBindings: RuntimeBinding[]; verification: string[];
  review: { scope: "ENGINEERING_MAPPING_REVIEWED" | "REVIEW_REQUIRED"; paperMethodsReproduced: false };
  compatibility: { inputContract: string; dataLicense: string; modalities: string[] };
  limitations: string[]; requestedExtension?: string;
};

// Admission covers the bounded software adaptation, not reproduction of a source experiment.
const integrationStatus: IntegrationStatus = "IMPLEMENTED_AND_TESTED";
const integrationAdmission: ContributionStatus = "ADMITTED";
const adapterPath = "services/signal-gateway/app/unified_model.py";
const implementationVersion = "morpheus-shared-representation-1.1.0";
const binding = (component: string, symbol: RuntimeBinding["symbol"] = "train_unified"): RuntimeBinding => ({ path: adapterPath, symbol, component, implementationVersion });
const contextSource = (paperId: string, doi: string, url: string): ContributionSource => ({ paperId, doi, url, relationship: "application_context_only", sourceReview: "PRIMARY_SOURCE_CONTEXT_REVIEWED" });
const vaswani: ContributionSource = { paperId: "vaswani-2017", doi: "10.48550/arXiv.1706.03762", url: "https://arxiv.org/abs/1706.03762", relationship: "implemented_technique_adaptation", sourceReview: "PRIMARY_SOURCE_TECHNIQUE_REVIEWED" };
const caruana: ContributionSource = { paperId: "caruana-1997", doi: "10.1023/A:1007379606734", url: "https://link.springer.com/article/10.1023/A:1007379606734", relationship: "implemented_technique_adaptation", sourceReview: "PRIMARY_SOURCE_TECHNIQUE_REVIEWED" };
const guo = contextSource("guo-inagaki-2017", "10.1038/nature22324", "https://doi.org/10.1038/nature22324");
const horikawa = contextSource("horikawa-2013", "10.1126/science.1234330", "https://pubmed.ncbi.nlm.nih.gov/23558170/");
const wong = contextSource("wong-2025", "10.1038/s41467-025-61945-1", "https://www.nature.com/articles/s41467-025-61945-1");
const compatibility = { inputContract: "morpheus-shared-features-v1", dataLicense: "Source-specific rights must permit local analysis; public pilot records CC-BY-4.0 attribution.", modalities: ["explicit fixed-width neural features", "measured task labels and outcomes"] };
const engineeringReview = { scope: "ENGINEERING_MAPPING_REVIEWED", paperMethodsReproduced: false } as const;

export const unifiedSlots = [
  { id: "state-classification", title: "Predefined label classification", kind: "TRAINABLE_OBJECTIVE", status: integrationStatus,
    runtimeBindings: [binding("SharedModel.classification")], outputs: ["Held-out balanced accuracy", "Classification-head parameters"],
    interpretation: "The public pilot target is stimulated/control, not a decoded dream or a verified internal mental state." },
  { id: "measured-outcome-regression", title: "Measured neural outcome prediction", kind: "TRAINABLE_OBJECTIVE", status: integrationStatus,
    runtimeBindings: [binding("SharedModel.regression")], outputs: ["Held-out MAE and train-mean baseline MAE", "Regression-head parameters"],
    interpretation: "Outcome units come from the dataset contract; prediction is observational, not a treatment effect." },
  { id: "training-fold-scaling", title: "Training-fold preprocessing", kind: "PREPROCESSING_CONTROL", status: integrationStatus,
    runtimeBindings: [binding("fit.preprocessing")], outputs: ["Per-fold feature and outcome scaling parameters"],
    interpretation: "Held-out units do not fit normalization. Final all-data fitting is distinguished from held-out evaluation." },
  { id: "held-out-unit-evaluation", title: "Whole independent-unit holdout", kind: "EVALUATION_CONTROL", status: integrationStatus,
    runtimeBindings: [binding("folds")], outputs: ["Disjoint train/test row IDs", "Per-unit metrics", "Unit-bootstrap balanced-accuracy interval"],
    interpretation: "Public pilot units are animals; repeated trials and neurons are not independent animals." },
  { id: "perturbation-controls", title: "Perturbation provenance and input timing", kind: "DATA_ADMISSION_CONTROL", status: integrationStatus,
    runtimeBindings: [binding("source_design_and_feature_gates", "validate_unified_request")], outputs: ["Source/license/timing/assignment contract", "Measured label and outcome definitions"],
    interpretation: "An observational pre-event feature contract and stimulus/control labels do not create a causal objective or verified optical onset." },
  { id: "shared-representation-backbone", title: "Feature-token self-attention representation", kind: "TRAINABLE_BACKBONE", status: integrationStatus,
    runtimeBindings: [binding("SharedModel.backbone")], outputs: ["One shared Transformer state_dict"],
    interpretation: "An adapted encoder block over numerical feature tokens, not the original paper's complete translation architecture or pretrained weights." },
  { id: "joint-multitask-objective", title: "Joint shared-parameter learning", kind: "TRAINABLE_OBJECTIVE", status: integrationStatus,
    runtimeBindings: [binding("fit.joint_loss")], outputs: ["Joint optimizer objectives and final training loss"],
    interpretation: "Both measured targets update the same representation. Benefit over separate single-task encoders has not yet been established by ablation." },
] as const;

export const unifiedContributions: UnifiedContribution[] = [
  { id: "morpheus-c-category-objective-v1", version: "1.0.0", title: "Category supervision on the shared latent", status: integrationAdmission, integrationStatus,
    role: "ENGINEERING_ADAPTATION", slotIds: ["state-classification"], sourcePaperIds: ["guo-inagaki-2017"], sources: [guo],
    modelImpact: "A linear classification head backpropagates cross-entropy through the same encoder used by outcome regression.", runtimeBindings: [binding("SharedModel.classification")],
    verification: ["tests/test_unified_model.py::test_joint_learning_unit_holdout_and_checkpoint_integrity"], review: engineeringReview, compatibility,
    limitations: ["The source provides task/data context; its full method, weights and biological findings are not reproduced.", "Current public-data classes describe recorded stimulus/control conditions."] },
  { id: "morpheus-c-measured-response-objective-v1", version: "1.0.0", title: "Measured-response supervision on the shared latent", status: integrationAdmission, integrationStatus,
    role: "ENGINEERING_ADAPTATION", slotIds: ["measured-outcome-regression"], sourcePaperIds: ["guo-inagaki-2017"], sources: [guo],
    modelImpact: "A second linear head backpropagates masked training-scaled outcome MSE from observed measurements into the same feature-token representation, weighted 0.5 in the joint loss.", runtimeBindings: [binding("SharedModel.regression")],
    verification: ["tests/test_unified_model.py::test_joint_learning_unit_holdout_and_checkpoint_integrity"], review: engineeringReview, compatibility,
    limitations: ["Predicting a measured response is not estimating an intervention's causal effect.", "The pilot response is a bounded firing-rate summary, not a memory-content target."] },
  { id: "morpheus-c-training-fold-scaling-v1", version: "1.0.0", title: "Leakage-controlled feature and outcome scaling", status: integrationAdmission, integrationStatus,
    role: "ENGINEERING_CONTROL", slotIds: ["training-fold-scaling"], sourcePaperIds: [], sources: [],
    modelImpact: "Each held-out fold fits feature means/scales and the regression-target scale only on observed training measurements; missing targets retain their classification labels.", runtimeBindings: [binding("fit.preprocessing")],
    verification: ["tests/test_unified_model.py::test_joint_learning_unit_holdout_and_checkpoint_integrity"], review: engineeringReview, compatibility,
    limitations: ["A software validation control; no paper-specific algorithm is claimed introduced."] },
  { id: "morpheus-c-held-out-unit-validation-v1", version: "1.0.0", title: "Whole-subject evaluation and unit weighting", status: integrationAdmission, integrationStatus,
    role: "ENGINEERING_CONTROL", slotIds: ["held-out-unit-evaluation"], sourcePaperIds: ["guo-inagaki-2017"], sources: [guo],
    modelImpact: "One full independent animal is held out per fold; unit/class weighting prevents abundant trials being treated as abundant animals.", runtimeBindings: [binding("folds")],
    verification: ["tests/test_unified_model.py::test_joint_learning_unit_holdout_and_checkpoint_integrity"], review: engineeringReview, compatibility,
    limitations: ["The public pilot has a small number of animals. This is exploratory generalization within a defined circuit/task dataset."] },
  { id: "morpheus-c-perturbation-control-v1", version: "1.0.0", title: "Pre-event inputs and observational control provenance", status: integrationAdmission, integrationStatus,
    role: "ENGINEERING_CONTROL", slotIds: ["perturbation-controls"], sourcePaperIds: ["guo-inagaki-2017"], sources: [guo],
    modelImpact: "The same training run records input timing, stimulus/control target definition, source version, source rights and observational assignment.", runtimeBindings: [binding("source_design_and_feature_gates", "validate_unified_request")],
    verification: ["tests/test_unified_model.py::test_invalid_timing_schema_units_targets_and_work_budget"], review: engineeringReview, compatibility,
    limitations: ["The inspected public files have no verified optical waveform onset; no-stimulation controls are not relabeled sham.", "These admission controls do not remove confounding or enable stimulation hardware."] },
  { id: "morpheus-c-transformer-backbone-v1", version: "1.0.0", title: "Feature-token Transformer backbone", status: integrationAdmission, integrationStatus,
    role: "ENGINEERING_ADAPTATION", slotIds: ["shared-representation-backbone"], sourcePaperIds: ["vaswani-2017"], sources: [vaswani],
    modelImpact: "A self-attention encoder block mixes learned feature-identity/value tokens into the one latent used by both output heads.", runtimeBindings: [binding("SharedModel.backbone")],
    verification: ["tests/test_unified_model.py::test_joint_learning_unit_holdout_and_checkpoint_integrity"], review: engineeringReview, compatibility,
    limitations: ["Adapts Transformer self-attention to fixed numerical features; it does not reproduce the original sequence-to-sequence translation model, corpus, architecture size or benchmark.", "No source-paper pretrained weights are imported."] },
  { id: "morpheus-c-joint-multitask-v1", version: "1.0.0", title: "Shared-representation multitask optimization", status: integrationAdmission, integrationStatus,
    role: "ENGINEERING_ADAPTATION", slotIds: ["joint-multitask-objective"], sourcePaperIds: ["caruana-1997"], sources: [caruana],
    modelImpact: "Parallel classification and regression supervision backpropagate a joint loss through one shared representation and optimizer.", runtimeBindings: [binding("fit.joint_loss")],
    verification: ["tests/test_unified_model.py::test_joint_learning_unit_holdout_and_checkpoint_integrity"], review: engineeringReview, compatibility,
    limitations: ["Implements the shared-representation multitask technique, not Caruana's original task domains or experiments.", "The particular CE/MSE objectives and 0.5 regression weight are Morpheus choices; joint-training gains over single-task controls remain unmeasured."] },
  { id: "morpheus-p-sleep-decoding-v1", version: "1.0.0", title: "Sleep report-category data adaptation", status: "PENDING_REVIEW", integrationStatus: "NOT_IMPLEMENTED",
    role: "PROPOSED_EXTENSION", slotIds: [], sourcePaperIds: ["horikawa-2013", "wong-2025"], sources: [horikawa, wong],
    modelImpact: "No current training effect. Sleep data need compatible licensed features, experience/report categories and subject-held-out benchmark controls.", runtimeBindings: [], verification: [], review: { scope: "REVIEW_REQUIRED", paperMethodsReproduced: false },
    compatibility: { inputContract: "not_adapted", dataLicense: "Each source dataset and report/stimulus target requires separate terms review.", modalities: ["sleep EEG", "sleep fMRI", "report categories"] },
    requestedExtension: "sleep-report-category-adapter", limitations: ["A generic classification head does not mean the model has trained on these publications or decoded a dream."] },
  { id: "morpheus-p-visual-reconstruction-v1", version: "1.0.0", title: "Visual reconstruction extension", status: "PENDING_REVIEW", integrationStatus: "NOT_IMPLEMENTED",
    role: "PROPOSED_EXTENSION", slotIds: [], sourcePaperIds: ["shen-2019"], sources: [contextSource("shen-2019", "10.1371/journal.pcbi.1006633", "https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1006633")],
    modelImpact: "No training effect until a licensed fMRI/visual target adapter, reconstruction objective and controls are implemented and reviewed.", runtimeBindings: [], verification: [], review: { scope: "REVIEW_REQUIRED", paperMethodsReproduced: false },
    compatibility: { inputContract: "not_adapted", dataLicense: "Dataset, stimuli, upstream code and weights require separate review.", modalities: ["fMRI", "visual features"] },
    requestedExtension: "visual-reconstruction-objective", limitations: ["Not an active decoder, loss, head or checkpoint contribution."] },
  { id: "morpheus-p-semantic-decoding-v1", version: "1.0.0", title: "Semantic decoding extension", status: "PENDING_REVIEW", integrationStatus: "NOT_IMPLEMENTED",
    role: "PROPOSED_EXTENSION", slotIds: [], sourcePaperIds: ["tang-2023"], sources: [contextSource("tang-2023", "10.1038/s41593-023-01304-9", "https://www.nature.com/articles/s41593-023-01304-9")],
    modelImpact: "No training effect until a reviewed subject-specific language/neural adapter and measured held-out semantic objective exist.", runtimeBindings: [], verification: [], review: { scope: "REVIEW_REQUIRED", paperMethodsReproduced: false },
    compatibility: { inputContract: "not_adapted", dataLicense: "Neural data, language prior and upstream code require separate review.", modalities: ["fMRI", "language targets"] },
    requestedExtension: "semantic-sequence-objective", limitations: ["A source reference is not a semantic head or pretrained model in this encoder."] },
];

export const unifiedModel = {
  id: UNIFIED_MODEL_ID, recipeId: UNIFIED_RECIPE_ID, version: UNIFIED_MODEL_VERSION,
  status: "LOCAL_ADAPTER_IMPLEMENTED", trainingStatus: "PUBLIC_RECORDING_PILOT_EXECUTED", adapterPath,
  validation: { fixture: "Joint learning, unit holdout, deterministic checkpoint integrity, input rejection and cancellation tested.",
    publicPilot: { datasetId: "dandi:000009", datasetVersion: "0.220126.1903", rows: 1776, independentUnits: 7, parameters: 8899,
      hiddenWidth: 32, epochs: 30, balancedAccuracy: 0.481681918250323, chance: 0.5, regressionMae: 1.960307512, regressionTrainMeanBaselineMae: 1.973141572,
      regressionTrainMedianBaselineMae: 1.962724616, regressionTrainFoldRidgeMae: 1.848442605,
      evidence: "public-recording-engineering-pilot", interpretation: "Classification is near chance; the shared model does not beat the linear regression control. This run verifies engineering execution, not biological validation or multitask superiority." } },
  execution: { plane: "local-science-adapter", endpoint: "/models/runs", verb: "POST", enabledBy: "MORPHEUS_MODEL_RUN_DIR", privateInputs: "loopback-only" },
  architecture: {
    backbone: { name: "Feature-token Transformer", featureValueProjection: "linear scalar-to-latent", featureIdentity: "learned ordered feature embeddings", encoderLayers: 1, attentionHeads: 4, activation: "GELU", pooling: "mean feature-token pooling followed by LayerNorm", hiddenWidths: [16, 32, 64] },
    heads: [{ id: "classification-head", slotId: "state-classification", type: "linear", loss: "cross-entropy", weight: 1 }, { id: "outcome-head", slotId: "measured-outcome-regression", type: "linear", loss: "masked training-scaled mean squared error on observed measurements", weight: 0.5 }],
    losses: { joint: "cross_entropy_all_labels + 0.5 * masked_outcome_mse", sharedParameters: "Both heads update one encoder; this is joint training, not result fusion from separate tools." },
    optimization: { optimizer: "AdamW", learningRate: 0.003, weightDecay: 0.0001, gradientNormClip: 5, batchSize: 64, device: "CPU", threads: 1, seedRecorded: true },
    nodes: [{ id: "input", title: "Compatible neural features", kind: "INPUT" }, { id: "fold-scaling", title: "Training-fold scaling", kind: "PREPROCESSING" }, { id: "shared-encoder", title: "Shared feature-token Transformer", kind: "BACKBONE" }, { id: "classification-head", title: "Classification head", kind: "HEAD" }, { id: "outcome-head", title: "Measured-outcome head", kind: "HEAD" }, { id: "joint-loss", title: "Joint training loss", kind: "OBJECTIVE" }, { id: "whole-unit-evaluation", title: "Whole-subject holdout", kind: "EVALUATION" }],
    edges: [{ from: "input", to: "fold-scaling", relation: "training-only fit" }, { from: "fold-scaling", to: "shared-encoder", relation: "common representation input" }, { from: "shared-encoder", to: "classification-head", relation: "shared latent" }, { from: "shared-encoder", to: "outcome-head", relation: "shared latent" }, { from: "classification-head", to: "joint-loss", relation: "cross-entropy" }, { from: "outcome-head", to: "joint-loss", relation: "0.5 * scaled MSE" }, { from: "joint-loss", to: "shared-encoder", relation: "joint parameter gradients" }, { from: "classification-head", to: "whole-unit-evaluation", relation: "held-out label predictions" }, { from: "outcome-head", to: "whole-unit-evaluation", relation: "held-out measured outcomes" }],
  },
  inputContract: { id: "morpheus-shared-features-v1", rows: { min: 48, max: 4096, required: ["id", "subjectId", "sessionId", "features", "featureNames", "label", "outcome"], features: { min: 1, max: 32, orderedNamesCommon: true, finite: true, maximumMagnitude: 1000000 }, labels: { min: 2, max: 8, minimumPerUnitPerClass: 2 }, outcome: { finiteMeasurementOrExplicitNull: true, minimumObservedPerUnit: 2, missingTargetRule: "Exclude unmeasured targets from outcome scaling, regression loss and MAE; preserve classification labels." }, independentUnits: { field: "subjectId", min: 6, max: 16, publicPilotMeaning: "independent animal or human participant; never neuron, trial or awakening" } },
    source: { kind: "synthetic | public-neural-recording", required: ["datasetId", "datasetVersion", "featureSchema", "license"], publicUrl: "Required public HTTPS source for public-neural-recording" },
    design: { inputTiming: ["pre-task-event", "pre-awakening"], assignment: "observational", independentUnitsConfirmed: true }, evaluation: "Leave one entire independent subject out; fit feature scaling on all training rows and outcome scaling on observed training measurements; regression MAE covers observed targets only; final checkpoint refits all admitted rows after evaluation." },
  computeBound: { rows: 4096, features: 32, independentUnits: 16, epochs: { min: 10, max: 100, default: 30 }, hiddenWidth: { allowed: [16, 32, 64], default: 32 }, maximumOperationEstimate: 2000000000, estimate: "rows * epochs * (units + 1) * features * hiddenWidth^2", batchSize: 64, queuedJobs: 4, workers: 1 },
  checkpoint: { format: "JSON state_dict plus feature/outcome preprocessing", unsafePickleAccepted: false, contributionManifestRequired: true, interpretation: "Final all-data weights are not a held-out performance estimate." },
  limitations: ["This is a small bounded shared representation baseline, not an established universal model of the brain.", "Current source contexts do not imply that full paper methods or weights have been integrated.", "New methods require implementation, input/license review, tests, ablation and a versioned admission before they affect training.", "No audiovisual historic-dream recovery, universal memory storage or clinical efficacy is established."],
};

function freezeTree(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeTree(child);
  Object.freeze(value);
}
freezeTree(unifiedSlots); freezeTree(unifiedContributions); freezeTree(unifiedModel);

const slotIds = new Set<string>(unifiedSlots.map((slot) => slot.id));
export function validateContributionCatalog(catalog: UnifiedContribution[]) {
  if (!Array.isArray(catalog)) throw new Error("Contribution catalog must be an array.");
  const ids = new Set<string>();
  for (const contribution of catalog) {
    if (!contribution || !/^[a-z0-9][a-z0-9-]{1,127}$/.test(contribution.id) || ids.has(contribution.id) || !/^\d+\.\d+\.\d+$/.test(contribution.version)) throw new Error("Contributions need unique stable IDs and semantic versions.");
    ids.add(contribution.id);
    if (typeof contribution.title !== "string" || !contribution.title.trim() || typeof contribution.modelImpact !== "string" || !contribution.modelImpact.trim() || !["ENGINEERING_ADAPTATION", "ENGINEERING_CONTROL", "PROPOSED_EXTENSION"].includes(contribution.role)) throw new Error("A contribution requires an explicit reviewed model impact and role.");
    if (!["ADMITTED", "PENDING_IMPLEMENTATION", "PENDING_REVIEW"].includes(contribution.status) || !Array.isArray(contribution.slotIds) || new Set(contribution.slotIds).size !== contribution.slotIds.length || contribution.slotIds.some((slot) => !slotIds.has(slot))) throw new Error("Unknown or duplicate objective slot or contribution status.");
    if (!Array.isArray(contribution.sourcePaperIds) || !contribution.sourcePaperIds.every((id) => typeof id === "string" && id.trim() && id.length <= 300) || new Set(contribution.sourcePaperIds).size !== contribution.sourcePaperIds.length || !Array.isArray(contribution.sources) || new Set(contribution.sources.map((source) => source.paperId)).size !== contribution.sources.length || contribution.sources.some((source) => !contribution.sourcePaperIds.includes(source.paperId) || !/^10\.\d{4,9}\/[^\s?#]+$/i.test(source.doi) || !source.url?.startsWith("https://") || !["application_context_only", "implemented_technique_adaptation"].includes(source.relationship) || source.sourceReview !== (source.relationship === "implemented_technique_adaptation" ? "PRIMARY_SOURCE_TECHNIQUE_REVIEWED" : "PRIMARY_SOURCE_CONTEXT_REVIEWED"))) throw new Error("Contribution source mapping is invalid.");
    if (!Array.isArray(contribution.runtimeBindings) || !Array.isArray(contribution.verification) || !contribution.verification.every((check) => typeof check === "string" && check.trim()) || !contribution.review) throw new Error("Contribution review and verification evidence is invalid.");
    if (contribution.status === "ADMITTED" && (contribution.integrationStatus !== "IMPLEMENTED_AND_TESTED" || contribution.role === "PROPOSED_EXTENSION" || contribution.review.scope !== "ENGINEERING_MAPPING_REVIEWED" || !contribution.slotIds.length || !contribution.runtimeBindings.length || !contribution.verification.length || contribution.sources.length !== contribution.sourcePaperIds.length)) throw new Error("Admission requires reviewed, implemented and tested bindings to actual slots.");
    if (contribution.status === "PENDING_IMPLEMENTATION" && (contribution.integrationStatus !== "CONTRACT_DEFINED" || contribution.review.scope !== "ENGINEERING_MAPPING_REVIEWED")) throw new Error("Reviewed implementation candidates require a defined contract, not executable status.");
    if (contribution.status === "PENDING_REVIEW" && (contribution.slotIds.length || contribution.runtimeBindings.length || contribution.integrationStatus !== "NOT_IMPLEMENTED")) throw new Error("Pending papers cannot acquire executable objective bindings.");
    if (contribution.review.paperMethodsReproduced !== false) throw new Error("This graph grants no paper-reproduction claim.");
    for (const runtime of contribution.runtimeBindings) {
      if (runtime.path !== adapterPath || runtime.implementationVersion !== implementationVersion || !unifiedSlots.some((slot) => contribution.slotIds.includes(slot.id) && slot.runtimeBindings.some((allowed) => allowed.symbol === runtime.symbol && allowed.component === runtime.component))) throw new Error("An objective binding must use an allowlisted local runtime symbol for its slot.");
    }
  }
  return true;
}
validateContributionCatalog(unifiedContributions);

export type UnifiedQuery = { q?: string; status?: ContributionStatus | "all"; slot?: UnifiedSlotId | "all"; paperId?: string; offset?: number; limit?: number; graphVersion?: string };
export function queryUnifiedContributions(query: UnifiedQuery = {}, catalog: UnifiedContribution[] = unifiedContributions) {
  const offset = query.offset ?? 0; const limit = query.limit ?? 25;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Contribution pages require a nonnegative offset and a limit from 1 to 100.");
  if (query.graphVersion && query.graphVersion !== UNIFIED_GRAPH_VERSION) throw new Error("The requested graph snapshot is unavailable; refresh before paging.");
  if (query.status && !["all", "ADMITTED", "PENDING_IMPLEMENTATION", "PENDING_REVIEW"].includes(query.status)) throw new Error("Unknown contribution status.");
  if (query.slot && query.slot !== "all" && !slotIds.has(query.slot)) throw new Error("Unknown objective slot.");
  const text = (query.q || "").trim().toLowerCase();
  if (text.length > 256 || (query.paperId?.length || 0) > 128) throw new Error("Contribution query is too long.");
  const filtered = catalog.filter((contribution) => (!query.status || query.status === "all" || contribution.status === query.status) && (!query.slot || query.slot === "all" || contribution.slotIds.includes(query.slot)) && (!query.paperId || contribution.sourcePaperIds.includes(query.paperId)) && (!text || [contribution.title, contribution.id, contribution.modelImpact, ...contribution.sourcePaperIds, ...contribution.slotIds, ...contribution.sources.map((source) => source.doi)].join(" ").toLowerCase().includes(text))).sort((a, b) => a.id.localeCompare(b.id));
  return { graphVersion: UNIFIED_GRAPH_VERSION, total: filtered.length, offset, limit, nextOffset: offset + limit < filtered.length ? offset + limit : null, contributions: filtered.slice(offset, offset + limit) };
}

/** Canonical payload hashing pins exact admission bindings; hashes do not establish source truth. */
export function canonicalUnifiedJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalUnifiedJson).join(",") + "]";
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalUnifiedJson((value as Record<string, unknown>)[key])).join(",") + "}";
  throw new Error("A contribution manifest requires finite, plain JSON values.");
}
export async function unifiedContributionManifest() {
  const admitted = unifiedContributions.filter((contribution) => contribution.status === "ADMITTED").sort((a, b) => a.id.localeCompare(b.id));
  const payload = { schema: UNIFIED_MANIFEST_SCHEMA, graphVersion: UNIFIED_GRAPH_VERSION, architectureVersion: UNIFIED_MODEL_VERSION,
    modelId: UNIFIED_MODEL_ID, recipeId: UNIFIED_RECIPE_ID,
    architecture: unifiedModel.architecture, inputContract: unifiedModel.inputContract, computeBound: unifiedModel.computeBound,
    contributions: admitted.map((contribution) => ({ id: contribution.id, version: contribution.version, role: contribution.role,
      slotIds: [...contribution.slotIds].sort(), sourcePaperIds: [...contribution.sourcePaperIds].sort(),
      sourceMappings: contribution.sources.map((source) => ({ paperId: source.paperId, relationship: source.relationship })).sort((a, b) => a.paperId.localeCompare(b.paperId)),
      runtimeBindings: contribution.runtimeBindings.map((runtime) => ({ ...runtime })).sort((a, b) => a.component.localeCompare(b.component)) })) };
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalUnifiedJson(payload)));
  const contentSha256 = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const manifest = { ...payload, contentSha256 };
  freezeTree(manifest);
  return manifest;
}

export function unifiedGraphSummary() {
  const admitted = unifiedContributions.filter((row) => row.status === "ADMITTED");
  return { admittedContributions: unifiedContributions.filter((row) => row.status === "ADMITTED").length,
    admittedTechniqueAdaptations: admitted.filter((row) => row.sources.some((source) => source.relationship === "implemented_technique_adaptation")).length,
    uniqueActiveSourcePapers: new Set(admitted.flatMap((row) => row.sourcePaperIds)).size,
    reviewedPendingImplementation: unifiedContributions.filter((row) => row.status === "PENDING_IMPLEMENTATION").length,
    pendingContributions: unifiedContributions.filter((row) => row.status === "PENDING_REVIEW").length,
    objectiveSlots: unifiedSlots.length, trainableHeads: unifiedModel.architecture.heads.length,
    publiclyDistributedCheckpoints: 0, interpretation: "Counts distinguish implemented training contributions, pending review and source papers. A local pilot checkpoint is separate from a publicly distributed or biologically validated model." };
}

export async function createUnifiedModelRunRequest(inputs: Record<string, unknown>, options: { seed?: number; epochs?: number; hiddenWidth?: number } = {}) {
  if (unifiedModel.status !== "LOCAL_ADAPTER_IMPLEMENTED" || unifiedContributions.some((row) => row.status === "PENDING_IMPLEMENTATION")) throw new Error("The reviewed shared-model adapter has not completed implementation validation.");
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) || !Array.isArray(inputs.rows) || inputs.rows.length < 48 || inputs.rows.length > 4096) throw new Error("The shared model requires 48–4096 explicit compatible rows.");
  for (const key of ["source", "design"]) if (!inputs[key] || typeof inputs[key] !== "object" || Array.isArray(inputs[key])) throw new Error(`An explicit ${key} contract is required.`);
  const seed = options.seed ?? 2026; const epochs = options.epochs ?? 30; const hiddenWidth = options.hiddenWidth ?? 32;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295 || !Number.isSafeInteger(epochs) || epochs < 10 || epochs > 100 || ![16, 32, 64].includes(hiddenWidth)) throw new Error("Shared-model compute options are outside the reviewed bounds.");
  const contributionManifest = await unifiedContributionManifest();
  if (new Set(contributionManifest.contributions.flatMap((row) => row.slotIds)).size !== unifiedSlots.length) throw new Error("All required model slots must have admitted contributions.");
  return { method: "unified-model", model: UNIFIED_MODEL_ID, source: inputs.source, design: inputs.design, rows: inputs.rows,
    ...(Object.hasOwn(inputs, "outcome") ? { outcome: inputs.outcome } : {}), seed, epochs, hiddenWidth,
    recipe: { id: UNIFIED_RECIPE_ID, version: UNIFIED_MODEL_VERSION, adapterId: UNIFIED_MODEL_ID, sourcePaperIds: [...new Set(contributionManifest.contributions.flatMap((row) => row.sourcePaperIds))].sort() }, contributionManifest };
}

export async function pendingUnifiedContributionFromPaper(paper: { doi: string; title: string }): Promise<UnifiedContribution> {
  const doi = paper.doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
  if (!/^10\.\d{4,9}\/[^\s?#]+$/.test(doi) || doi.length > 256 || !paper.title?.trim()) throw new Error("A pending paper requires DOI metadata and a title.");
  // Metadata can propose a review record; it cannot set status, slots, symbols, losses or weights.
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(doi));
  const id = "pending-paper-" + [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { id, version: "1.0.0", title: paper.title.replace(/<[^>]+>/g, "").slice(0, 1024), status: "PENDING_REVIEW", integrationStatus: "NOT_IMPLEMENTED",
    role: "PROPOSED_EXTENSION", slotIds: [], sourcePaperIds: ["doi:" + doi], sources: [], modelImpact: "No training effect. Review the full method, compatible data and rights before proposing an implemented objective mapping.", runtimeBindings: [], verification: [],
    review: { scope: "REVIEW_REQUIRED", paperMethodsReproduced: false }, compatibility: { inputContract: "not_adapted", dataLicense: "Not reviewed", modalities: [] }, limitations: ["Metadata discovery is not method review, implementation or model training."] };
}
