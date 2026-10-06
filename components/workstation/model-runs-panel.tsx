"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createRecipeRunRequest } from "@/lib/method-recipes";
import { Download, Play, RefreshCw, Square } from "lucide-react";
import { listAtlasSnapshots } from "@/lib/atlas-store";
import { downloadJson } from "@/lib/morpheus";
import { Panel, SectionHeader } from "./ui";
import { downloadModelArtifact } from "./model-artifact-export";

type Result = {
  balanced_accuracy: number;
  permutation_p: number;
  chance: number;
  null_mean: number;
  independent_sessions: number;
  ci95_session_bootstrap: [number, number];
  confusion: Record<string, Record<string, number>>;
  evidence_level: string;
  limitations: string[];
};
type Run = {
  id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  model: string;
  created_at: string;
  elapsed_ms?: number;
  input_sha256: string;
  output_sha256?: string;
  error?: string;
  result?: Result;
};
function localEndpoint(gateway: string) {
  try {
    const url = new URL(gateway);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000), cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : `Local model service returned ${response.status}.`);
  return payload as T;
}

export default function ModelRunsPanel({ gateway }: { gateway: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [subject, setSubject] = useState("subject-001");
  const [model, setModel] = useState("nearest-centroid");
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const selectedId = useRef<string | null>(null);
  const endpoint = `${gateway.replace(/\/$/, "")}/models`;
  const local = localEndpoint(gateway);
  const refresh = useCallback(async () => {
    if (!local) return;
    try {
      const registry = await request<{ enabled: boolean }>(`${endpoint}/registry`);
      setConnected(true);
      setEnabled(registry.enabled);
      if (registry.enabled) {
        const list = await request<{ runs: Run[] }>(`${endpoint}/runs`);
        setRuns(list.runs.filter((run) => ["nearest-centroid", "diagonal-lda"].includes(run.model)));
        if (selectedId.current) setSelected(await request<Run>(`${endpoint}/runs/${selectedId.current}`));
      }
    } catch (failure) {
      setConnected(false);
      setEnabled(false);
      setError(failure instanceof Error ? failure.message : "Local model service unavailable.");
    }
  }, [endpoint, local]);

  useEffect(() => {
    selectedId.current = null;
    setSelected(null);
    setRuns([]);
    setError("");
    setConnected(false);
    setEnabled(false);
    void refresh();
    if (!local) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh, local]);

  async function select(identifier: string) {
    selectedId.current = identifier;
    try { setSelected(await request<Run>(`${endpoint}/runs/${identifier}`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to read run."); }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const snapshots = (await listAtlasSnapshots(subject.trim()));
      if (!snapshots.length) throw new Error("Capture labeled snapshots in M3/M5 for this subject first.");
      const result = await request<Run>(`${endpoint}/runs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(createRecipeRunRequest(model === "diagonal-lda" ? "m3-diagonal-lda-v1" : "m3-nearest-centroid-v1", { rows: snapshots.map((row) => ({
          id: row.id, subjectId: row.subjectId, sessionId: row.sessionId, label: row.state,
          features: row.features, featureNames: row.featureNames, sourceMode: row.metadata?.sourceMode ?? "unverified",
          featureSchema: row.provenance?.featureSchema ?? "legacy-unspecified", sourceKind: row.provenance?.sourceKind ?? "unknown",
          sampleRate: row.sampleRate, channelCount: row.channelCount,
        })) }, { seed: 2026, permutations: 100 })),
      });
      selectedId.current = result.id;
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to queue evaluation."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!selected) return;
    try { await request(`${endpoint}/runs/${selected.id}/cancel`, { method: "POST" }); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Cancellation failed."); }
  }
  async function exportRun(run: Run) {
    setError("");
    try { await downloadModelArtifact(endpoint, run.id, "export", `morpheus-run-${run.id}.json`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to export run."); }
  }

  return <Panel className="model-run-panel">
    <SectionHeader title="Reproducible local model runs" description="Two classical baselines, held-out sessions, training-only normalization, session-blocked nulls and durable manifests." action={
      <button className="button-secondary" onClick={() => void refresh()} disabled={!local}><RefreshCw size={14} /> Refresh runs</button>
    } />
    <div className="model-run-body">
      {!local ? <div className="model-run-notice">Select your local gateway in Acquisition (for example http://127.0.0.1:8787). Private feature snapshots are sent only to a loopback gateway.</div> :
        !enabled ? <div className="model-run-notice">{connected ? "Enable the local service with MORPHEUS_MODEL_RUN_DIR, then restart the gateway." : "Connect the local gateway to enable jobs."} Manifests and results stay in a local SQLite database.</div> : null}
      <div className="model-run-controls">
        <label>Subject ID<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={128} /></label>
        <label>Model<select value={model} onChange={(event) => setModel(event.target.value)}><option value="nearest-centroid">Nearest centroid</option><option value="diagonal-lda">Regularized diagonal LDA</option></select></label>
        <button className="button-primary" disabled={!enabled || !local || busy || !subject.trim()} onClick={() => void submit()}><Play size={14} /> {busy ? "Queuing…" : "Queue evaluation"}</button>
      </div>
      <p className="model-run-help">Requires at least three sessions with every label in each session. Seed 2026; 100 label shuffles within sessions. Overlapping windows need a different null model.</p>
      {error ? <p role="alert" className="model-run-error">{error}</p> : null}
      <div className="model-run-layout">
        <div className="model-run-list">
          {runs.length ? runs.map((run) => <button key={run.id} className={selected?.id === run.id ? "model-run-row is-selected" : "model-run-row"} onClick={() => void select(run.id)}>
            <span>{run.model}<small>{new Date(run.created_at).toLocaleString()}</small></span><strong>{run.status}</strong>
          </button>) : <p className="model-run-empty">No local runs yet. Capture separate sessions in M3/M5, then queue an evaluation.</p>}
        </div>
        <div className="model-run-detail">
          {selected ? <>
            <div className="model-run-actions"><strong>{selected.status}</strong><button className="button-secondary" disabled={!local} onClick={() => void exportRun(selected)}><Download size={14} /> Export manifest</button>
              {["QUEUED", "RUNNING"].includes(selected.status) ? <button className="button-secondary" onClick={() => void cancel()}><Square size={13} /> Cancel</button> : null}</div>
            {selected.error ? <p role="alert" className="model-run-error">{selected.error}</p> : null}
            {selected.result ? <>
              <dl className="model-run-metrics"><div><dt>Balanced accuracy</dt><dd>{(selected.result.balanced_accuracy * 100).toFixed(1)}%</dd></div><div><dt>Null mean</dt><dd>{(selected.result.null_mean * 100).toFixed(1)}%</dd></div><div><dt>Exploratory p</dt><dd>{selected.result.permutation_p.toFixed(4)}</dd></div><div><dt>Independent sessions</dt><dd>{selected.result.independent_sessions}</dd></div></dl>
              <p className="model-run-help">95% session bootstrap interval: {selected.result.ci95_session_bootstrap.map((v) => `${(v * 100).toFixed(1)}%`).join(" – ")}. {selected.result.evidence_level}.</p>
              <table className="model-run-confusion"><caption>Confusion counts (rows actual; columns predicted)</caption><thead><tr><th scope="col">State</th>{Object.keys(selected.result.confusion).map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{Object.entries(selected.result.confusion).map(([label, counts]) => <tr key={label}><th scope="row">{label}</th>{Object.entries(counts).map(([prediction, count]) => <td key={prediction}>{count}</td>)}</tr>)}</tbody></table>
              {selected.result.limitations.map((limit) => <p key={limit} className="model-run-help">{limit}</p>)}
            </> : <p className="model-run-help">The local process retains queued, running and interrupted jobs across navigation. Completed runs include fold IDs and input/output hashes.</p>}
            <dl className="model-run-provenance"><dt>Run ID</dt><dd>{selected.id}</dd><dt>Input SHA-256</dt><dd>{selected.input_sha256}</dd><dt>Output SHA-256</dt><dd>{selected.output_sha256 ?? "Pending"}</dd></dl>
          </> : <p className="model-run-empty">Select a run to inspect its result and provenance.</p>}
        </div>
      </div>
    </div>
  </Panel>;
}
