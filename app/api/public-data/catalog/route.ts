import { NextRequest } from "next/server";

type SourceConfig = {
  id: string;
  label: string;
  route?: string;
  institution: string;
  platform: string;
  access_mode:
    | "anonymous-api"
    | "authenticated-api"
    | "registration"
    | "controlled"
    | "download-license"
    | "portal";
  capability: string;
  homepage: string;
  status_note?: string;
};

const sources: SourceConfig[] = [
  {
    id: "dream",
    label: "DREAM",
    route: "/api/public-data/dream",
    institution: "International DREAM collaboration",
    platform: "Figshare versioned public metadata",
    access_mode: "anonymous-api",
    capability: "Sleep EEG and mentation registry; preserve without-recall and no-experience labels",
    homepage: "https://bridges.monash.edu/articles/dataset/The_DREAM_database/22133105",
    status_note: "Access differs by source dataset. This adapter imports registry metadata only.",
  },
  {
    id: "dandi",
    label: "DANDI",
    route: "/api/public-data/dandi",
    institution: "DANDI Archive",
    platform: "DANDI REST API",
    access_mode: "anonymous-api",
    capability: "NWB electrophysiology, imaging and neurophysiology datasets",
    homepage: "https://dandiarchive.org/",
  },
  {
    id: "openneuro",
    label: "OpenNeuro",
    route: "/api/public-data/openneuro",
    institution: "OpenNeuro",
    platform: "OpenNeuro GraphQL",
    access_mode: "anonymous-api",
    capability: "Public BIDS neuroimaging datasets and metadata",
    homepage: "https://openneuro.org/",
  },
  {
    id: "neurovault",
    label: "NeuroVault",
    route: "/api/public-data/neurovault",
    institution: "NeuroVault",
    platform: "NeuroVault REST API",
    access_mode: "anonymous-api",
    capability: "Statistical maps, atlases and public neuroimaging volumes",
    homepage: "https://neurovault.org/",
  },
  {
    id: "allen",
    label: "Allen Brain Atlas",
    route: "/api/public-data/allen",
    institution: "Allen Institute for Brain Science",
    platform: "Allen Brain Map RMA API",
    access_mode: "anonymous-api",
    capability: "Anatomy ontology, reference atlas and molecular brain metadata",
    homepage: "https://brain-map.org/",
  },
  {
    id: "zenodo",
    label: "Zenodo",
    route: "/api/public-data/zenodo",
    institution: "CERN / OpenAIRE",
    platform: "Zenodo REST API",
    access_mode: "anonymous-api",
    capability: "Open neuroscience research records and datasets",
    homepage: "https://zenodo.org/",
  },
  {
    id: "ebrains",
    label: "EBRAINS KG",
    institution: "EBRAINS",
    platform: "EBRAINS Knowledge Graph Core API",
    access_mode: "authenticated-api",
    capability: "Multi-level atlases, datasets, models and simulation metadata",
    homepage: "https://search.kg.ebrains.eu/",
    status_note: "Production KG access requires EBRAINS authentication.",
  },
  {
    id: "hcp",
    label: "Human Connectome Project",
    institution: "WashU / UMN / Oxford / Inati",
    platform: "ConnectomeDB / XNAT",
    access_mode: "registration",
    capability: "Structural, functional and diffusion MRI connectome datasets",
    homepage: "https://www.humanconnectome.org/",
    status_note: "Open-access data require ConnectomeDB registration and data-use terms.",
  },
  {
    id: "ukbiobank",
    label: "UK Biobank",
    institution: "UK Biobank",
    platform: "UKB Research Analysis Platform",
    access_mode: "controlled",
    capability: "Longitudinal imaging, genetic and health-linked research data",
    homepage: "https://www.ukbiobank.ac.uk/",
    status_note: "Controlled research access; not an anonymous public API.",
  },
  {
    id: "brainnetome",
    label: "Brainnetome Atlas",
    institution: "CAS Institute of Automation",
    platform: "Brainnetome Atlas Portal",
    access_mode: "download-license",
    capability: "Fine-grained human brain parcellations and connectivity maps",
    homepage: "https://atlas.brainnetome.org/",
    status_note: "Downloadable research data are subject to Brainnetome licensing terms.",
  },
  {
    id: "childmind",
    label: "Healthy Brain Network",
    institution: "Child Mind Institute",
    platform: "Healthy Brain Network",
    access_mode: "portal",
    capability: "Developmental MRI, EEG and phenotypic research datasets",
    homepage: "https://healthybrainnetwork.org/",
    status_note: "Portal-backed research source; no anonymous Morpheus adapter is enabled yet.",
  },
  {
    id: "biccn",
    label: "BICCN / BIL",
    institution: "NIH BRAIN Initiative Cell Census Network",
    platform: "Brain Image Library / cell census resources",
    access_mode: "portal",
    capability: "Multi-omic cell atlases, microscopy and brain image resources",
    homepage: "https://biccn.org/",
    status_note: "Federated project resources; adapter requires source-specific endpoints.",
  },
  {
    id: "maxplanck",
    label: "Max Planck HCP / OpenNeuro",
    institution: "Max Planck Institute for Human Cognitive and Brain Sciences",
    platform: "OpenNeuro / institutional repositories",
    access_mode: "portal",
    capability: "High-field MRI, connectivity and behavioral neuroimaging resources",
    homepage: "https://www.cbs.mpg.de/",
    status_note: "Morpheus ingests public OpenNeuro records through the OpenNeuro adapter; institution-specific repositories are federated separately.",
  },
  {
    id: "mni",
    label: "MNI / The Neuro",
    institution: "Montreal Neurological Institute-Hospital",
    platform: "BIC / Open Science resources",
    access_mode: "portal",
    capability: "Reference neuroimaging, templates and open-science brain resources",
    homepage: "https://www.mcgill.ca/neuro/",
    status_note: "Open-science resources are distributed across multiple services.",
  },
];

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  const origin = request.nextUrl.origin;

  const results = await Promise.all(
    sources.map(async (source) => {
      if (!source.route) {
        return {
          ...source,
          route: "",
          ok: false,
          latency_ms: 0,
          datasets: [],
          error: null,
        };
      }

      const url = new URL(source.route, origin);
      if (q) url.searchParams.set("q", q);
      const started = performance.now();

      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
        const payload = await response.json();

        return {
          ...source,
          ok: response.ok && payload.ok !== false,
          latency_ms: Math.round(performance.now() - started),
          datasets: Array.isArray(payload.datasets)
            ? payload.datasets
            : [],
          error: payload.error || null,
        };
      } catch (error) {
        return {
          ...source,
          ok: false,
          latency_ms: Math.round(performance.now() - started),
          datasets: [],
          error:
            error instanceof Error ? error.message : "Failed",
        };
      }
    }),
  );

  return Response.json({
    ok: results.some((source) => source.ok),
    query: q,
    sources: results,
    fetched_at: new Date().toISOString(),
  });
}
