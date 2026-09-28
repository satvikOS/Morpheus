const programs = [
  {
    id: "M0",
    name: "Dataset Zero",
    state: "active",
    objective: "Immutable prospective dream ground truth and provenance.",
    dependencies: [],
  },
  {
    id: "M1",
    name: "Recurrence & Continuity",
    state: "implementation",
    objective: "Objective semantic, spatial and narrative continuity measurement.",
    dependencies: ["M0"],
  },
  {
    id: "M2",
    name: "Dream Reinstatement",
    state: "protocol",
    objective: "Controlled awakening and continuation experiments.",
    dependencies: ["M0", "M1"],
  },
  {
    id: "M3",
    name: "Neural Decoding Baselines",
    state: "public-data",
    objective: "Leakage-controlled decoding baselines on open neurodata.",
    dependencies: [],
  },
  {
    id: "M4",
    name: "Live Neurophysiology",
    state: "bootstrap",
    objective: "Synchronized non-invasive acquisition and event markers.",
    dependencies: ["M0", "M3"],
  },
  {
    id: "M5",
    name: "Individual Neural Atlas",
    state: "research",
    objective: "Subject-specific alignment across perception, imagery, memory and sleep.",
    dependencies: ["M3", "M4"],
  },
];

export async function GET() {
  return Response.json({
    hypothesis_status: "research",
    programs,
    promotion_rule:
      "No downstream result substitutes for missing upstream validation.",
  });
}
