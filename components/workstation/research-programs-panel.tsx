"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  BrainCircuit,
  Database,
  FlaskConical,
  Network,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { Panel, SectionHeader } from "./ui";

type Program = {
  id: string;
  title: string;
  status: string;
  objective: string;
  nullHypothesis: string;
  inputs: string[];
  outputs: string[];
  gates: string[];
  methods: string[];
};

const programs: Program[] = [
  {
    id: "M0",
    title: "Dataset Zero",
    status: "ACTIVE",
    objective: "Create immutable, machine-readable dream ground truth with timestamps, provenance and separated annotations.",
    nullHypothesis: "No structured recurrence or testable continuity can be established beyond subjective post-hoc interpretation.",
    inputs: ["Immediate raw reports", "Capture timestamps", "Sleep metadata", "Lucidity and confidence"],
    outputs: ["SHA-256 sealed records", "Structured annotations", "Dream IDs", "Exportable local corpus"],
    gates: ["Raw report never rewritten", "Prospective capture", "Negative/non-match records retained"],
    methods: ["Schema validation", "Hashing", "Event graph", "Prospective recordkeeping"],
  },
  {
    id: "M1",
    title: "Recurrence & Continuity",
    status: "IMPLEMENTATION",
    objective: "Measure whether recurring/continuing dreams share semantic, spatial or narrative structure above chance.",
    nullHypothesis: "Apparent continuations are explainable by generic similarity, reconstruction and selection effects.",
    inputs: ["M0 corpus", "Embeddings", "Location/object annotations", "Temporal links"],
    outputs: ["Similarity matrix", "Dream graph", "Cluster labels", "Blinded comparison reports"],
    gates: ["Predefined similarity metric", "All candidate matches included", "Chance baseline"],
    methods: ["Vector similarity", "Graph analysis", "Sequence alignment", "Permutation tests"],
  },
  {
    id: "M2",
    title: "Dream Reinstatement",
    status: "PROTOCOL",
    objective: "Test short-term continuation after controlled awakening and varying interruption intervals.",
    nullHypothesis: "Continuation probability does not differ by interruption interval or pre-registered intention condition.",
    inputs: ["Sleep-stage timing", "Awakening markers", "Immediate reports", "Return-to-sleep delay"],
    outputs: ["Continuation score", "Delay-response curve", "Protocol logs", "Marker-aligned sessions"],
    gates: ["Pre-registered criteria", "Exact interruption timing", "Blind continuity scoring where possible"],
    methods: ["Controlled awakenings", "Marker synchronization", "Within-subject comparison"],
  },
  {
    id: "M3",
    title: "Neural Decoding Baselines",
    status: "PUBLIC DATA",
    objective: "Reproduce published decoding baselines on open EEG/fMRI datasets before subject-specific dream decoding.",
    nullHypothesis: "Decoding performance does not exceed held-out/chance baselines under leakage-controlled evaluation.",
    inputs: ["DANDI", "OpenNeuro", "NeuroVault", "Feature pipelines"],
    outputs: ["Reproducible runs", "Held-out metrics", "Model cards", "Versioned checkpoints"],
    gates: ["No train/test leakage", "Dataset provenance", "Reproducible preprocessing"],
    methods: ["MNE/BIDS", "Cross-validation", "Representation learning", "Calibration"],
  },
  {
    id: "M4",
    title: "Live Neurophysiology",
    status: "BOOTSTRAP",
    objective: "Acquire synchronized non-invasive neural/physiological signals with bounded latency and exact event markers.",
    nullHypothesis: "Measured signals do not contain stable task/dream-state information above artifact and chance.",
    inputs: ["LSL streams", "BrainFlow devices", "Markers", "Session manifests"],
    outputs: ["Multichannel recordings", "Quality metrics", "XDF/NWB sessions", "Synchronized events"],
    gates: ["Clock synchronization", "Signal quality", "Artifact logging", "Local raw storage"],
    methods: ["LSL", "BrainFlow", "MNE", "XDF/NWB", "DSP workers"],
  },
  {
    id: "M5",
    title: "Individual Neural Atlas",
    status: "RESEARCH",
    objective: "Build subject-specific representational alignment across perception, imagery, memory and sleep states.",
    nullHypothesis: "Cross-session representations are not stable enough to support subject-specific state identification or reconstruction.",
    inputs: ["Awake calibration", "Imagery tasks", "Sleep sessions", "Validated M3/M4 models"],
    outputs: ["Subject atlas", "Cross-session alignment", "Latent state trajectories", "Reconstruction inputs"],
    gates: ["Within-subject replication", "Held-out sessions", "Uncertainty calibration", "No overclaiming reconstruction"],
    methods: ["Multimodal alignment", "Contrastive learning", "Temporal models", "Subject-specific decoders"],
  },
];

const icons = [Database, Network, FlaskConical, BrainCircuit, Radio, Activity];

export default function ResearchProgramsPanel() {
  const [selected, setSelected] = useState("M0");
  const program = useMemo(
    () => programs.find((item) => item.id === selected) || programs[0],
    [selected],
  );

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Morpheus research stack"
          title="M0 → M5 programs"
          description="Each program has an explicit objective, null hypothesis, inputs, outputs and promotion gates. A downstream milestone cannot substitute for missing evidence upstream."
          action={<span className="tag">{program.id} SELECTED</span>}
        />
        <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
          {programs.map((item, index) => {
            const Icon = icons[index];
            return (
              <button
                key={item.id}
                onClick={() => setSelected(item.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  selected === item.id
                    ? "border-sky-300/20 bg-sky-300/[.05]"
                    : "border-white/[.07] bg-black/10 hover:bg-white/[.02]"
                }`}
              >
                <Icon size={15} className="text-slate-500" />
                <div className="mt-5 font-mono text-sm text-sky-200">{item.id}</div>
                <div className="mt-1 text-xs font-medium text-slate-300">{item.title}</div>
                <div className="mt-3 tag-muted">{item.status}</div>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <Panel>
          <SectionHeader eyebrow={program.id} title={program.title} />
          <div className="space-y-5 p-5">
            <div>
              <div className="program-label">Objective</div>
              <p className="program-copy">{program.objective}</p>
            </div>
            <div>
              <div className="program-label">Null hypothesis</div>
              <p className="program-copy">{program.nullHypothesis}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <List title="Inputs" items={program.inputs} />
              <List title="Outputs" items={program.outputs} />
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader eyebrow="Evidence discipline" title="Promotion gates" />
          <div className="space-y-3 p-4">
            {program.gates.map((gate, index) => (
              <div key={gate} className="flex gap-3 rounded-xl border border-white/[.06] bg-black/10 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[.07] font-mono text-[10px] text-sky-300">
                  {index + 1}
                </span>
                <span className="text-xs leading-5 text-slate-400">{gate}</span>
              </div>
            ))}
            <div className="mt-4 rounded-xl border border-emerald-300/10 bg-emerald-300/[.025] p-4">
              <div className="flex items-center gap-2 text-xs text-emerald-200/80">
                <ShieldCheck size={14} /> Scientific state
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-600">
                Program status describes engineering/research readiness, not proof of the underlying Morpheus persistence hypothesis.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader eyebrow="Methods" title={`${program.id} execution stack`} />
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {program.methods.map((method) => (
            <div key={method} className="rounded-xl border border-white/[.07] bg-black/10 p-4">
              <div className="text-xs font-medium text-slate-300">{method}</div>
              <div className="mt-3 h-1 rounded-full bg-gradient-to-r from-sky-300/35 to-transparent" />
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionHeader eyebrow="Dependency graph" title="Research ordering" />
        <div className="overflow-x-auto p-4">
          <div className="flex min-w-[900px] items-center gap-3">
            {programs.map((item, index) => (
              <div className="flex flex-1 items-center gap-3" key={item.id}>
                <button
                  onClick={() => setSelected(item.id)}
                  className={`flex-1 rounded-xl border p-4 text-left ${
                    selected === item.id ? "border-sky-300/20 bg-sky-300/[.04]" : "border-white/[.06] bg-black/10"
                  }`}
                >
                  <div className="font-mono text-xs text-sky-200">{item.id}</div>
                  <div className="mt-2 text-[11px] text-slate-500">{item.title}</div>
                </button>
                {index < programs.length - 1 ? <span className="text-slate-750">→</span> : null}
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="program-label">{title}</div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item} className="rounded-lg border border-white/[.055] bg-black/10 px-3 py-2 text-[11px] text-slate-500">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
