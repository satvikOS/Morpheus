export type ResearchDomain = "dreams" | "memory" | "imagery" | "language" | "development" | "art-cinema" | "disease" | "optogenetics";
export type HypothesisId = "H-PERSIST" | "H-ACCESS" | "H-REINSTATE" | "H-CONTINUITY" | "H-LUCID" | "H-DECODE" | "H-RECONSTRUCT";
export type ReviewStatus = "NOT_REVIEWED" | "SOURCE_REVIEWED" | "METHODS_REVIEWED";
export type ReproductionStatus = "NOT_REPRODUCED" | "ENGINEERING_BASELINE" | "REPRODUCED";

export type ResearchPaper = {
  id: string;
  title: string;
  authors: string;
  year: number;
  journal: string;
  doi: string;
  url: string;
  domains: ResearchDomain[];
  modality: string;
  species: "human" | "mouse" | "human-and-mouse" | "cultured-neurons";
  finding: string;
  limitations: string[];
  reviewStatus: ReviewStatus;
  reviewNote: string;
  reproductionStatus: ReproductionStatus;
  hypothesisIds: HypothesisId[];
  datasetIds: string[];
  modelIds: string[];
};

export type ResearchDataset = {
  id: string;
  title: string;
  url: string;
  modality: string;
  target: string;
  access: "PUBLIC_METADATA" | "OPEN_DOWNLOAD" | "UPSTREAM_TERMS";
  license: string;
  licenseUrl?: string;
  paperIds: string[];
  limitations: string[];
};

export type ResearchModel = {
  id: string;
  title: string;
  url: string;
  state: "REFERENCE_ONLY" | "BASELINE_IMPLEMENTED";
  reproductionStatus: ReproductionStatus;
  license: string;
  requirements: string[];
  metrics: string[];
  limitations: string[];
  paperIds: string[];
  datasetIds: string[];
  hypothesisIds: HypothesisId[];
};

export type ResearchHypothesis = {
  id: HypothesisId;
  title: string;
  statement: string;
  null: string;
  measurableTarget: string;
  requirements: string[];
  interpretation: string;
};

export const RESEARCH_VERIFIED_AT = "2026-10-06";
const sourceReview = {
  reviewStatus: "SOURCE_REVIEWED" as const,
  reviewNote: "Primary publication summary and relevant source links checked on 6 October 2026. Full methods audit and independent replication remain open.",
  reproductionStatus: "NOT_REPRODUCED" as const,
};

export const RESEARCH_DOMAINS: Record<ResearchDomain, string> = {
  dreams: "Dreams", memory: "Memory access", imagery: "Visual imagery", language: "Language",
  development: "Early memory", "art-cinema": "Art and cinema", disease: "Disease research", optogenetics: "Optogenetics",
};

export const researchDevelopments = [
  {
    id: "nobel-optogenetics-2026", title: "2026 Nobel recognition for optogenetics", date: "2026-10-05",
    description: "Stanford reports that Karl Deisseroth shares the 2026 Nobel Prize in physiology or medicine with Peter Hegemann and Georg Nagel for discoveries leading to optogenetics.",
    url: "https://med.stanford.edu/news/all-news/2026/10/deisseroth-nobel-prize.html",
    source: "Stanford Medicine announcement", paperIds: ["boyden-2005", "marshel-2019", "kauvar-2025", "ryan-2015"],
    interpretation: "Award recognition is context. Each experiment retains its own species, methods, limitations and replication status.",
  },
];

export const researchPapers: ResearchPaper[] = [
  {
    id: "boyden-2005", title: "Millisecond-timescale, genetically targeted optical control of neural activity", authors: "Boyden, Zhang, Bamberg, Nagel and Deisseroth",
    year: 2005, journal: "Nature Neuroscience", doi: "10.1038/nn1525", url: "https://pubmed.ncbi.nlm.nih.gov/16116447/",
    domains: ["optogenetics"], modality: "Channelrhodopsin-2 and optical stimulation", species: "cultured-neurons",
    finding: "Introducing channelrhodopsin-2 enabled reliable optical control of mammalian neuronal spikes and synaptic events on millisecond timescales.",
    limitations: ["Genetic targeting and light delivery are laboratory perturbation methods, not passive scalp EEG decoding.", "This foundational paper is one contribution to a field with multiple pioneers."],
    ...sourceReview, hypothesisIds: ["H-DECODE", "H-ACCESS"], datasetIds: [], modelIds: ["optogenetic-ensemble-reference"],
  },
  {
    id: "marshel-2019", title: "Cortical layer-specific critical dynamics triggering perception", authors: "Marshel, Kim and colleagues; senior author Karl Deisseroth",
    year: 2019, journal: "Science", doi: "10.1126/science.aaw5202", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6711485/",
    domains: ["optogenetics", "imagery"], modality: "Cell-targeted multiphoton optogenetics and neural imaging", species: "mouse",
    finding: "Precisely targeted cortical stimulation during a visual-discrimination task revealed neuronal ensemble dynamics sufficient to drive perception-linked behavior.",
    limitations: ["Causal, cell-resolved animal experiments differ from correlational decoding in human fMRI or EEG.", "A discrimination response cannot establish subjective scene fidelity or retrieval of an old dream."],
    ...sourceReview, hypothesisIds: ["H-DECODE", "H-RECONSTRUCT"], datasetIds: [], modelIds: ["optogenetic-ensemble-reference"],
  },
  {
    id: "kauvar-2025", title: "Conserved brain-wide emergence of emotional response from sensory experience in humans and mice", authors: "Kauvar, Richman, Liu and colleagues; senior co-author Karl Deisseroth",
    year: 2025, journal: "Science", doi: "10.1126/science.adt3971", url: "https://pubmed.ncbi.nlm.nih.gov/40440375/",
    domains: ["optogenetics", "memory", "disease"], modality: "Brain-wide electrophysiology, behavior and circuit perturbation", species: "human-and-mouse",
    finding: "Brief adverse sensory inputs produced fast and more sustained neural-response phases associated with emotional behavior in humans and mice.",
    limitations: ["A sustained emotional state after a brief stimulus is not a permanent autobiographical record.", "Human recording and animal causal perturbation must be interpreted separately; this does not establish a Morpheus treatment."],
    ...sourceReview, hypothesisIds: ["H-PERSIST", "H-DECODE"], datasetIds: [], modelIds: ["optogenetic-ensemble-reference"],
  },
  {
    id: "horikawa-2013", title: "Neural decoding of visual imagery during sleep", authors: "Horikawa, Tamaki, Miyawaki and Kamitani",
    year: 2013, journal: "Science", doi: "10.1126/science.1234330", url: "https://pubmed.ncbi.nlm.nih.gov/23558170/",
    domains: ["dreams", "imagery"], modality: "fMRI and verbal reports", species: "human",
    finding: "Perception-trained decoders discriminated reported visual object categories during sleep onset in three participants.",
    limitations: ["Sleep-onset imagery and report-derived categories; this is not continuous dream video.", "Does not test memories of dreams from years earlier."],
    ...sourceReview, hypothesisIds: ["H-DECODE", "H-RECONSTRUCT"], datasetIds: ["human-dream-decoding"], modelIds: ["horikawa-category-decoder"],
  },
  {
    id: "konkoly-2021", title: "Real-time dialogue between experimenters and dreamers during REM sleep", authors: "Konkoly and colleagues",
    year: 2021, journal: "Current Biology", doi: "10.1016/j.cub.2021.01.026", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8162929/",
    domains: ["dreams"], modality: "Polysomnography, eye and facial muscle signals", species: "human",
    finding: "Four laboratories obtained 29 correct answers during signal-verified lucid REM episodes in six of 36 participants.",
    limitations: ["Most communication attempts received no response; success is not guaranteed.", "Intentional signals provide timing anchors, not comprehensive access to a dream's content."],
    ...sourceReview, hypothesisIds: ["H-LUCID", "H-DECODE"], datasetIds: ["dream"], modelIds: [],
  },
  {
    id: "wong-2025", title: "A dream EEG and mentation database", authors: "Wong, Herzog and colleagues",
    year: 2025, journal: "Nature Communications", doi: "10.1038/s41467-025-61945-1", url: "https://www.nature.com/articles/s41467-025-61945-1",
    domains: ["dreams"], modality: "M/EEG with awakening reports", species: "human",
    finding: "The initial DREAM release linked sleep recordings and experience classifications across 20 datasets, 505 participants and 2,643 awakenings.",
    limitations: ["Metadata are open; individual signal datasets have their own access terms.", "Experience without recall must remain distinct from reported absence of experience.", "A classifier of report categories does not reconstruct dream imagery."],
    ...sourceReview, hypothesisIds: ["H-DECODE", "H-ACCESS"], datasetIds: ["dream"], modelIds: ["dream-eeg-reference", "morpheus-centroid"],
  },
  {
    id: "ryan-2015", title: "Engram cells retain memory under retrograde amnesia", authors: "Ryan, Roy, Pignatelli, Arons and Tonegawa",
    year: 2015, journal: "Science", doi: "10.1126/science.aaa5542", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5583719/",
    domains: ["memory", "disease", "optogenetics"], modality: "Engram tagging and optogenetics", species: "mouse",
    finding: "Direct activation of tagged neuronal ensembles elicited learned fear responses despite protein-synthesis-inhibitor-induced amnesia.",
    limitations: ["Specific experimentally induced amnesia in mice; not proof that all human experiences remain stored.", "Recovery of a learned response does not recover an audiovisual episode or establish a treatment."],
    ...sourceReview, hypothesisIds: ["H-PERSIST", "H-ACCESS"], datasetIds: [], modelIds: ["optogenetic-ensemble-reference"],
  },
  {
    id: "guskjolen-2018", title: "Recovery of 'lost' infant memories in mice", authors: "Guskjolen and colleagues",
    year: 2018, journal: "Current Biology", doi: "10.1016/j.cub.2018.05.059", url: "https://pubmed.ncbi.nlm.nih.gov/29983316/",
    domains: ["memory", "development", "optogenetics"], modality: "Engram tagging and optogenetics", species: "mouse",
    finding: "Activating dentate gyrus ensembles tagged during infant learning recovered a learned response up to three months after training.",
    limitations: ["Animal findings cannot verify an individual's earliest autobiographical recollections.", "A bounded retention interval does not demonstrate permanence or storage of every detail."],
    ...sourceReview, hypothesisIds: ["H-PERSIST", "H-ACCESS"], datasetIds: [], modelIds: [],
  },
  {
    id: "yates-2025", title: "Hippocampal encoding of memories in human infants", authors: "Yates and colleagues",
    year: 2025, journal: "Science", doi: "10.1126/science.adt7570", url: "https://pubmed.ncbi.nlm.nih.gov/40112047/",
    domains: ["memory", "development"], modality: "Awake infant fMRI and preferential looking", species: "human",
    finding: "Hippocampal activity during image viewing predicted later memory-related looking behavior beginning around one year of age.",
    limitations: ["Testing occurred about a minute after encoding, not decades later.", "Rich contextual autobiographical encoding and long-term accessibility remain open questions."],
    ...sourceReview, hypothesisIds: ["H-PERSIST", "H-ACCESS"], datasetIds: ["infant-memory"], modelIds: [],
  },
  {
    id: "partanen-2013", title: "Learning-induced neural plasticity of speech processing before birth", authors: "Partanen and colleagues",
    year: 2013, journal: "PNAS", doi: "10.1073/pnas.1302159110", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3773755/",
    domains: ["development", "memory", "language"], modality: "Newborn EEG responses to prenatally presented sounds", species: "human",
    finding: "Prenatal speech-like sound exposure was associated with altered newborn neural responses to trained sound features.",
    limitations: ["Prenatal learning is not the same measurement as adult autobiographical recall of the womb.", "This experiment does not establish lifelong retention or exact recollection of an episode."],
    ...sourceReview, hypothesisIds: ["H-PERSIST"], datasetIds: [], modelIds: [],
  },
  {
    id: "ko-2025", title: "Systems consolidation reorganizes hippocampal engram circuitry", authors: "Ko and colleagues",
    year: 2025, journal: "Nature", doi: "10.1038/s41586-025-08993-1", url: "https://www.nature.com/articles/s41586-025-08993-1",
    domains: ["memory", "disease"], modality: "Mouse engram circuits and neurogenesis manipulation", species: "mouse",
    finding: "Time-dependent hippocampal circuit reorganization accompanied a shift from precise event memories toward generalized gist.",
    limitations: ["Retention and loss of precision can coexist; persistence of gist is not persistence of all details.", "Mouse circuit manipulation does not establish human memory recovery or clinical efficacy."],
    ...sourceReview, hypothesisIds: ["H-PERSIST", "H-ACCESS"], datasetIds: [], modelIds: [],
  },
  {
    id: "shen-2019", title: "Deep image reconstruction from human brain activity", authors: "Shen, Horikawa, Majima and Kamitani",
    year: 2019, journal: "PLOS Computational Biology", doi: "10.1371/journal.pcbi.1006633", url: "https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1006633",
    domains: ["imagery", "art-cinema"], modality: "fMRI and hierarchical image features", species: "human",
    finding: "Decoded visual features supported reconstruction of viewed images and rudimentary imagery of artificial shapes.",
    limitations: ["Imagined natural images were not well reconstructed.", "Generative image priors can add plausible details beyond the information constrained by brain recordings."],
    ...sourceReview, hypothesisIds: ["H-DECODE", "H-RECONSTRUCT"], datasetIds: ["deep-image-reconstruction"], modelIds: ["deep-image-reference"],
  },
  {
    id: "tang-2023", title: "Semantic reconstruction of continuous language from non-invasive brain recordings", authors: "Tang, LeBel, Jain and Huth",
    year: 2023, journal: "Nature Neuroscience", doi: "10.1038/s41593-023-01304-9", url: "https://www.nature.com/articles/s41593-023-01304-9",
    domains: ["language", "imagery", "art-cinema"], modality: "fMRI, language models and subject-specific training", species: "human",
    finding: "A trained decoder generated language reflecting semantic content of perceived speech, imagined speech and silent videos.",
    limitations: ["Subject cooperation and individual training were necessary; outputs can differ from exact wording.", "This is not evidence of recovery of unrecorded historical dreams."],
    ...sourceReview, hypothesisIds: ["H-DECODE", "H-RECONSTRUCT"], datasetIds: ["semantic-decoding"], modelIds: ["semantic-reference"],
  },
  {
    id: "allen-2022", title: "A massive 7T fMRI dataset to bridge cognitive neuroscience and artificial intelligence", authors: "Allen and colleagues",
    year: 2022, journal: "Nature Neuroscience", doi: "10.1038/s41593-021-00962-x", url: "https://www.nature.com/articles/s41593-021-00962-x",
    domains: ["imagery", "memory", "art-cinema"], modality: "Repeated natural-image 7T fMRI", species: "human",
    finding: "The Natural Scenes Dataset provides repeated image-viewing and recognition measurements in eight extensively scanned participants.",
    limitations: ["Perception and recognition tasks, not dream recordings.", "Repeated image identities must remain in one partition when testing generalization to unseen images."],
    ...sourceReview, hypothesisIds: ["H-DECODE", "H-PERSIST"], datasetIds: ["nsd"], modelIds: ["morpheus-centroid"],
  },
];

export const researchDatasets: ResearchDataset[] = [
  { id: "dream", title: "DREAM EEG and mentation", url: "https://bridges.monash.edu/articles/dataset/The_DREAM_database/22133105", modality: "EEG / MEG and awakening reports", target: "Reported experience, absence of experience, and experience without recall", access: "PUBLIC_METADATA", license: "Registry: CC BY 4.0. Individual packages: check each source's terms.", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", paperIds: ["wong-2025", "konkoly-2021"], limitations: ["Metadata refresh does not download or analyze raw neural signals.", "Superseded and revoked dataset amendments must be excluded."] },
  { id: "human-dream-decoding", title: "Human Dream Decoding", url: "https://github.com/KamitaniLab/HumanDreamDecoding", modality: "Sleep-onset fMRI and object-category labels", target: "Reported visual object categories", access: "UPSTREAM_TERMS", license: "Data: ODC BY; reference scripts: MIT, as stated by the authors.", licenseUrl: "https://opendatacommons.org/licenses/by/", paperIds: ["horikawa-2013"], limitations: ["Official repository links to Brainliner data; endpoint availability has not been verified.", "Full raw recordings exceed 30 GB; a preprocessed option is described upstream."] },
  { id: "infant-memory", title: "Human infant memory encoding data", url: "https://doi.org/10.5061/dryad.b2rbnzsr2", modality: "Infant fMRI and recognition behavior", target: "Subsequent memory-related looking", access: "UPSTREAM_TERMS", license: "Consult the Dryad record before download; license not independently checked.", paperIds: ["yates-2025"], limitations: ["Reference dataset; no Morpheus loader or replication has been run.", "No adult recall of prenatal or infancy episodes is measured."] },
  { id: "deep-image-reconstruction", title: "Deep image reconstruction (ds001506)", url: "https://openneuro.org/datasets/ds001506", modality: "fMRI, viewed images and mental imagery", target: "Visual features and stimulus identification", access: "UPSTREAM_TERMS", license: "Check dataset snapshot, stimulus terms, model weights and repository license separately.", paperIds: ["shen-2019"], limitations: ["OpenNeuro source link verified in the paper; no raw data imported.", "Reconstruction quality cannot be interpreted without prior-only and neural-shuffle controls."] },
  { id: "semantic-decoding", title: "Semantic decoding recordings (ds003020 / ds004510)", url: "https://openneuro.org/datasets/ds004510", modality: "fMRI with speech, imagery and video tasks", target: "Continuous semantic language reconstruction", access: "UPSTREAM_TERMS", license: "Consult each OpenNeuro snapshot and the model repository; not license-audited here.", paperIds: ["tang-2023"], limitations: ["Resistance-experiment recordings are not public.", "Dataset listing does not mean the model is installed or working in Morpheus."] },
  { id: "nsd", title: "Natural Scenes Dataset", url: "https://www.naturalscenesdataset.org/", modality: "7T fMRI, natural scenes and recognition responses", target: "Perception encoding, visual identification and memory", access: "UPSTREAM_TERMS", license: "Follow NSD data-access terms and separate COCO image rights.", paperIds: ["allen-2022"], limitations: ["Use dataset-provided subject/session and image identities to prevent leakage.", "These data can benchmark perception pipelines, not establish dream reconstruction."] },
];

export const researchModels: ResearchModel[] = [
  { id: "optogenetic-ensemble-reference", title: "Causal ensemble perturbation reference", url: "https://dlab.stanford.edu/research/publications", state: "REFERENCE_ONLY", reproductionStatus: "NOT_REPRODUCED", license: "Consult each paper's source data, reagents and code terms; no common license is implied.", requirements: ["Qualified laboratory and species-specific research protocol", "Genetically targeted cell populations", "Recorded perturbation parameters and sham controls", "Separate human observational and animal causal endpoints"], metrics: ["Perturbation versus sham effect", "Cell-ensemble specificity", "Behavioral and neural effect sizes with uncertainty"], limitations: ["A reference methodology, not a software model or an enabled human intervention.", "This research does not permit a browser application to activate or recover human memories."], paperIds: ["boyden-2005", "marshel-2019", "kauvar-2025", "ryan-2015"], datasetIds: [], hypothesisIds: ["H-PERSIST", "H-ACCESS", "H-DECODE"] },
  { id: "morpheus-centroid", title: "Morpheus nearest-centroid baseline", url: "/workers/research-worker.js", state: "BASELINE_IMPLEMENTED", reproductionStatus: "ENGINEERING_BASELINE", license: "Repository license not declared; this entry does not grant reuse rights.", requirements: ["Fixed-width labeled features", "Independent session groups", "Class representation in each training fold"], metrics: ["Held-out balanced accuracy", "Confusion matrix", "Permutation p-value"], limitations: ["Worker execution is an engineering result, not validation of a neuroscience hypothesis.", "Subject- and site-level splitting remains necessary for cross-person or cross-site claims."], paperIds: [], datasetIds: ["dream", "nsd"], hypothesisIds: ["H-DECODE"] },
  { id: "horikawa-category-decoder", title: "Perception-to-sleep category decoder", url: "https://github.com/KamitaniLab/HumanDreamDecoding", state: "REFERENCE_ONLY", reproductionStatus: "NOT_REPRODUCED", license: "MIT scripts; ODC BY data. Confirm external dependencies separately.", requirements: ["Subject-specific perception and sleep fMRI", "Report-derived category labels", "MATLAB reference environment"], metrics: ["Held-out pairwise category accuracy", "Label-permutation null"], limitations: ["Linked reference code is not integrated into a trained Morpheus model."], paperIds: ["horikawa-2013"], datasetIds: ["human-dream-decoding"], hypothesisIds: ["H-DECODE"] },
  { id: "dream-eeg-reference", title: "DREAM EEG classification reference", url: "https://doi.org/10.5281/zenodo.15234845", state: "REFERENCE_ONLY", reproductionStatus: "NOT_REPRODUCED", license: "Check the linked code record before reuse; license not independently inspected.", requirements: ["Eligible artifact-reviewed M/EEG windows", "Report classifications", "Subject and source identifiers"], metrics: ["Balanced accuracy beyond stage-only baseline", "Grouped permutation test", "Subject-bootstrap confidence interval"], limitations: ["Classifies reported experience status; does not decode full dream scenes."], paperIds: ["wong-2025"], datasetIds: ["dream"], hypothesisIds: ["H-DECODE", "H-ACCESS"] },
  { id: "deep-image-reference", title: "Hierarchical visual-feature reconstruction", url: "https://github.com/KamitaniLab/DeepImageReconstruction", state: "REFERENCE_ONLY", reproductionStatus: "NOT_REPRODUCED", license: "Review repository, pretrained-weight and stimulus licenses before execution.", requirements: ["Perception-calibrated fMRI features", "Feature decoder and image prior", "Unseen image identities in evaluation"], metrics: ["Held-out image identification", "Feature similarity", "Improvement over prior-only and shuffled-neural controls"], limitations: ["Image aesthetics do not measure the accuracy of recovered experience."], paperIds: ["shen-2019"], datasetIds: ["deep-image-reconstruction"], hypothesisIds: ["H-RECONSTRUCT"] },
  { id: "semantic-reference", title: "Subject-trained semantic language decoder", url: "https://github.com/HuthLab/semantic-decoding", state: "REFERENCE_ONLY", reproductionStatus: "NOT_REPRODUCED", license: "Review repository, language-model and dataset terms before execution.", requirements: ["Individual fMRI calibration", "Cooperating participant", "Language encoding model and candidate search"], metrics: ["Held-out semantic similarity", "Stimulus identification", "Neural ablation against language-prior baseline"], limitations: ["Meaning similarity does not establish verbatim recovery or a historical dream record."], paperIds: ["tang-2023"], datasetIds: ["semantic-decoding"], hypothesisIds: ["H-DECODE", "H-RECONSTRUCT"] },
];

export const researchHypotheses: ResearchHypothesis[] = [
  { id: "H-PERSIST", title: "Persistence of experience-specific information", statement: "Some experience-specific information may remain measurable after free recall fails.", null: "The preregistered decoder does not exceed the matched null at the specified retention interval.", measurableTarget: "Held-out event identification at 1 day, 1 week and 1 month, conditional on a predefined failed-free-recall test.", requirements: ["Prospective encoding ground truth", "Fixed retention intervals", "Cue-only and never-experienced controls", "Power or sensitivity analysis"], interpretation: "A positive finding bounds persistence to the tested task, feature and interval. A negative result bounds this measurement method, not every possible neural trace." },
  { id: "H-ACCESS", title: "Access and storage can diverge", statement: "Failure to recall may coexist with retained information accessible by another measure.", null: "Recognition or neural event identification remains at its matched chance baseline when free recall fails.", measurableTarget: "Difference between predefined free-recall failure and held-out recognition or neural identification.", requirements: ["Separate recall, recognition and neural outcomes", "Blind scoring", "Cue and response-bias controls"], interpretation: "Failure of one recall task is an operational definition of access, not proof that information is absolutely inaccessible." },
  { id: "H-REINSTATE", title: "Dream-state reinstatement", statement: "A subsequent sleep episode may share predefined episode-specific information with an earlier one.", null: "Continuation frequency or structural similarity does not differ from randomized condition and matched noncontinuation comparisons.", measurableTarget: "Blind-scored continuity versus interruption delay and assigned intention condition.", requirements: ["Timestamped immediate reports", "Recorded awakening and return-to-sleep events", "Randomized conditions", "All unsuccessful trials retained"], interpretation: "Report continuity is a behavioral result. Neural reinstatement requires an independent signal-based endpoint." },
  { id: "H-CONTINUITY", title: "Recurring dream structure", statement: "Reports judged as recurring may share measurable semantic, spatial or narrative structure.", null: "Shared structure is explained by generic motifs, report length, author style and matched random pairings.", measurableTarget: "Prospectively labeled continuation pairs rank above preregistered, time- and topic-matched nonmatches.", requirements: ["Sealed raw reports", "Fixed metric and candidate set", "Blind annotations", "Selection and vocabulary controls"], interpretation: "Text similarity measures reports, not permanent brain storage or identity of two subjective episodes." },
  { id: "H-LUCID", title: "Intentional dream timing anchors", statement: "Some lucid dreamers can provide intentional, timestamped responses during verified sleep.", null: "Predefined response signals are not discriminable from chance or artifact during verified sleep.", measurableTarget: "Blinded signal-detection accuracy and answer correctness during independently scored REM.", requirements: ["Polysomnography with EOG / EMG", "Pre-agreed signal pattern", "Independent sleep staging", "Ambiguous and no-response trials included"], interpretation: "Communication success establishes a constrained channel for the tested participants, not unrestricted dream reading." },
  { id: "H-DECODE", title: "Measured signal discrimination", statement: "Measured neural activity may distinguish predefined internal states above a matched null.", null: "Held-out performance does not exceed chance, nuisance-only models or shuffled-neural controls.", measurableTarget: "Balanced accuracy with group-held-out evaluation, confidence intervals and a nuisance-model comparison.", requirements: ["Labels independent of features", "Training-only preprocessing", "Subject/session/site groups", "Artifact checks", "Permutation exchangeability"], interpretation: "Sleep staging, report classification and content decoding are different targets and must have different result labels." },
  { id: "H-RECONSTRUCT", title: "Progressive reconstruction", statement: "Validated decoded features may constrain increasingly rich representations of an experience.", null: "Reconstruction does not improve event identification over generator-prior and neural-ablation controls.", measurableTarget: "Held-out feature recovery and stimulus identification attributable to neural input.", requirements: ["Validated upstream feature decoder", "Prior-only and shuffled-neural outputs", "Unseen stimulus identities", "Uncertainty and provenance"], interpretation: "Generated scenes for art or cinema may be useful creative interpretations. Scientific reconstructions need separate, measured evidence of fidelity." },
];

export function getResearchLibrary(query = "", domain = "all") {
  const q = query.trim().toLowerCase().slice(0, 200);
  const papers = researchPapers.filter((paper) =>
    (domain === "all" || paper.domains.some((value) => value === domain)) &&
    (!q || [paper.title, paper.authors, paper.journal, paper.finding, ...paper.domains, ...paper.hypothesisIds, ...paper.limitations].join(" ").toLowerCase().includes(q)),
  );
  return {
    schemaVersion: 1,
    verifiedAt: RESEARCH_VERIFIED_AT,
    claimBoundary: "Source review is not replication. Morpheus does not currently demonstrate permanent storage of every experience, historic dream recovery, or clinical efficacy.",
    papers,
    datasets: researchDatasets,
    models: researchModels,
    hypotheses: researchHypotheses,
    domains: RESEARCH_DOMAINS,
    developments: researchDevelopments,
  };
}

export type DreamPublicDataset = {
  id: string;
  source: "DREAM";
  title: string;
  description: string;
  version: string;
  modified: string;
  url: string;
  modalities: string[];
  samples: number | null;
  subjects: number | null;
  access: "Open" | "Private" | "Unspecified";
  license: string;
  hypothesisIds: HypothesisId[];
};

/** Parse RFC 4180-style records, including quoted commas, newlines and escaped quotes. */
export function parsePublicCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index++; }
      else if (quoted || field.length === 0) quoted = !quoted;
      else throw new Error("Unexpected quote in DREAM metadata");
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((value) => value.length)) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Unterminated field in DREAM metadata");
  row.push(field);
  if (row.some((value) => value.length)) rows.push(row);
  const headers = rows.shift() ?? [];
  if (!headers.length || new Set(headers).size !== headers.length) throw new Error("Invalid DREAM metadata header");
  return rows.map((values) => {
    if (values.length !== headers.length) throw new Error("DREAM metadata column count changed");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

export function safeResearchUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function mapDreamPublicDatasets(rows: Record<string, string>[]): DreamPublicDataset[] {
  const required = ["Set ID", "Amendment", "Common name", "Number of samples", "Number of subjects", "Data URL", "Accessibility", "Revoked", "Latest amendment"];
  if (rows.length && required.some((key) => !(key in rows[0]))) throw new Error("DREAM registry schema changed");
  const count = (value: string): number | null => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const publicDate = (value: string): string => {
    const timestamp = /^\d{10}$/.test(value) ? Number(value) * 1000 : /^\d{13}$/.test(value) ? Number(value) : Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
  };
  const active = rows.filter((row) => row.Revoked === "FALSE" && row["Latest amendment"] === "TRUE");
  const ids = new Set<string>();
  return active.map((row) => {
    const setId = row["Set ID"];
    if (!/^\d+$/.test(setId) || ids.has(setId)) throw new Error("DREAM registry has duplicate or invalid active dataset IDs");
    ids.add(setId);
    const access = row.Accessibility === "Open" ? "Open" : row.Accessibility === "Private" ? "Private" : "Unspecified";
    return {
      id: `dream-${setId}`, source: "DREAM", title: row["Common name"].slice(0, 200),
      description: "Sleep M/EEG paired with subjective experience reports. Metadata only; raw signals and individual reports are not loaded.",
      version: `amendment ${row.Amendment}`, modified: publicDate(row["Date approved"] || row["Date entered"] || ""),
      url: safeResearchUrl(row["Data URL"]) || "https://bridges.monash.edu/articles/dataset/The_DREAM_database/22133105",
      modalities: ["sleep M/EEG", "dream reports"], samples: count(row["Number of samples"]), subjects: count(row["Number of subjects"]), access,
      license: "DREAM registry: CC BY 4.0. Confirm each signal package's separate terms before download.", hypothesisIds: ["H-DECODE", "H-ACCESS"],
    };
  });
}
