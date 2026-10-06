"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FlaskConical, Play, Upload } from "lucide-react";
import { downloadJson } from "@/lib/morpheus";
import { createRecipeRunRequest } from "@/lib/method-recipes";
import { Panel, SectionHeader } from "./ui";
import { downloadModelArtifact } from "./model-artifact-export";

type CausalResult = {
  independent_units: number; matched_sessions: number; evidence_level: string;
  estimate: { mean_difference: number; ci95_cluster_bootstrap: [number, number]; unit: string };
  randomization_test: { p_value: number; enumeration: string; draws: number; assumptions: string[] | string };
  interpretation: string; limitations: string[];
  unit_effects: { unitId: string; effect: number; matchedSessions: number }[];
};
type Run = { id: string; model: string; status: string; created_at: string; input_sha256: string; output_sha256?: string; result?: CausalResult; error?: string };
type Recipe = { id: string; title?: string; name?: string; version: string; status: string; [key: string]: unknown };
function isLocal(gateway: string) {
  try { const url = new URL(gateway); return ["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(12000) });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Local service returned ${response.status}.`);
  return body as T;
}
export function perturbationFixture() {
  return { method: "causal-perturbation", seed: 2026, permutations: 2000, bootstrapSamples: 1000,
    source: { kind: "synthetic", datasetId: "morpheus-perturbation-engineering-fixture", datasetVersion: "1" },
    design: { assignment: "observational", independentUnitsConfirmed: true }, outcome: { name: "engineered response", unit: "arbitrary units" }, controlCondition: "sham",
    baselineTolerance: .01,
    rows: Array.from({ length: 8 }, (_, unit) => ["stimulated", "sham"].flatMap((condition) => [0, 1].map((repeat) => ({
      trialId: `fixture-${unit}-${condition}-${repeat}`, unitId: `fixture-unit-${unit}`, sessionId: "fixture-session",
      condition, baseline: 1, outcome: condition === "stimulated" ? 3 + unit * .05 + repeat * .02 : 1.2 + repeat * .02, qcPassed: true,
    })))).flat(),
  };
}

export default function CausalWorkbench({ gateway }: { gateway: string }) {
  const [input, setInput] = useState<Record<string, unknown> | null>(null);
  const [inputName, setInputName] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const selectedId = useRef<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const endpoint = `${gateway.replace(/\/$/, "")}/models`;
  const local = isLocal(gateway);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/research/methods", { signal: controller.signal }).then((response) => response.json()).then((payload) => setRecipes(payload.recipes ?? payload.methods ?? payload.items ?? [])).catch(() => {});
    return () => controller.abort();
  }, []);
  const refresh = useCallback(async () => {
    if (!local) return;
    try {
      const registry = await request<{ enabled: boolean }>(`${endpoint}/registry`);
      setEnabled(registry.enabled);
      if (!registry.enabled) return;
      const list = await request<{ runs: Run[] }>(`${endpoint}/runs`);
      setRuns(list.runs.filter((run) => run.model === "causal-perturbation"));
      if (selectedId.current) setSelected(await request<Run>(`${endpoint}/runs/${selectedId.current}`));
    } catch (failure) { setEnabled(false); setError(failure instanceof Error ? failure.message : "Local perturbation analysis unavailable."); }
  }, [endpoint, local]);
  useEffect(() => {
    setRuns([]); setSelected(null); selectedId.current = null; setEnabled(false);
    void refresh();
    if (!local) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh, local]);
  async function importData(incoming?: File) {
    if (!incoming) return;
    setError("");
    try {
      if (incoming.size > 4 * 1024 * 1024) throw new Error("Input exceeds the four MiB local reference limit.");
      const parsed: unknown = JSON.parse(await incoming.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Import a perturbation request object with source, design, outcome and trial rows.");
      setInput(parsed as Record<string, unknown>); setInputName(incoming.name);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to read input."); }
  }
  async function queue(payload: Record<string, unknown>) {
    if (!local) return;
    setError(""); setBusy(true);
    try {
      const prepared = createRecipeRunRequest("causal-paired-contrast-v1", payload, {
        seed: typeof payload.seed === "number" ? payload.seed : 2026,
        permutations: typeof payload.permutations === "number" ? payload.permutations : 2000,
        bootstrapSamples: typeof payload.bootstrapSamples === "number" ? payload.bootstrapSamples : 1000,
      });
      const run = await request<Run>(`${endpoint}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(prepared) });
      selectedId.current = run.id; setSelected(run); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to queue perturbation analysis."); }
    finally { setBusy(false); }
  }
  async function inspect(identifier: string) {
    selectedId.current = identifier;
    try { setSelected(await request<Run>(`${endpoint}/runs/${identifier}`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to inspect result."); }
  }
  async function exportRun(run: Run) {
    setError("");
    try { await downloadModelArtifact(endpoint, run.id, "export", `morpheus-causal-${run.id}.json`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to export run."); }
  }
  return <Panel>
    <SectionHeader title="Perturbation research workbench" description="Apply causal-circuit methods to matched stimulated and sham/control trials. Estimate effects across independent units, then test a unit-level null." action={<FlaskConical size={20} />} />
    <div className="model-run-body">
      <p className="model-run-help">This implements an analysis inspired by optogenetic experiments: separate manipulation from measurement, retain controls, and test the effect. Imported records need source versions, trial IDs, QC and independent unit IDs. Biological conclusions depend on the experiment and its assignment design.</p>
      {!local || !enabled ? <div className="model-run-notice">Connect a loopback gateway and enable MORPHEUS_MODEL_RUN_DIR to execute. Public references can be explored here; private inputs stay on your local machine.</div> : null}
      <div className="model-run-controls">
        <button className="button-secondary" onClick={() => file.current?.click()}><Upload size={14} /> Import trial JSON</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(event) => void importData(event.target.files?.[0])} />
        <button className="button-secondary" onClick={() => downloadJson("morpheus-perturbation-template.json", perturbationFixture())}><Download size={14} /> Download input template</button>
        <button className="button-secondary" disabled={!enabled || !local || busy} onClick={() => void queue(perturbationFixture())}><Play size={14} /> Run engineering fixture</button>
        <button className="button-primary" disabled={!input || !enabled || !local || busy} onClick={() => input && void queue(input)}><Play size={14} /> Evaluate imported trials</button>
      </div>
      {input ? <p className="model-run-help">Loaded locally: {inputName}; {Array.isArray(input.rows) ? input.rows.length : "unknown"} trial rows. The gateway checks paired conditions, independence declarations, baseline/QC gates and design metadata before accepting the job.</p> : null}
      {error ? <p className="model-run-error" role="alert">{error}</p> : null}
      <div className="model-run-layout"><div className="model-run-list">{runs.length ? runs.map((run) => <button className={selected?.id === run.id ? "model-run-row is-selected" : "model-run-row"} key={run.id} onClick={() => void inspect(run.id)}><span>Perturbation analysis<small>{new Date(run.created_at).toLocaleString()}</small></span><strong>{run.status}</strong></button>) : <p className="model-run-empty">No perturbation runs yet. The fixture exercises software only; imported experiments carry their own evidence level.</p>}</div>
        <div className="model-run-detail">{selected ? <>
          <div className="model-run-actions"><strong>{selected.status}</strong><button className="button-secondary" disabled={!local} onClick={() => void exportRun(selected)}><Download size={14} /> Export full run</button></div>
          {selected.error ? <p role="alert" className="model-run-error">{selected.error}</p> : null}
          {selected.result ? <>
            <dl className="model-run-metrics"><div><dt>Matched effect</dt><dd>{selected.result.estimate.mean_difference.toFixed(3)}</dd></div><div><dt>Independent units</dt><dd>{selected.result.independent_units}</dd></div><div><dt>Unit sign-flip p</dt><dd>{selected.result.randomization_test.p_value.toFixed(4)}</dd></div><div><dt>Matched sessions</dt><dd>{selected.result.matched_sessions}</dd></div></dl>
            <p className="model-run-help">95% cluster bootstrap interval: {selected.result.estimate.ci95_cluster_bootstrap.map((v) => v.toFixed(3)).join(" – ")} {selected.result.estimate.unit}. {selected.result.evidence_level}.</p>
            <p className="model-run-notice">{selected.result.interpretation}</p>
            <table className="model-run-confusion"><caption>Each independent unit receives equal weight</caption><thead><tr><th>Unit</th><th>Effect</th><th>Sessions</th></tr></thead><tbody>{selected.result.unit_effects.map((effect) => <tr key={effect.unitId}><th scope="row">{effect.unitId}</th><td>{effect.effect.toFixed(3)}</td><td>{effect.matchedSessions}</td></tr>)}</tbody></table>
            <p className="model-run-help">{Array.isArray(selected.result.randomization_test.assumptions) ? selected.result.randomization_test.assumptions.join(" ") : selected.result.randomization_test.assumptions}</p>
            {selected.result.limitations.map((limit) => <p className="model-run-help" key={limit}>{limit}</p>)}
          </> : <p className="model-run-help">The local job validates and retains the complete input before analysis.</p>}
          <dl className="model-run-provenance"><dt>Input SHA-256</dt><dd>{selected.input_sha256}</dd><dt>Output SHA-256</dt><dd>{selected.output_sha256 ?? "Pending"}</dd></dl>
        </> : <p className="model-run-empty">Inspect a completed run to see controlled comparisons, uncertainty and provenance.</p>}</div></div>
      {recipes.length ? <details className="model-run-help"><summary>Executable method recipes ({recipes.length})</summary><table className="model-run-confusion"><thead><tr><th>Method</th><th>Version</th><th>Adapter status</th></tr></thead><tbody>{recipes.map((recipe) => <tr key={recipe.id}><td>{recipe.title ?? recipe.name ?? recipe.id}</td><td>{recipe.version}</td><td>{recipe.status}</td></tr>)}</tbody></table></details> : null}
    </div>
  </Panel>;
}
