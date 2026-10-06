/** Reviewed adapters turn literature context into bounded local analysis runs. */
export const METHOD_REGISTRY_VERSION = "morpheus-method-recipes-v1";
export type MethodStatus = "EXECUTABLE" | "STAGING" | "REVIEW_REQUIRED";
export type MethodDomain = "decoding" | "causal-perturbation" | "reconstruction";
export type RecipeSource = { paperId: string; doi: string; url: string; relationship: "application_context"; review: "SOURCE_REVIEWED" };
export type MethodRecipe = {
  id: string;
  version: string;
  title: string;
  domain: MethodDomain;
  status: MethodStatus;
  adapterId: string | null;
  adapterPath: string | null;
  execution: { plane: "local-science-adapter"; endpoint: "/models/runs"; verb: "POST"; enabledBy: "MORPHEUS_MODEL_RUN_DIR" } | null;
  sourcePaperIds: string[];
  sources: RecipeSource[];
  inputContract: { id: string; required: string[]; grouping: string[]; schema: Record<string, unknown> };
  controls: string[];
  gates: string[];
  outputs: string[];
  computeBound: Record<string, number | string>;
  license: { implementation: string; sourceData: string; externalCodeCopied: false };
  adapterReview: "CONTRACT_AND_TESTS_REVIEWED" | "REVIEW_PENDING";
  reproduction: "ENGINEERING_ANALYSIS_ONLY" | "NOT_REPRODUCED";
  limitations: string[];
};

const localExecution = { plane: "local-science-adapter", endpoint: "/models/runs", verb: "POST", enabledBy: "MORPHEUS_MODEL_RUN_DIR" } as const;
const license = { implementation: "Repository license is not declared; this registry grants no reuse rights.", sourceData: "Review each dataset, stimulus and upstream-code license before materializing inputs.", externalCodeCopied: false } as const;
const decodingSources: RecipeSource[] = [
  { paperId: "horikawa-2013", doi: "10.1126/science.1234330", url: "https://pubmed.ncbi.nlm.nih.gov/23558170/", relationship: "application_context", review: "SOURCE_REVIEWED" },
  { paperId: "wong-2025", doi: "10.1038/s41467-025-61945-1", url: "https://www.nature.com/articles/s41467-025-61945-1", relationship: "application_context", review: "SOURCE_REVIEWED" },
];
const decodingContract = {
  id: "m3-labeled-features-v1",
  required: ["rows[].id", "rows[].subjectId", "rows[].sessionId", "rows[].label", "rows[].features", "rows[].featureNames", "rows[].sourceMode", "rows[].featureSchema"],
  grouping: ["Exactly one subject", "At least three independent sessions", "Every session contains all two to eight target classes", "Common ordered feature names, source kind, feature schema, sampling and channel configuration"],
  schema: { rows: { type: "array", minItems: 8, maxItems: 2048, item: { id: "bounded unique string", subjectId: "pseudonym", sessionId: "independent acquisition session", label: "predefined target state", features: "1–64 finite values, absolute value ≤1e12", featureNames: "ordered unique names", sourceMode: "live | simulation | unverified", sourceKind: "local_acquisition_unverified | simulation_fixture | unknown", featureSchema: "version identifier", sampleRate: "positive Hz or null", channelCount: "positive integer or null" } }, seed: "safe integer", permutations: { min: 20, max: 200 } },
};
const decodingControls = ["Training-fold-only z-score preprocessing", "Leave-one-session-out evaluation; no row-wise fallback", "Within-session label-shuffle null with refitting", "Session-cluster bootstrap interval", "Compare model families on the same held-out design"];
const decodingGates = ["Local gateway explicitly enabled; source rights and participant consent permit the analysis", "Independent session IDs and target labels have been reviewed", "Overlapping/autocorrelated windows must satisfy permutation exchangeability or results stay exploratory", "Run-family correction or preregistration is required before a confirmatory claim"];

export const methodRecipes: MethodRecipe[] = [
  {
    id: "m3-nearest-centroid-v1", version: "1.0.0", title: "Session-held-out nearest-centroid baseline", domain: "decoding", status: "EXECUTABLE",
    adapterId: "nearest-centroid", adapterPath: "services/signal-gateway/app/model_runtime.py", execution: localExecution,
    sourcePaperIds: decodingSources.map((source) => source.paperId), sources: decodingSources, inputContract: decodingContract,
    controls: decodingControls, gates: decodingGates, outputs: ["Held-out balanced accuracy", "Per-fold train/test IDs", "Confusion matrix", "Session-bootstrap interval", "Permutation null", "Canonical input/output hashes"],
    computeBound: { rows: 2048, features: 64, permutations: 200, maximumRefitWork: 20000000, queuedJobs: 4, workers: 1 },
    license, adapterReview: "CONTRACT_AND_TESTS_REVIEWED", reproduction: "ENGINEERING_ANALYSIS_ONLY",
    limitations: ["A comparison baseline for category/report-decoding literature, not a reproduction of either linked paper's trained decoder.", "State discrimination is separate from image reconstruction or recovery of a historical dream."],
  },
  {
    id: "m3-diagonal-lda-v1", version: "1.0.0", title: "Session-held-out regularized diagonal LDA", domain: "decoding", status: "EXECUTABLE",
    adapterId: "diagonal-lda", adapterPath: "services/signal-gateway/app/model_runtime.py", execution: localExecution,
    sourcePaperIds: decodingSources.map((source) => source.paperId), sources: decodingSources, inputContract: decodingContract,
    controls: decodingControls, gates: decodingGates, outputs: ["Equal-prior diagonal-covariance classifier", "Held-out balanced accuracy", "Session-bootstrap interval", "Refitted within-session null", "Confusion matrix", "Reproducible run manifest"],
    computeBound: { rows: 2048, features: 64, permutations: 200, maximumRefitWork: 20000000, queuedJobs: 4, workers: 1 },
    license, adapterReview: "CONTRACT_AND_TESTS_REVIEWED", reproduction: "ENGINEERING_ANALYSIS_ONLY",
    limitations: ["Diagonal pooled covariance and fixed regularization; no nested hyperparameter search or calibration.", "Linked neuroscience papers provide application context; this is a Morpheus baseline, not their full methodology."],
  },
  {
    id: "causal-paired-contrast-v1", version: "1.0.0", title: "Independent-unit perturbation versus sham analysis", domain: "causal-perturbation", status: "EXECUTABLE",
    adapterId: "causal-perturbation", adapterPath: "services/signal-gateway/app/causal_analysis.py", execution: localExecution,
    sourcePaperIds: ["boyden-2005", "ryan-2015", "marshel-2019"],
    sources: [
      { paperId: "boyden-2005", doi: "10.1038/nn1525", url: "https://pubmed.ncbi.nlm.nih.gov/16116447/", relationship: "application_context", review: "SOURCE_REVIEWED" },
      { paperId: "ryan-2015", doi: "10.1126/science.aaa5542", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5583719/", relationship: "application_context", review: "SOURCE_REVIEWED" },
      { paperId: "marshel-2019", doi: "10.1126/science.aaw5202", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6711485/", relationship: "application_context", review: "SOURCE_REVIEWED" },
    ],
    inputContract: {
      id: "paired-perturbation-outcomes-v1", required: ["source", "design", "outcome", "rows[].trialId", "rows[].unitId", "rows[].sessionId", "rows[].condition", "rows[].outcome", "rows[].qcPassed"],
      grouping: ["At least six independent units", "Both conditions in every unit/session block", "At least two observations per condition per unit", "All-or-none baseline values", "Unique trial IDs"],
      schema: { method: "causal-perturbation", source: { kind: "synthetic | public-animal-optogenetic | public-observational", datasetId: "bounded identifier", datasetVersion: "version", url: "public HTTPS source, required for nonsynthetic inputs" },
        design: { assignment: "randomized | observational", independentUnitsConfirmed: true, randomization: "For randomized designs: recorded=true, recordSha256=64 hex, method=descriptive string", registration: "If registered: id, registered=true, lockedBeforeCollection=true" },
        outcome: { name: "predefined outcome", unit: "measurement unit" }, rows: { minItems: 24, maxItems: 8192, item: { trialId: "unique ID", unitId: "independent experimental unit", sessionId: "session block", condition: "stimulated | sham | control", outcome: "finite value", baseline: "optional finite value", qcPassed: true } },
        controlCondition: "sham | control", bootstrapSamples: { min: 200, max: 5000 }, permutations: { min: 200, max: 10000 }, alpha: 0.05, baselineTolerance: "Required when baseline values are present; nonnegative original outcome units" },
    },
    controls: ["Within-unit/session stimulated–comparator contrasts", "Equal weight per independent unit", "Cluster-bootstrap confidence interval", "Two-sided sign-flip null; exact enumeration for ≤16 units", "Baseline balance screening when baseline is supplied", "Randomization record hash and prospective registration status"],
    gates: ["Analysis of existing licensed data; no acquisition or stimulation commands are issued", "Independent units, sham/control selection and outcome definition are confirmed", "Randomized designs require an existing recorded assignment manifest", "Sign symmetry/exchangeability is reviewed; observational associations are not promoted to causal evidence", "Biological perturbation collection belongs to qualified laboratory governance"],
    outputs: ["Unit/session contrasts", "Equal-unit mean effect", "Cluster-bootstrap interval", "Sign-flip p and resolution", "Baseline balance QC", "Source/design-dependent evidence classification", "Input/output hashes and versioned manifest"],
    computeBound: { rows: 8192, independentUnits: 128, bootstrapSamples: 5000, permutations: 10000, exactEnumerationMaximumUnits: 16, maximumUnitDrawWork: 2000000, queuedJobs: 4, workers: 1 },
    license, adapterReview: "CONTRACT_AND_TESTS_REVIEWED", reproduction: "ENGINEERING_ANALYSIS_ONLY",
    limitations: ["Implements analysis of supplied perturbation outcomes, not optogenetic hardware, animal protocols or a reproduction of the cited experiments.", "A learned response or perturbation effect cannot establish audiovisual memory recovery or permanent storage of every experience."],
  },
  {
    id: "fmri-visual-reconstruction-reference-v1", version: "1.0.0", title: "Hierarchical fMRI visual reconstruction adaptation", domain: "reconstruction", status: "STAGING",
    adapterId: null, adapterPath: null, execution: null, sourcePaperIds: ["shen-2019"],
    sources: [{ paperId: "shen-2019", doi: "10.1371/journal.pcbi.1006633", url: "https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1006633", relationship: "application_context", review: "SOURCE_REVIEWED" }],
    inputContract: { id: "fmri-visual-latents-not-adapted", required: ["Subject-specific fMRI", "Licensed target images/features", "Training-only fitted neural mapping"], grouping: ["Unseen image identities remain held out"], schema: {} },
    controls: ["Prior-only generation", "Neural-shuffle ablation", "Held-out candidate retrieval"], gates: ["Methods and upstream-code license audit", "Dataset loader and trained-model adapter", "Real-data benchmark with held-out stimuli"], outputs: [], computeBound: { state: "Not executable; compute requirements unbenchmarked" },
    license, adapterReview: "REVIEW_PENDING", reproduction: "NOT_REPRODUCED", limitations: ["Reference remains staged; no images or untested reconstructions are generated by this recipe."],
  },
];

function freezeRecipeTree(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeRecipeTree(child);
  Object.freeze(value);
}
freezeRecipeTree(methodRecipes);

export type MethodQuery = { q?: string; status?: MethodStatus | "all"; domain?: MethodDomain | "all"; paperId?: string; offset?: number; limit?: number };
export function queryMethodRecipes(query: MethodQuery = {}, catalog: MethodRecipe[] = methodRecipes) {
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 25;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Method pagination requires a nonnegative offset and a limit from 1 to 100.");
  if (query.status && !["all", "EXECUTABLE", "STAGING", "REVIEW_REQUIRED"].includes(query.status)) throw new Error("Unknown method status.");
  if (query.domain && !["all", "decoding", "causal-perturbation", "reconstruction"].includes(query.domain)) throw new Error("Unknown method domain.");
  const text = (query.q || "").trim().toLowerCase();
  if (text.length > 256) throw new Error("Method search must be at most 256 characters.");
  const filtered = catalog.filter((recipe) => (!query.status || query.status === "all" || recipe.status === query.status) &&
    (!query.domain || query.domain === "all" || recipe.domain === query.domain) && (!query.paperId || recipe.sourcePaperIds.includes(query.paperId)) &&
    (!text || [recipe.title, recipe.id, recipe.domain, ...recipe.sourcePaperIds, ...recipe.sources.map((source) => source.doi), ...recipe.controls].join(" ").toLowerCase().includes(text))).sort((a, b) => a.id.localeCompare(b.id));
  return { schema: METHOD_REGISTRY_VERSION, total: filtered.length, offset, limit, nextOffset: offset + limit < filtered.length ? offset + limit : null, methods: filtered.slice(offset, offset + limit) };
}

export function createRecipeRunRequest(recipeId: string, inputs: Record<string, unknown>, options: { seed?: number; permutations?: number; bootstrapSamples?: number } = {}) {
  const recipe = methodRecipes.find((row) => row.id === recipeId);
  if (!recipe || recipe.status !== "EXECUTABLE" || !recipe.adapterId || !recipe.execution || recipe.adapterReview !== "CONTRACT_AND_TESTS_REVIEWED") throw new Error("This method has no reviewed executable adapter. Review and map the method before running it.");
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new Error("Method inputs must be an object.");
  if (!Array.isArray(inputs.rows)) throw new Error("A method run requires explicit data rows.");
  const seed = options.seed ?? 2026;
  if (!Number.isSafeInteger(seed)) throw new Error("The random seed must be a safe integer.");
  const permutations = options.permutations ?? (recipe.domain === "causal-perturbation" ? 2000 : 100);
  const minimum = recipe.domain === "causal-perturbation" ? 200 : 20;
  const maximum = recipe.domain === "causal-perturbation" ? 10000 : 200;
  if (!Number.isSafeInteger(permutations) || permutations < minimum || permutations > maximum) throw new Error(`Permutation count must be ${minimum}–${maximum}.`);
  const envelope = { id: recipe.id, version: recipe.version, adapterId: recipe.adapterId, sourcePaperIds: [...recipe.sourcePaperIds] };
  if (recipe.domain === "causal-perturbation") {
    if (inputs.rows.length < 24 || inputs.rows.length > 8192) throw new Error("The perturbation adapter accepts 24–8192 matched observations.");
    if (seed < 0 || seed > 4294967295) throw new Error("The causal random seed must be from 0 to 2^32−1.");
    if (Object.hasOwn(inputs, "alpha") && inputs.alpha !== 0.05) throw new Error("The registered causal analysis uses a fixed alpha of 0.05.");
    for (const key of ["source", "design", "outcome"]) if (!inputs[key] || typeof inputs[key] !== "object" || Array.isArray(inputs[key])) throw new Error(`Causal analysis requires an explicit ${key} contract.`);
    const bootstrapSamples = options.bootstrapSamples ?? 1000;
    if (!Number.isSafeInteger(bootstrapSamples) || bootstrapSamples < 200 || bootstrapSamples > 5000) throw new Error("Bootstrap count must be 200–5000.");
    // Scientific validation and work budgets are enforced again by the local adapter.
    const causalInputs = Object.fromEntries(["source", "design", "outcome", "rows", "controlCondition", "baselineTolerance", "alpha"].filter((key) => Object.hasOwn(inputs, key)).map((key) => [key, inputs[key]]));
    return { ...causalInputs, method: "causal-perturbation", seed, permutations, bootstrapSamples, recipe: envelope };
  }
  if (inputs.rows.length < 8 || inputs.rows.length > 2048) throw new Error("The classical adapter accepts 8–2048 rows.");
  // Do not forward caller-supplied execution URLs, model identifiers or recipe overrides.
  return { rows: inputs.rows, model: recipe.adapterId, seed, permutations, recipe: envelope };
}

export function methodRecipeExport(catalog: MethodRecipe[] = methodRecipes) {
  return { schema: METHOD_REGISTRY_VERSION, methods: [...catalog].sort((a, b) => a.id.localeCompare(b.id)),
    interpretation: "Executable refers to a bounded local software adapter. Source links describe application context; no cited experiment is claimed reproduced.",
    reviewPolicy: "Discovered metadata cannot execute a method. A reviewed, tested and allowlisted adapter with an input contract is required." };
}

export function normalizedDoi(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const doi = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
  return /^10\.\d{4,9}\/[^\s?#]+$/.test(doi) && doi.length <= 256 ? doi : null;
}

export function mapDiscoveredPaper(work: Record<string, unknown>) {
  const doi = normalizedDoi(work.DOI);
  if (!doi) throw new Error("Crossref metadata has no valid DOI.");
  const title = Array.isArray(work.title) && typeof work.title[0] === "string" ? work.title[0].replace(/<[^>]+>/g, "").slice(0, 1024) : "Title not supplied";
  const recipes = methodRecipes.filter((recipe) => recipe.sources.some((source) => normalizedDoi(source.doi) === doi));
  const executable = recipes.filter((recipe) => recipe.status === "EXECUTABLE" && recipe.adapterId && recipe.adapterReview === "CONTRACT_AND_TESTS_REVIEWED");
  const dates = work.published as { "date-parts"?: unknown[][] } | undefined;
  const year = dates?.["date-parts"]?.[0]?.[0];
  return { id: "crossref:" + doi, doi, title, url: "https://doi.org/" + doi,
    year: typeof year === "number" && Number.isInteger(year) ? year : null,
    source: "Crossref", metadataOnly: true, reviewStatus: recipes.length ? "SOURCE_CONTEXT_MAPPED" : "REVIEW_REQUIRED",
    applicationStatus: executable.length ? "RUN_ADAPTER_AVAILABLE" : recipes.length ? "ADAPTER_STAGING" : "UNMAPPED_REVIEW_REQUIRED",
    methods: recipes.map((recipe) => ({ id: recipe.id, version: recipe.version, title: recipe.title, status: recipe.status, adapterId: recipe.adapterId, endpoint: recipe.execution?.endpoint || null, mappingRelation: "application_context_only" })),
    nextStep: executable.length ? "Select an adapter, supply compatible licensed data and run on the explicitly enabled local gateway." : "Review the full method, source data and rights; implement and test an input adapter before execution.",
    licenseStatus: "Review source-data/code licenses; metadata discovery does not grant redistribution or execution rights.",
  };
}
