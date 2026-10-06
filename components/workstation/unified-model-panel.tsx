"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Download, Play, RefreshCw, Square, Upload } from "lucide-react";
import { downloadJson } from "@/lib/morpheus";
import { createUnifiedModelRunRequest } from "@/lib/unified-model";
import { downloadModelArtifact } from "./model-artifact-export";
import { Panel, SectionHeader } from "./ui";

const MODEL = "morpheus-shared-encoder";
const MAX_BYTES = 4 * 1024 * 1024;
type Source = {
  [key: string]: unknown;
  kind: "synthetic" | "public-neural-recording";
  datasetId: string;
  datasetVersion: string;
  license: string;
  featureSchema: string;
  url?: string;
};
type FeatureRow = {
  id: string;
  subjectId: string;
  sessionId: string;
  features: number[];
  featureNames: string[];
  label: string;
  outcome: number | null;
};
type Outcome = { [key: string]: unknown; name: string; unit: string };
type Input = { source: Source; design: { inputTiming: "pre-task-event" | "pre-awakening"; assignment: "observational"; independentUnitsConfirmed: true }; outcome?: Outcome; rows: FeatureRow[] };
type RunResult = {
  balanced_accuracy: number;
  regression_mae: number;
  regression_baseline_mae: number;
  regression_median_baseline_mae?: number;
  regression_ridge_baseline_mae?: number;
  independent_units: number;
  observed_outcomes?: number;
  outcome_coverage?: { observed: number; missing: number; by_label: Record<string, { observed: number; total: number }>; rating_scope: string };
  predictions?: { id: string; label: string; outcome_extrapolation?: boolean | null; outcome_scope?: string }[];
  ci95_accuracy_unit_bootstrap?: [number, number];
  folds: { unitId: string; balanced_accuracy: number; regression_mae: number }[];
  training: { epochs: number; hiddenWidth: number; parameters: number; objectives: unknown };
  evidence_level: string;
  limitations: string[];
  checkpoint?: Record<string, unknown>;
  checkpoint_sha256?: string;
};
type Run = {
  id: string;
  model: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  created_at: string;
  elapsed_ms?: number;
  input_sha256: string;
  output_sha256?: string;
  error?: string;
  result?: RunResult;
  recipe?: unknown;
};
type RegistryModel = {
  id: string;
  enabled?: boolean;
  available?: boolean;
  status?: string;
  reason?: string;
  missing_dependencies?: string[];
  missingDependencies?: string[];
};
type Registry = { enabled: boolean; models: RegistryModel[]; torch_available?: boolean };
type Graph = {
  schema: string;
  graphVersion: string;
  model: {
    id: string;
    version: string;
    status: string;
    trainingStatus: string;
    architecture: Record<string, unknown>;
    limitations?: string[];
  };
  summary: { admittedContributions: number; pendingContributions: number; objectiveSlots: number; trainableHeads: number };
  slots: { id: string; title: string; kind: string; status: string; runtimeBindings: unknown; outputs: string[] }[];
  contributionManifest?: unknown;
};
type Scope = {
  endpoint: string | null;
  active: boolean;
  controller: AbortController;
  refreshing: boolean;
  selectedId: string | null;
  selectionVersion: number;
};
type Connection = { endpoint: string | null; connected: boolean; enabled: boolean; model: RegistryModel | null; error: string };

function loopbackEndpoint(gateway: string): string | null {
  try {
    const url = new URL(gateway);
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) return null;
    return `${url.toString().replace(/\/+$/, "")}/models`;
  } catch { return null; }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, name: string, maximum = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`${name} must be a nonempty string of at most ${maximum} characters.`);
  return value.trim();
}
export function validateUnifiedModelInput(value: unknown): Input {
  if (!object(value) || !object(value.source) || !object(value.design) || !Array.isArray(value.rows)) throw new Error("Import a JSON object containing source, design and feature rows. Download the fixture for its schema.");
  if (!["synthetic", "public-neural-recording"].includes(String(value.source.kind))) throw new Error("Source kind must be synthetic or public-neural-recording.");
  if (new TextEncoder().encode(JSON.stringify(value.source)).byteLength > 64 * 1024) throw new Error("Source provenance metadata exceeds the 64 KiB limit.");
  const source: Source = {
    ...value.source,
    kind: value.source.kind as Source["kind"],
    datasetId: text(value.source.datasetId, "Dataset ID"),
    datasetVersion: text(value.source.datasetVersion, "Dataset version"),
    license: text(value.source.license, "Source license"),
    featureSchema: text(value.source.featureSchema, "Feature schema"),
  };
  if (value.source.url !== undefined) {
    const address = text(value.source.url, "Source URL", 2048);
    const url = new URL(address);
    if (url.protocol !== "https:" || url.username || url.password || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Use a public HTTPS source URL without credentials or a loopback address.");
    source.url = url.toString();
  }
  if (source.kind !== "synthetic" && !source.url) throw new Error("Public neural recordings require a versioned source URL and license.");
  for (const key of ["extractionPlanSha256", "importManifestSha256"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !/^[a-fA-F0-9]{64}$/.test(value[key])) throw new Error(`${key} must be a 64-character SHA-256 hash.`);
    if (source[key] !== undefined && (typeof source[key] !== "string" || source[key].toLowerCase() !== value[key].toLowerCase())) throw new Error(`Conflicting ${key} provenance hashes.`);
    source[key] = value[key].toLowerCase();
  }
  if (new TextEncoder().encode(JSON.stringify(source)).byteLength > 64 * 1024) throw new Error("Source provenance metadata exceeds the 64 KiB limit.");
  let outcome: Outcome | undefined;
  if (value.outcome !== undefined) {
    if (!object(value.outcome) || new TextEncoder().encode(JSON.stringify(value.outcome)).byteLength > 4096) throw new Error("Outcome metadata must be a JSON object of at most four KiB.");
    outcome = { ...value.outcome, name: text(value.outcome.name, "Measured outcome name"), unit: text(value.outcome.unit, "Measured outcome unit") };
    if (value.outcome.scope !== undefined) outcome.scope = text(value.outcome.scope, "Rating scope", 1024);
  }
  if (source.kind !== "synthetic" && !outcome) throw new Error("Public recordings require an explicit outcome name and measured unit.");
  if (!["pre-task-event", "pre-awakening"].includes(String(value.design.inputTiming)) || value.design.assignment !== "observational" || value.design.independentUnitsConfirmed !== true) throw new Error("Declare pre-task-event or pre-awakening measurements, observational assignment and independentUnitsConfirmed = true after reviewing subject identities. Repeated sessions do not establish independent subjects.");
  if (value.rows.length < 48 || value.rows.length > 4096) throw new Error("Import 48–4,096 feature rows from 6–16 independent subjects.");
  const rows: FeatureRow[] = value.rows.map((raw, index) => {
    if (!object(raw) || !Array.isArray(raw.features) || !Array.isArray(raw.featureNames)) throw new Error(`Row ${index + 1} needs features and ordered featureNames arrays.`);
    if (raw.features.length < 1 || raw.features.length > 32 || raw.features.length !== raw.featureNames.length || !raw.features.every((item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 1e6)) throw new Error(`Row ${index + 1} needs 1–32 finite features bounded by ±1,000,000 and matching names.`);
    if (raw.outcome !== null && (typeof raw.outcome !== "number" || !Number.isFinite(raw.outcome) || Math.abs(raw.outcome) > 1e6)) throw new Error(`Row ${index + 1} needs a finite numeric outcome bounded by ±1,000,000, or explicit null when it was not measured.`);
    const featureNames = raw.featureNames.map((name) => text(name, `Row ${index + 1} feature name`, 128));
    if (new Set(featureNames).size !== featureNames.length) throw new Error(`Row ${index + 1} contains duplicate feature names.`);
    if (featureNames.some((name) => ["label", "outcome", "condition", "stimulated", "delay_rate", "post_event_rate"].includes(name.toLowerCase()))) throw new Error(`Row ${index + 1} includes a target or post-event feature name; use audited pre-task measurements.`);
    return {
      id: text(raw.id, `Row ${index + 1} ID`, 128),
      subjectId: text(raw.subjectId, `Row ${index + 1} subject ID`, 128),
      sessionId: text(raw.sessionId, `Row ${index + 1} session ID`, 128),
      features: raw.features as number[], featureNames,
      label: text(raw.label, `Row ${index + 1} label`, 128), outcome: raw.outcome,
    };
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Every feature row needs a unique ID.");
  const names = JSON.stringify(rows[0].featureNames);
  if (rows.some((row) => JSON.stringify(row.featureNames) !== names)) throw new Error("Every row must use the same ordered feature schema.");
  const units = new Set(rows.map((row) => row.subjectId));
  if (units.size < 6 || units.size > 16) throw new Error("Evaluation requires 6–16 independent subject IDs; repeated rows are not new subjects.");
  const labels = new Set(rows.map((row) => row.label));
  if (labels.size < 2 || labels.size > 8) throw new Error("Supply 2–8 predefined labels.");
  const counts = new Map<string, Map<string, number>>();
  const observed = new Map<string, number>();
  for (const row of rows) {
    const unitCounts = counts.get(row.subjectId) ?? new Map<string, number>();
    unitCounts.set(row.label, (unitCounts.get(row.label) ?? 0) + 1);
    counts.set(row.subjectId, unitCounts);
    if (row.outcome !== null) observed.set(row.subjectId, (observed.get(row.subjectId) ?? 0) + 1);
  }
  for (const unit of units) for (const label of labels) {
    if ((counts.get(unit)?.get(label) ?? 0) < 2) throw new Error(`Subject ${unit} needs at least two rows for label ${label}.`);
  }
  for (const unit of units) if ((observed.get(unit) ?? 0) < 2) throw new Error(`Subject ${unit} needs at least two genuinely observed outcomes; missing ratings remain null.`);
  // Bounded source metadata preserves asset IDs, hashes and extraction provenance.
  // Execution fields come only from the reviewed helper and these validated rows.
  return { source, design: { inputTiming: value.design.inputTiming as Input["design"]["inputTiming"], assignment: "observational", independentUnitsConfirmed: true }, ...(outcome ? { outcome } : {}), rows };
}
export function unifiedModelFixture(): Input {
  return {
    source: { kind: "synthetic", datasetId: "morpheus-shared-encoder-engineering-fixture", datasetVersion: "1", license: "Synthetic engineering fixture; no biological observations.", featureSchema: "morpheus-shared-fixture-features-v1" },
    design: { inputTiming: "pre-task-event", assignment: "observational", independentUnitsConfirmed: true },
    outcome: { name: "Engineered response", unit: "arbitrary units" },
    rows: Array.from({ length: 6 }, (_, unit) => Array.from({ length: 8 }, (_, trial) => {
      const feature0 = (trial < 4 ? -1 : 1) + (trial % 4 - 1.5) * .1 + unit * .01;
      const feature1 = Math.sin(unit * .73 + trial * .31);
      return {
        id: `synthetic-${unit + 1}-${trial + 1}`, subjectId: `synthetic-unit-${unit + 1}`, sessionId: `synthetic-session-${unit + 1}`,
        features: [feature0, feature1, Math.cos(unit * .27 + trial * .13), unit / 10 + trial / 100],
        featureNames: ["engineered_state_signal", "engineered_outcome_signal", "nuisance_cosine", "nuisance_offset"],
        label: feature0 < 0 ? "state-a" : "state-b", outcome: 2 * feature0 + .3 * feature1,
      };
    })).flat(),
  };
}
async function request<T>(url: string, scope: Scope, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.any([scope.controller.signal, AbortSignal.timeout(12000)]) });
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error(`Local service returned a non-JSON response (${response.status}).`); }
  if (!response.ok) throw new Error(object(body) && typeof body.detail === "string" ? body.detail : `Local service returned ${response.status}.`);
  return body as T;
}
function availability(registry: Registry): RegistryModel | null {
  const entry = Array.isArray(registry.models) ? registry.models.find((model) => model.id === MODEL) : undefined;
  if (!entry) return null;
  if (registry.torch_available === false) return { ...entry, available: false, reason: "PyTorch is missing from the local science environment." };
  return entry;
}
function canTrain(model: RegistryModel | null): boolean {
  return !!model && model.enabled !== false && model.available !== false && !(model.missing_dependencies?.length || model.missingDependencies?.length) && !/missing|unavailable|disabled|staging|blocked/i.test(model.status ?? "");
}
function metric(value: unknown, percentage = false): string {
  return typeof value === "number" && Number.isFinite(value) ? percentage ? `${(value * 100).toFixed(1)}%` : value.toFixed(3) : "—";
}

export default function UnifiedModelPanel({ gateway }: { gateway: string }) {
  const endpoint = loopbackEndpoint(gateway);
  const [input, setInput] = useState<Input | null>(null);
  const [inputName, setInputName] = useState("");
  const [epochs, setEpochs] = useState(30);
  const [hiddenWidth, setHiddenWidth] = useState<16 | 32 | 64>(32);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [graphError, setGraphError] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [connection, setConnection] = useState<Connection>({ endpoint: null, connected: false, enabled: false, model: null, error: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scopeRef = useRef<Scope | null>(null);
  const inputVersion = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = useCallback((scope: Scope) => scope.active && scopeRef.current === scope, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/research/model?format=manifest", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
      .then(async (response) => { if (!response.ok) throw new Error("The architecture manifest is unavailable. Refresh this page after the research service is connected."); return response.json(); })
      .then((manifest: Graph) => { if (!controller.signal.aborted) setGraph(manifest); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setGraphError(failure instanceof Error ? failure.message : "Unable to load architecture manifest."); });
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async (scope: Scope) => {
    if (!scope.endpoint || !current(scope) || scope.refreshing) return;
    scope.refreshing = true;
    setRefreshing(true);
    try {
      const registry = await request<Registry>(`${scope.endpoint}/registry`, scope);
      if (!current(scope)) return;
      setConnection({ endpoint: scope.endpoint, connected: true, enabled: registry.enabled, model: availability(registry), error: "" });
      if (!registry.enabled) return;
      const list = await request<{ runs: Run[] }>(`${scope.endpoint}/runs`, scope);
      if (!current(scope)) return;
      setRuns((Array.isArray(list.runs) ? list.runs : []).filter((run) => run.model === MODEL));
      const identifier = scope.selectedId, selectionVersion = scope.selectionVersion;
      if (identifier) {
        const run = await request<Run>(`${scope.endpoint}/runs/${encodeURIComponent(identifier)}`, scope);
        if (current(scope) && scope.selectedId === identifier && scope.selectionVersion === selectionVersion && run.model === MODEL) setSelected(run);
      }
    } catch (failure) {
      if (current(scope)) setConnection({ endpoint: scope.endpoint, connected: false, enabled: false, model: null, error: failure instanceof Error ? failure.message : "The local model service is unavailable." });
    } finally {
      scope.refreshing = false;
      if (current(scope)) setRefreshing(false);
    }
  }, [current]);
  useEffect(() => {
    const scope: Scope = { endpoint, active: true, controller: new AbortController(), refreshing: false, selectedId: null, selectionVersion: 0 };
    scopeRef.current = scope;
    inputVersion.current += 1;
    setInput(null); setInputName(""); setRuns([]); setSelected(null); setBusy(false); setRefreshing(false); setError("");
    setConnection({ endpoint, connected: false, enabled: false, model: null, error: "" });
    void refresh(scope);
    const timer = endpoint ? window.setInterval(() => void refresh(scope), 3000) : null;
    return () => { scope.active = false; scope.controller.abort(); if (timer !== null) window.clearInterval(timer); if (scopeRef.current === scope) scopeRef.current = null; };
  }, [endpoint, refresh]);

  const ready = !!endpoint && connection.endpoint === endpoint && connection.connected && connection.enabled && canTrain(connection.model);
  async function importData(file?: File) {
    if (!file) return;
    const scope = scopeRef.current, version = ++inputVersion.current;
    setError("");
    try {
      if (file.size > MAX_BYTES) throw new Error("Input exceeds the four MiB local model limit.");
      const parsed = validateUnifiedModelInput(JSON.parse(await file.text()));
      if (scope && current(scope) && scope.endpoint === endpoint && inputVersion.current === version) { setInput(parsed); setInputName(file.name); }
    } catch (failure) {
      if (scope && current(scope) && inputVersion.current === version) { setInput(null); setInputName(""); setError(failure instanceof Error ? failure.message : "Unable to read feature JSON."); }
    }
  }
  async function train(data: Input) {
    const scope = scopeRef.current;
    if (!scope?.endpoint || scope.endpoint !== endpoint || !current(scope) || !ready || busy) return;
    setError(""); setBusy(true);
    try {
      if (!Number.isInteger(epochs) || epochs < 10 || epochs > 100) throw new Error("Training epochs must be an integer from 10 to 100.");
      const units = new Set(data.rows.map((row) => row.subjectId)).size;
      if (data.rows.length * epochs * (units + 1) * data.rows[0].features.length * hiddenWidth ** 2 > 2e9) throw new Error("This input exceeds the reviewed CPU compute bound. Reduce epochs, hidden width or row/feature count.");
      const prepared = await createUnifiedModelRunRequest(data, { seed: 2026, epochs, hiddenWidth });
      if (!current(scope)) return;
      // The reviewed helper pins the recipe/contribution envelope. The model
      // and method are forced here as well; imported identifiers are ignored.
      const body = JSON.stringify({ ...prepared, model: MODEL, method: "unified-model" });
      if (new TextEncoder().encode(body).byteLength > MAX_BYTES) throw new Error("The prepared input and contribution manifest exceed four MiB.");
      const run = await request<Run>(`${scope.endpoint}/runs`, scope, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (!current(scope)) return;
      if (run.model !== MODEL) throw new Error("The local service returned a different model; this run was not selected.");
      scope.selectedId = run.id; scope.selectionVersion += 1; setSelected(run);
      setRuns((existing) => [run, ...existing.filter((row) => row.id !== run.id)]);
      void refresh(scope);
    } catch (failure) {
      if (current(scope)) setError(failure instanceof Error ? failure.message : "Unable to queue shared-model training.");
    } finally { if (current(scope)) setBusy(false); }
  }
  async function inspect(identifier: string) {
    const scope = scopeRef.current;
    if (!scope?.endpoint || scope.endpoint !== endpoint || !current(scope)) return;
    scope.selectedId = identifier;
    const version = ++scope.selectionVersion;
    setError(""); setSelected(runs.find((run) => run.id === identifier) ?? null);
    try {
      const run = await request<Run>(`${scope.endpoint}/runs/${encodeURIComponent(identifier)}`, scope);
      if (current(scope) && scope.selectionVersion === version && scope.selectedId === identifier) {
        if (run.model !== MODEL) throw new Error("This run belongs to a different model.");
        setSelected(run);
      }
    } catch (failure) { if (current(scope) && scope.selectionVersion === version) setError(failure instanceof Error ? failure.message : "Unable to inspect the model run."); }
  }
  async function cancel() {
    const scope = scopeRef.current, run = selected;
    if (!scope?.endpoint || scope.endpoint !== endpoint || !current(scope) || !run || run.model !== MODEL) return;
    setError("");
    try { await request(`${scope.endpoint}/runs/${encodeURIComponent(run.id)}/cancel`, scope, { method: "POST" }); if (current(scope)) void refresh(scope); }
    catch (failure) { if (current(scope)) setError(failure instanceof Error ? failure.message : "Unable to cancel training."); }
  }
  async function exportArtifact(kind: "export" | "checkpoint", filename: string) {
    const scope = scopeRef.current;
    const run = selected;
    if (!scope?.endpoint || scope.endpoint !== endpoint || !current(scope) || !run || scope.selectedId !== run.id) return;
    const version = scope.selectionVersion;
    setError("");
    try {
      await downloadModelArtifact(scope.endpoint, run.id, kind, filename, scope.controller.signal);
      if (!current(scope) || scope.selectionVersion !== version || scope.selectedId !== run.id) return;
    } catch (failure) {
      if (current(scope) && scope.selectionVersion === version && scope.selectedId === run.id) setError(failure instanceof Error ? failure.message : "Unable to export the model artifact.");
    }
  }

  const result = selected?.result;
  const resultOutcome = object(result?.checkpoint?.outcome) ? result.checkpoint.outcome : null;
  const coverage = result?.outcome_coverage;
  const importedLabels = input ? [...new Set(input.rows.map((row) => row.label))] : [];
  const dreamLabels = new Set(importedLabels.map((label) => label.toLowerCase().replace(/[^a-z]/g, "")));
  const isDreamInput = dreamLabels.has("experience") && dreamLabels.has("noexperience") && (dreamLabels.has("withoutrecall") || dreamLabels.has("experiencewithoutrecall"));
  const importedObserved = input?.rows.reduce((count, row) => count + Number(row.outcome !== null), 0) ?? 0;
  const missing = connection.model?.missing_dependencies ?? connection.model?.missingDependencies ?? [];
  return <Panel className="model-run-panel">
    <SectionHeader title="One shared Morpheus model" description="Train one feature-token Transformer with label-classification and measured-outcome objectives. Each run uses its declared feature schema and trains its own checkpoint; cross-dataset joint training is not implemented." action={
      <button className="button-secondary" disabled={!endpoint || refreshing} onClick={() => { const scope = scopeRef.current; if (scope?.endpoint === endpoint) void refresh(scope); }}><RefreshCw size={14} /> {refreshing ? "Refreshing…" : "Refresh model runs"}</button>
    } />
    <div className="model-run-body">
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center" aria-label="Shared model architecture">
        <div className="rounded-lg border border-white/10 p-4"><strong className="text-sm text-slate-200">Named feature tokens</strong><p className="model-run-help">A common ordered schema from pre-task measurements.</p></div>
        <ArrowRight size={18} className="hidden text-slate-500 md:block" aria-hidden="true" />
        <div className="rounded-lg border border-white/10 p-4"><strong className="text-sm text-slate-200">Shared Transformer encoder</strong><p className="model-run-help">One layer, four attention heads, GELU and pooled LayerNorm.</p></div>
        <ArrowRight size={18} className="hidden text-slate-500 md:block" aria-hidden="true" />
        <div className="rounded-lg border border-white/10 p-4"><strong className="text-sm text-slate-200">Two jointly trained heads</strong><p className="model-run-help">Classification on all labels + 0.5 × scaled-outcome mean-square error on observed ratings.</p></div>
      </div>
      {graph?.summary ? <p className="model-run-help">{graph.summary.admittedContributions} admitted contributions; {graph.summary.pendingContributions} awaiting review. Architecture {graph.model?.version ?? graph.graphVersion}. A source reference becomes active only through a reviewed, implemented binding.</p> : <p className="model-run-help">The shared model trains on supplied measurements. Source-method admission is recorded in a versioned contribution manifest.</p>}
      {graphError ? <p className="model-run-help">{graphError}</p> : null}
      {!endpoint ? <div className="model-run-notice">Select a loopback gateway in Acquisition, such as http://127.0.0.1:8787. Feature rows and learned checkpoints stay in the local science service.</div> : !connection.connected ? <div className="model-run-notice">Connect the local science gateway to load model availability. {connection.error}</div> : !connection.enabled ? <div className="model-run-notice">Enable MORPHEUS_MODEL_RUN_DIR on the local gateway, then restart it to retain training runs.</div> : !canTrain(connection.model) ? <div className="model-run-notice">{connection.model?.reason || (missing.length ? `Install the missing local dependency: ${missing.join(", ")}.` : "The shared encoder is unavailable in this gateway. Install its PyTorch science dependency and restart the updated gateway.")}</div> : null}
      <div className="model-run-controls">
        <button className="button-secondary" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import feature JSON</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void importData(file); }} />
        <button className="button-secondary" onClick={() => downloadJson("morpheus-shared-model-synthetic-fixture.json", unifiedModelFixture())}><Download size={14} /> Download input fixture</button>
        <label>Training epochs<input type="number" min={10} max={100} step={1} value={epochs} onChange={(event) => setEpochs(Number(event.target.value))} /></label>
        <label>Shared hidden width<select value={hiddenWidth} onChange={(event) => setHiddenWidth(Number(event.target.value) as 16 | 32 | 64)}><option value={16}>16</option><option value={32}>32</option><option value={64}>64</option></select></label>
      </div>
      <div className="model-run-controls mt-4">
        <button className="button-primary" disabled={!ready || !input || busy} onClick={() => input && void train(input)}><Play size={14} /> {busy ? "Queuing training…" : "Train on imported measurements"}</button>
        <button className="button-secondary" disabled={!ready || busy} onClick={() => void train(unifiedModelFixture())}><Play size={14} /> Run synthetic training fixture</button>
      </div>
      <p className="model-run-help">Import at most four MiB: 48–4,096 rows, 1–32 common features, and 6–16 independent subject IDs with 2–8 labels represented at least twice per subject. Each subject also needs two measured outcomes. Keep unmeasured outcomes null; classification retains those rows, while regression uses measured ratings. Declare reviewed subject identities in design.independentUnitsConfirmed. The fixture contains 48 generated rows and six fictional units; its metrics describe software behavior.</p>
      {input ? <p className="model-run-help">Loaded locally: {inputName}; {input.rows.length} rows, {new Set(input.rows.map((row) => row.subjectId)).size} units, {input.rows[0].features.length} features. Source: {input.source.datasetId} / {input.source.datasetVersion} ({input.source.kind}).</p> : null}
      {input?.outcome ? <p className="model-run-help">Measured outcome: {input.outcome.name} ({input.outcome.unit}).</p> : null}
      {input ? <p className="model-run-help">Outcome coverage: {importedObserved} observed / {input.rows.length} rows; {input.rows.length - importedObserved} unmeasured. {typeof input.outcome?.scope === "string" ? `Rating scope: ${input.outcome.scope}.` : "Missing ratings are masked, with no zero imputation."}</p> : null}
      {isDreamInput ? <p className="model-run-help">Three DREAM report classes stay separate: Experience (content recalled), No experience (no recalled experience or impression), and Experience without recall (an impression of experience without recalled content). The original imported label strings are retained.</p> : null}
      {error ? <p className="model-run-error" role="alert">{error}</p> : null}
      <div className="model-run-layout">
        <div className="model-run-list">{runs.length ? runs.map((run) => <button key={run.id} className={selected?.id === run.id ? "model-run-row is-selected" : "model-run-row"} aria-pressed={selected?.id === run.id} onClick={() => void inspect(run.id)}><span>Shared encoder<small>{new Date(run.created_at).toLocaleString()}</small></span><strong>{run.status}</strong></button>) : <p className="model-run-empty">No shared-model runs loaded. Import measurements or use the synthetic fixture to exercise training and checkpoint export.</p>}</div>
        <div className="model-run-detail">{selected ? <>
          <div className="model-run-actions"><strong>{selected.status}</strong><button className="button-secondary" disabled={!endpoint || selected.status !== "COMPLETED"} onClick={() => void exportArtifact("export", `morpheus-shared-run-${selected.id}.json`)}><Download size={14} /> Export full run</button>
            {["QUEUED", "RUNNING"].includes(selected.status) ? <button className="button-secondary" onClick={() => void cancel()}><Square size={13} /> Cancel training</button> : null}</div>
          {selected.error ? <p className="model-run-error" role="alert">{selected.error}</p> : null}
          {result ? <>
            <dl className="model-run-metrics"><div><dt>Held-out balanced accuracy</dt><dd>{metric(result.balanced_accuracy, true)}</dd></div><div><dt>Held-out outcome MAE</dt><dd>{metric(result.regression_mae)}</dd></div><div><dt>Train-mean baseline MAE</dt><dd>{metric(result.regression_baseline_mae)}</dd></div><div><dt>Independent units</dt><dd>{result.independent_units}</dd></div>{result.regression_median_baseline_mae !== undefined ? <div><dt>Train-median baseline MAE</dt><dd>{metric(result.regression_median_baseline_mae)}</dd></div> : null}{result.regression_ridge_baseline_mae !== undefined ? <div><dt>Training-fold ridge MAE</dt><dd>{metric(result.regression_ridge_baseline_mae)}</dd></div> : null}</dl>
            {resultOutcome && typeof resultOutcome.name === "string" && typeof resultOutcome.unit === "string" ? <p className="model-run-help">Outcome errors measure {resultOutcome.name} in {resultOutcome.unit}. Baseline controls use the same held-out subject folds and observed ratings.</p> : null}
            {coverage ? <>
              <p className="model-run-help">Regression evaluation: {result.observed_outcomes ?? coverage.observed} observed ratings; {coverage.missing} unmeasured outcomes excluded. Rating scope: {coverage.rating_scope}. Classification includes every admitted row.</p>
              <table className="model-run-confusion"><caption>Observed rating coverage by classification label</caption><thead><tr><th scope="col">Label</th><th scope="col">Rated / total</th><th scope="col">Coverage</th></tr></thead><tbody>{Object.entries(coverage.by_label).map(([label, counts]) => <tr key={label}><th scope="row">{label}</th><td>{counts.observed} / {counts.total}</td><td>{metric(counts.total ? counts.observed / counts.total : null, true)}</td></tr>)}</tbody></table>
              {Object.entries(coverage.by_label).filter(([, counts]) => counts.observed === 0).map(([label]) => <p key={label} className="model-run-help">No measured outcomes for {label}: an outcome prediction in that class extrapolates beyond the rated training cases.</p>)}
            </> : result.observed_outcomes !== undefined ? <p className="model-run-help">Regression evaluated {result.observed_outcomes} observed ratings.</p> : null}
            {result.predictions?.length ? <table className="model-run-confusion"><caption>Returned prediction outcome scope</caption><thead><tr><th scope="col">Row</th><th scope="col">Predicted label</th><th scope="col">Outcome scope</th></tr></thead><tbody>{result.predictions.map((prediction) => <tr key={prediction.id}><th scope="row">{prediction.id}</th><td>{prediction.label}</td><td>{prediction.outcome_scope ?? "Scope unavailable"}{prediction.outcome_extrapolation === true ? " · Extrapolation beyond rated classes" : prediction.outcome_extrapolation === false ? " · Rated training class" : " · Extrapolation status unavailable"}</td></tr>)}</tbody></table> : null}
            <p className="model-run-help">{result.evidence_level}. {result.ci95_accuracy_unit_bootstrap ? `95% unit-bootstrap accuracy interval: ${result.ci95_accuracy_unit_bootstrap.map((value) => metric(value, true)).join(" – ")}.` : ""}</p>
            {result.training ? <p className="model-run-help">{result.training.epochs} epochs; hidden width {result.training.hiddenWidth}; {result.training.parameters?.toLocaleString()} learned parameters. One shared encoder is optimized for both heads.</p> : null}
            <table className="model-run-confusion"><caption>Each fold holds out one independent unit</caption><thead><tr><th scope="col">Held-out unit</th><th scope="col">Balanced accuracy</th><th scope="col">Outcome MAE</th></tr></thead><tbody>{(result.folds ?? []).map((fold) => <tr key={fold.unitId}><th scope="row">{fold.unitId}</th><td>{metric(fold.balanced_accuracy, true)}</td><td>{metric(fold.regression_mae)}</td></tr>)}</tbody></table>
            {result.checkpoint ? <button className="button-secondary" onClick={() => void exportArtifact("checkpoint", `morpheus-shared-checkpoint-${selected.id}.json`)}><Download size={14} /> Export learned checkpoint</button> : null}
            {typeof result.checkpoint?.fit_scope === "string" ? <p className="model-run-help">Checkpoint fit: {result.checkpoint.fit_scope}.</p> : null}
            {(result.limitations ?? []).map((limit) => <p className="model-run-help" key={limit}>{limit}</p>)}
          </> : <p className="model-run-help">The local job trains the shared model and evaluates held-out units. A completed run includes fitted preprocessing, label/feature schemas and a JSON checkpoint.</p>}
          <dl className="model-run-provenance"><dt>Run ID</dt><dd>{selected.id}</dd><dt>Input SHA-256</dt><dd>{selected.input_sha256}</dd><dt>Output SHA-256</dt><dd>{selected.output_sha256 ?? "Pending"}</dd>{result?.checkpoint_sha256 ? <><dt>Checkpoint SHA-256</dt><dd>{result.checkpoint_sha256}</dd></> : null}</dl>
        </> : <p className="model-run-empty">Select a shared-model run to inspect its evaluation, source evidence and learned checkpoint.</p>}</div>
      </div>
      {graph ? <details className="model-run-help"><summary>Architecture and objective bindings</summary>
        <table className="model-run-confusion"><caption>Objective slots belong to this shared model; pending sources are not active implementations</caption><thead><tr><th scope="col">Slot</th><th scope="col">Purpose</th><th scope="col">Status</th></tr></thead><tbody>{(graph.slots ?? []).map((slot) => <tr key={slot.id}><th scope="row">{slot.title}</th><td>{slot.kind}</td><td>{slot.status}</td></tr>)}</tbody></table>
        <button className="button-secondary" onClick={() => downloadJson("morpheus-shared-model-architecture-manifest.json", graph)}><Download size={14} /> Export architecture manifest</button>
        <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(graph.model?.architecture, null, 2)}</pre>
      </details> : null}
    </div>
  </Panel>;
}
