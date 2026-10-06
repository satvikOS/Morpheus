"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  BrainCircuit,
  Database,
  FlaskConical,
  Network,
  Play,
  Radio,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { WorkstationView } from "@/lib/morpheus";
import {
  longitudinalAtlasSummary,
  normalizeAtlasSnapshot,
  deleteAtlasSnapshot,
  listAtlasSnapshots,
  putAtlasSnapshot,
  type AtlasSnapshot,
} from "@/lib/atlas-store";
import {
  SignalWorkerClient,
  type SignalAnalysis,
} from "@/lib/worker-client";
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
  route: WorkstationView;
  software: string[];
};

type ResearchWorkerResult = {
  id: string;
  ok: boolean;
  result?: Record<string, any>;
  error?: string;
  latencyMs?: number;
};

const programs: Program[] = [
  {
    id: "M0",
    title: "Dataset Zero",
    status: "EXECUTABLE",
    objective:
      "Create immutable, machine-readable dream reports with timestamps, provenance and separated annotations.",
    nullHypothesis:
      "No structured recurrence or testable continuity can be established beyond subjective post-hoc interpretation.",
    inputs: ["Immediate raw reports", "Capture timestamps", "Sleep metadata", "Lucidity and confidence"],
    outputs: ["SHA-256 sealed records", "Structured annotations", "Dream IDs", "Exportable local corpus"],
    gates: ["Raw report never rewritten", "Prospective capture", "Negative/non-match records retained"],
    methods: ["IndexedDB", "Schema validation", "SHA-256", "Prospective recordkeeping"],
    route: "dataset",
    software: ["Local immutable capture", "Browser cryptographic seal", "Local persistent corpus", "Export and recurrence handoff"],
  },
  {
    id: "M1",
    title: "Recurrence & Continuity",
    status: "EXECUTABLE",
    objective:
      "Measure whether recurring or continuing dreams share semantic, spatial or narrative structure above chance.",
    nullHypothesis:
      "Apparent continuations are explainable by generic similarity, reconstruction and selection effects.",
    inputs: ["M0 corpus", "Lexical features", "Tags and modalities", "Temporal links"],
    outputs: ["Similarity matrix", "Ranked candidate pairs", "Dream graph inputs", "Blinded comparison candidates"],
    gates: ["Predefined similarity metric", "All candidate matches included", "Chance/permutation baseline before claims"],
    methods: ["Cosine similarity", "Jaccard overlap", "Pairwise ranking", "Permutation-ready scoring"],
    route: "dataset",
    software: ["Deterministic pairwise scorer", "Candidate ranking", "Raw reports remain local", "Negative pairs retained"],
  },
  {
    id: "M2",
    title: "Dream Reinstatement",
    status: "EXECUTABLE",
    objective:
      "Test short-term continuation after controlled awakening and varying interruption intervals.",
    nullHypothesis:
      "Continuation probability does not differ by interruption interval or pre-registered intention condition.",
    inputs: ["Sleep-stage timing", "Awakening markers", "Immediate reports", "Return-to-sleep delay"],
    outputs: ["Continuation score", "Delay-response data", "Protocol logs", "Marker-aligned sessions"],
    gates: ["Pre-registered criteria", "Clock quality attached to markers", "Blind continuity scoring where possible"],
    methods: ["Controlled awakenings", "Gateway markers", "Local session recording", "Within-subject comparison"],
    route: "experiments",
    software: ["Session recorder controls", "Marker classes and timestamps", "Reinstatement protocol surface", "Local provenance manifest"],
  },
  {
    id: "M3",
    title: "Neural Decoding Baselines",
    status: "EXECUTABLE HARNESS",
    objective:
      "Run leakage-controlled decoding baselines before any subject-specific dream-decoding claim.",
    nullHypothesis:
      "Decoding performance does not exceed held-out or permutation baselines.",
    inputs: ["Labeled feature snapshots", "Session IDs", "Public or local feature matrices", "Fixed feature schema"],
    outputs: ["Held-out accuracy", "Balanced accuracy", "Permutation null", "Confusion matrix"],
    gates: ["No same-session leakage", "Explicit chance baseline", "Fixed feature width", "Reproducible labels and provenance"],
    methods: ["Leave-one-session-out", "Nearest-centroid baseline", "Permutation testing", "Worker-isolated evaluation"],
    route: "models",
    software: ["Worker-isolated baseline engine", "Session-level holdout", "Permutation null distribution", "Confusion and per-state evaluation"],
  },
  {
    id: "M4",
    title: "Live Neurophysiology",
    status: "EXECUTABLE LOCAL",
    objective:
      "Acquire synchronized non-invasive neural and physiological signals with bounded buffers and explicit timing provenance.",
    nullHypothesis:
      "Measured signals do not contain stable task or dream-state information above artifact and chance.",
    inputs: ["Native MRPH batches", "LSL streams", "BrainFlow adapters", "Markers"],
    outputs: ["Multichannel recordings", "Quality metrics", "NWB conversion", "Synchronized events"],
    gates: ["Local authoritative acquisition", "Sequence/drop accounting", "Clock provenance", "Local raw storage"],
    methods: ["Rust ring buffer", "MRPH binary batching", "WebRTC relay", "LSL / BrainFlow adapters"],
    route: "acquisition",
    software: ["Native Rust packet/ring core", "Binary batched browser ingest", "Shared display ring", "Local recording and SHA-256 manifest"],
  },
  {
    id: "M5",
    title: "Individual Neural Atlas",
    status: "EXECUTABLE FOUNDATION",
    objective:
      "Build subject-specific representational alignment across perception, imagery, memory and sleep states.",
    nullHypothesis:
      "Cross-session representations are not stable enough to support subject-specific state identification or reconstruction.",
    inputs: ["Awake calibration", "Imagery tasks", "Sleep sessions", "Validated M3/M4 features"],
    outputs: ["Subject-local state atlas", "Cross-session centroids", "Similarity matrix", "Decoder-ready feature records"],
    gates: ["Within-subject replication", "Held-out sessions", "Fixed feature schema", "Uncertainty retained"],
    methods: ["Local atlas snapshots", "State centroids", "Cosine alignment", "Leakage-controlled decoder handoff"],
    route: "visual",
    software: ["Local subject/session registry", "Live feature snapshot capture", "State-centroid alignment", "M3 decoder handoff"],
  },
];

const icons = [Database, Network, FlaskConical, BrainCircuit, Radio, Activity];

export default function ResearchProgramsPanel({
  onNavigate,
  channelSamples,
  sampleRate,
  sourceName,
  sourceMode,
}: {
  onNavigate: (view: WorkstationView) => void;
  channelSamples: number[][];
  sampleRate: number;
  sourceName: string;
  sourceMode: "live" | "simulation" | "idle";
}) {
  const [selected, setSelected] = useState("M0");
  const [snapshots, setSnapshots] = useState<AtlasSnapshot[]>([]);
  const [subjectId, setSubjectId] = useState("subject-001");
  const [sessionId, setSessionId] = useState("session-001");
  const [stateLabel, setStateLabel] = useState<AtlasSnapshot["state"]>("awake");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baseline, setBaseline] = useState<Record<string, any> | null>(null);
  const [atlas, setAtlas] = useState<Record<string, any> | null>(null);
  const [runtimeError, setRuntimeError] = useState("");

  const signalWorker = useRef<SignalWorkerClient | null>(null);
  const researchWorker = useRef<Worker | null>(null);
  const pending = useRef(
    new Map<
      string,
      {
        resolve: (value: ResearchWorkerResult) => void;
        reject: (error: Error) => void;
      }
    >(),
  );

  const program = useMemo(
    () => programs.find((item) => item.id === selected) || programs[0],
    [selected],
  );

  useEffect(() => {
    signalWorker.current = new SignalWorkerClient();
    signalWorker.current.start();

    const worker = new Worker("/workers/research-worker.js");
    researchWorker.current = worker;
    worker.onmessage = (event) => {
      const message = event.data as ResearchWorkerResult;
      const request = pending.current.get(message.id);
      if (!request) return;
      pending.current.delete(message.id);
      if (message.ok) request.resolve(message);
      else request.reject(new Error(message.error || "Research worker failed"));
    };

    void listAtlasSnapshots().then((rows) => setSnapshots(rows.map(normalizeAtlasSnapshot))).catch((error: unknown) => setRuntimeError(error instanceof Error ? error.message : "Atlas storage could not be loaded."));

    return () => {
      signalWorker.current?.stop();
      worker.terminate();
      researchWorker.current = null;
      for (const request of pending.current.values()) {
        request.reject(new Error("Research worker stopped"));
      }
      pending.current.clear();
    };
  }, []);

  const runResearchWorker = (
    type: "baseline" | "atlas",
    rows: AtlasSnapshot[],
  ) => {
    const worker = researchWorker.current;
    if (!worker) {
      return Promise.reject(new Error("Research worker is unavailable."));
    }

    const normalized = rows.map(normalizeAtlasSnapshot);
    const families = new Set(normalized.map((row) => JSON.stringify([row.provenance?.sourceKind, row.provenance?.featureSchema, row.featureNames])));
    if (families.size > 1) return Promise.reject(new Error("Incompatible source kinds or feature schemas. Keep simulation, acquired and unknown measurements in separate evaluations."));
    const id = crypto.randomUUID();
    return new Promise<ResearchWorkerResult>((resolve, reject) => {
      pending.current.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type,
        permutations: 120,
        rows: normalized.map((snapshot) => ({
          id: snapshot.id,
          sessionId: snapshot.sessionId,
          subjectId: snapshot.subjectId,
          sourceKind: snapshot.provenance?.sourceKind,
          featureSchema: snapshot.provenance?.featureSchema,
          featureNames: snapshot.featureNames,
          label: snapshot.state,
          features: snapshot.features,
        })),
      });

      window.setTimeout(() => {
        const request = pending.current.get(id);
        if (!request) return;
        pending.current.delete(id);
        reject(new Error("Research worker timeout"));
      }, 8000);
    });
  };

  const captureAtlasSnapshot = async () => {
    setRuntimeError("");
    if (!channelSamples.length) {
      setRuntimeError(
        "No signal window is available. Connect a local source or use Simulation to exercise the software path.",
      );
      return;
    }

    setCaptureBusy(true);
    try {
      const analysis = await signalWorker.current?.analyzeChannels(
        channelSamples,
        Math.max(1, sampleRate || 256),
      );

      if (!analysis) throw new Error("Signal analysis did not return.");

      const snapshot = normalizeAtlasSnapshot(featureSnapshot({
        subjectId,
        sessionId,
        state: stateLabel,
        sourceName: sourceName || "unknown",
        sourceMode,
        sampleRate: Math.max(1, sampleRate || 256),
        channelCount: channelSamples.length,
        analysis: analysis.metrics,
      }));

      await putAtlasSnapshot(snapshot);
      const next = [...snapshots, snapshot];
      setSnapshots(next);

      const atlasResult = await runResearchWorker(
        "atlas",
        next.filter((item) => item.subjectId === subjectId),
      );
      setAtlas(atlasResult.result || null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : "Unable to capture atlas snapshot.",
      );
    } finally {
      setCaptureBusy(false);
    }
  };

  const runBaseline = async () => {
    setRuntimeError("");
    setBaselineBusy(true);
    try {
      const rows = snapshots.filter((item) => item.subjectId === subjectId);
      const result = await runResearchWorker("baseline", rows);
      setBaseline(result.result || null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : "Baseline evaluation failed.",
      );
    } finally {
      setBaselineBusy(false);
    }
  };

  const clearSnapshot = async (id: string) => {
    setRuntimeError("");
    try {
      await deleteAtlasSnapshot(id);
      const next = snapshots.filter((item) => item.id !== id);
      setSnapshots(next); setBaseline(null);
      const subjectRows = next.filter((item) => item.subjectId === subjectId);
      if (subjectRows.length) {
        const result = await runResearchWorker("atlas", subjectRows);
        setAtlas(result.result || null);
      } else setAtlas(null);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Unable to delete the local snapshot or refresh the atlas.");
    }
  };

  const subjectSnapshots = snapshots.filter((item) => item.subjectId === subjectId);
  const stateCount = new Set(subjectSnapshots.map((item) => item.state)).size;

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Morpheus research stack"
          title="M0 → M5 execution programs"
          description="Every program maps to executable workstation software. Engineering completeness remains separate from scientific validation: a working toolchain is not evidence that a research hypothesis is true."
          action={<span className="tag">{program.id} · {program.status}</span>}
        />

        <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
          {programs.map((item, index) => {
            const Icon = icons[index];
            return (
              <button
                key={item.id}
                onClick={() => setSelected(item.id)}
                className={selected === item.id ? "program-card program-card-active" : "program-card"}
              >
                <Icon size={15} />
                <div className="program-card-id">{item.id}</div>
                <div className="program-card-title">{item.title}</div>
                <div className="program-card-state">{item.status}</div>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <Panel>
          <SectionHeader
            eyebrow={program.id}
            title={program.title}
            action={
              <button className="button-primary" onClick={() => onNavigate(program.route)}>
                <Play size={12} />
                Open execution surface
              </button>
            }
          />
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
          <SectionHeader eyebrow="Software coverage" title="Implemented execution path" />
          <div className="space-y-2 p-4">
            {program.software.map((item) => (
              <div key={item} className="program-check">
                <ShieldCheck size={13} />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-white/[.06] p-4">
            <div className="program-label">Promotion gates</div>
            <div className="mt-3 space-y-2">
              {program.gates.map((gate, index) => (
                <div key={gate} className="program-gate">
                  <span>{index + 1}</span>
                  {gate}
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {selected === "M3" || selected === "M5" ? (
        <Panel>
          <SectionHeader
            eyebrow="Subject-local execution"
            title={selected === "M5" ? "Individual atlas builder" : "Leakage-controlled decoder baseline"}
            description="Snapshots remain in browser IndexedDB. State labels are explicit; the baseline worker excludes matching session IDs from each held-out evaluation."
          />

          <div className="research-runtime-grid">
            <div className="research-runtime-control">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field-label">
                  <span>Subject ID</span>
                  <input
                    value={subjectId}
                    onChange={(event) =>
                      setSubjectId(
                        event.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64),
                      )
                    }
                    className="research-input"
                  />
                </label>

                <label className="field-label">
                  <span>Session ID</span>
                  <input
                    value={sessionId}
                    onChange={(event) =>
                      setSessionId(
                        event.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64),
                      )
                    }
                    className="research-input"
                  />
                </label>
              </div>

              <label className="field-label mt-3 block">
                <span>State label</span>
                <select
                  value={stateLabel}
                  onChange={(event) =>
                    setStateLabel(event.target.value as AtlasSnapshot["state"])
                  }
                  className="research-input"
                >
                  <option value="awake">Awake</option>
                  <option value="imagery">Imagery</option>
                  <option value="sleep">Sleep</option>
                  <option value="dream">Dream</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <button
                className="button-primary mt-4 w-full"
                onClick={() => void captureAtlasSnapshot()}
                disabled={captureBusy}
              >
                <Save size={13} />
                {captureBusy ? "Extracting features..." : "Capture current feature snapshot"}
              </button>

              <div className="research-runtime-stats">
                <div><span>Snapshots</span><strong>{subjectSnapshots.length}</strong></div>
                <div><span>States</span><strong>{stateCount}</strong></div>
                <div><span>Source</span><strong>{sourceMode.toUpperCase()}</strong></div>
                <div><span>Rate</span><strong>{sampleRate || "—"} Hz</strong></div>
              </div>

              {selected === "M3" ? (
                <button
                  className="button-secondary mt-3 w-full"
                  onClick={() => void runBaseline()}
                  disabled={baselineBusy || subjectSnapshots.length < 4 || stateCount < 2}
                >
                  <BrainCircuit size={13} />
                  {baselineBusy ? "Evaluating..." : "Run held-out + permutation baseline"}
                </button>
              ) : null}

              {runtimeError ? <div className="visual-error mt-3">{runtimeError}</div> : null}
            </div>

            <div className="research-runtime-output">
              {selected === "M3" ? (
                <BaselineResult result={baseline} />
              ) : (
                <><AtlasResult result={atlas} snapshots={subjectSnapshots} onDelete={clearSnapshot} /><LongitudinalAtlas snapshots={subjectSnapshots} subjectId={subjectId} /></>
              )}
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel>
        <SectionHeader eyebrow="Methods" title={program.id + " execution stack"} />
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {program.methods.map((method) => (
            <div key={method} className="program-method">
              <div>{method}</div>
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
                  className={
                    selected === item.id
                      ? "program-dependency program-dependency-active"
                      : "program-dependency"
                  }
                >
                  <div className="font-mono text-xs text-slate-200">{item.id}</div>
                  <div className="mt-2 text-[11px] text-slate-500">{item.title}</div>
                </button>
                {index < programs.length - 1 ? <span className="text-slate-700">→</span> : null}
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function featureSnapshot({
  subjectId,
  sessionId,
  state,
  sourceName,
  sourceMode,
  sampleRate,
  channelCount,
  analysis,
}: {
  subjectId: string;
  sessionId: string;
  state: AtlasSnapshot["state"];
  sourceName: string;
  sourceMode: "live" | "simulation" | "idle";
  sampleRate: number;
  channelCount: number;
  analysis: SignalAnalysis;
}): AtlasSnapshot {
  const featureNames = [
    "mean",
    "rms",
    "peak",
    "zeroCrossings",
    "flatlineRatio",
    "clippingRatio",
    "delta",
    "theta",
    "alpha",
    "beta",
    "gamma",
  ];

  const features = [
    analysis.mean,
    analysis.rms,
    analysis.peak,
    analysis.zeroCrossings,
    analysis.flatlineRatio,
    analysis.clippingRatio,
    analysis.bands.delta || 0,
    analysis.bands.theta || 0,
    analysis.bands.alpha || 0,
    analysis.bands.beta || 0,
    analysis.bands.gamma || 0,
  ];

  return {
    id: crypto.randomUUID(),
    subjectId: subjectId || "subject-001",
    sessionId: sessionId || crypto.randomUUID(),
    state,
    capturedAt: new Date().toISOString(),
    source: sourceName,
    sampleRate,
    channelCount,
    features,
    featureNames,
    metadata: {
      sourceMode,
      featureSchema: "morpheus-atlas-features-v1",
    },
  };
}

function BaselineResult({ result }: { result: Record<string, any> | null }) {
  if (!result) {
    return (
      <div className="research-empty">
        Capture at least four snapshots from at least two labeled states and at least three sessions, with both states in each session.
      </div>
    );
  }

  return (
    <div>
      <div className="program-label">Held-out evaluation</div>
      <div className="research-result-grid">
        <ResultMetric label="Accuracy" value={(Number(result.accuracy || 0) * 100).toFixed(1) + "%"} />
        <ResultMetric label="Balanced" value={(Number(result.balancedAccuracy || 0) * 100).toFixed(1) + "%"} />
        <ResultMetric label="Null mean" value={(Number(result.nullMean || 0) * 100).toFixed(1) + "%"} />
        <ResultMetric label="Permutation p" value={Number(result.permutationP || 1).toFixed(3)} />
      </div>
      <div className="research-result-note">
        {String(result.validation || "")} · {String(result.classifier || "")} · {String(result.rows || 0)} snapshots · {String(result.featureLength || 0)} features
      </div>
      <p className="research-result-note">{String(result.nullMethod || "Within-session label-shuffle reference.")}</p>
      {Array.isArray(result.limitations) ? result.limitations.map((limit: unknown, index: number) => <p className="research-result-note" key={index}>{String(limit)}</p>) : null}
    </div>
  );
}

function AtlasResult({
  result,
  snapshots,
  onDelete,
}: {
  result: Record<string, any> | null;
  snapshots: AtlasSnapshot[];
  onDelete: (id: string) => Promise<void>;
}) {
  const similarities = Array.isArray(result?.similarities) ? result.similarities : [];

  return (
    <div>
      <div className="program-label">Subject atlas</div>

      {result ? (
        <div className="research-result-grid">
          <ResultMetric label="States" value={String(result.states?.length || 0)} />
          <ResultMetric label="Snapshots" value={String(result.snapshots || 0)} />
          <ResultMetric label="Pairs" value={String(similarities.length)} />
        </div>
      ) : (
        <div className="research-empty">
          Capture a live or simulated feature snapshot to initialize the local atlas.
        </div>
      )}

      {similarities.length ? (
        <div className="mt-4">
          <div className="program-label">State similarity</div>
          <div className="mt-2 space-y-1">
            {similarities.slice(0, 12).map((item: any) => (
              <div className="atlas-similarity-row" key={String(item.a) + "-" + String(item.b)}>
                <span>{String(item.a)} ↔ {String(item.b)}</span>
                <strong>{Number(item.cosine || 0).toFixed(3)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {snapshots.length ? (
        <div className="mt-4">
          <div className="program-label">Local snapshots</div>
          <div className="mt-2 max-h-48 overflow-auto">
            {snapshots
              .slice()
              .reverse()
              .map((snapshot) => (
                <div key={snapshot.id} className="atlas-snapshot-row">
                  <div>
                    <strong>{snapshot.state}</strong>
                    <span>
                      {snapshot.sessionId} · {new Date(snapshot.capturedAt).toLocaleString()}
                    </span>
                  </div>
                  <button
                    className="button-icon"
                    onClick={() => void onDelete(snapshot.id)}
                    title="Delete local atlas snapshot"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="program-label">{title}</div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item} className="program-list-item">{item}</div>
        ))}
      </div>
    </div>
  );
}


function LongitudinalAtlas({ snapshots, subjectId }: { snapshots: AtlasSnapshot[]; subjectId: string }) {
  const trajectories = useMemo(() => longitudinalAtlasSummary(snapshots, subjectId), [snapshots, subjectId]);
  return <div className="mt-5 border-t border-white/10 pt-4">
    <h3 className="text-base font-medium text-slate-200">Session trajectories</h3>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Session means and repeated-snapshot uncertainty stay separate by state, source kind and feature schema. These are hand-crafted signal features; adjacent-session cosine depends on their scale.</p>
    {!trajectories.length ? <p className="mt-3 text-sm text-slate-500">Capture measurements across sessions to inspect longitudinal changes.</p> : trajectories.map((trajectory, index) => <div key={index} className="mt-4 rounded-lg border border-white/10 p-3">
      <div className="text-sm text-slate-300">{trajectory.state} · {trajectory.sourceKind.replaceAll("_", " ")} · {trajectory.sessions.length} sessions</div>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs text-slate-400"><caption className="sr-only">{trajectory.state} repeated signal measurements</caption><thead><tr><th className="py-2 pr-3">Session</th><th className="py-2 pr-3">Snapshots</th><th className="py-2 pr-3">QC flags</th><th className="py-2">First feature mean ± SE</th></tr></thead><tbody>{trajectory.sessions.map((session) => <tr key={session.sessionId} className="border-t border-white/5"><td className="py-2 pr-3">{session.sessionId}</td><td className="py-2 pr-3">{session.n}</td><td className="py-2 pr-3">{session.flaggedMeasurements}</td><td className="py-2">{trajectory.featureNames[0]}: {session.mean[0].toPrecision(3)} ± {session.standardError[0] === null ? "unknown (one snapshot)" : session.standardError[0].toPrecision(3)}</td></tr>)}</tbody></table></div>
      {trajectory.adjacentComparisons.map((pair) => <p key={pair.fromSession + pair.toSession} className="mt-2 text-xs text-slate-500">{pair.fromSession} → {pair.toSession}: feature cosine {pair.cosine === null ? "undefined (zero vector)" : pair.cosine.toFixed(3)}</p>)}
      <p className="mt-2 text-xs text-slate-500">Descriptive only. Repeated windows may overlap; SE is not an independent-session confidence interval.</p>
    </div>)}
  </div>;
}
