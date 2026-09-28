const programs = [
  {
    id: "M0",
    name: "Dataset Zero",
    state: "executable",
    objective: "Immutable prospective dream ground truth and provenance.",
    software: ["IndexedDB", "SHA-256 sealing", "local export"],
    dependencies: [],
  },
  {
    id: "M1",
    name: "Recurrence & Continuity",
    state: "executable",
    objective: "Objective semantic, tag and modality continuity screening with an internal non-match null.",
    software: ["pairwise scoring", "deterministic null distribution", "candidate ranking"],
    dependencies: ["M0"],
  },
  {
    id: "M2",
    name: "Dream Reinstatement",
    state: "executable",
    objective: "Prospective controlled-awakening trials with fixed delay conditions and scored continuation outcomes.",
    software: ["local trial registry", "gateway markers", "delay-response summary"],
    dependencies: ["M0", "M1"],
  },
  {
    id: "M3",
    name: "Neural Decoding Baselines",
    state: "executable-harness",
    objective: "Leakage-controlled baseline evaluation before subject-specific decoding claims.",
    software: ["leave-one-session-out", "nearest-centroid baseline", "permutation null"],
    dependencies: [],
  },
  {
    id: "M4",
    name: "Live Neurophysiology",
    state: "executable-local",
    objective: "Bounded binary acquisition transport, timing provenance, local recording and signal-quality infrastructure.",
    software: ["Rust ring/packet core", "MRPH v1 batching", "LSL/BrainFlow adapters", "local recorders"],
    dependencies: ["M0", "M3"],
  },
  {
    id: "M5",
    name: "Individual Neural Atlas",
    state: "executable-foundation",
    objective: "Subject-local cross-session feature alignment across labeled states.",
    software: ["local snapshots", "state centroids", "cosine alignment", "M3 handoff"],
    dependencies: ["M3", "M4"],
  },
];

export async function GET() {
  return Response.json({
    hypothesis_status: "research",
    software_execution_status: "m0-m5-wired",
    programs,
    promotion_rule:
      "Software execution is not scientific validation; no downstream result substitutes for missing upstream evidence.",
  });
}
