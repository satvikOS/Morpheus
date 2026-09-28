"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Download, FileKey2, Fingerprint, LockKeyhole, Trash2 } from "lucide-react";
import type { DreamRecord } from "@/lib/morpheus";
import { downloadJson, sha256 } from "@/lib/morpheus";
import { recurrenceCandidates } from "@/lib/dream-analysis";
import { EmptyState, Metric, Panel, SectionHeader } from "./ui";

const STORAGE_KEY = "morpheus.dataset-zero.v1";
const modalities = ["visual", "auditory", "touch", "proprioception", "vestibular", "smell", "taste", "other"];

export default function DatasetZeroPanel() {
  const [records, setRecords] = useState<DreamRecord[]>([]);
  const [report, setReport] = useState("");
  const [lucid, setLucid] = useState(false);
  const [confidence, setConfidence] = useState(4);
  const [tags, setTags] = useState("");
  const [selectedModalities, setSelectedModalities] = useState<string[]>(["visual"]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setRecords(JSON.parse(stored) as DreamRecord[]);
    } catch {}
  }, []);

  const persist = (next: DreamRecord[]) => {
    setRecords(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const createRecord = async () => {
    const raw = report.trim();
    if (!raw || saving) return;
    setSaving(true);
    try {
      const captured = new Date().toISOString();
      const digest = await sha256(raw);
      const record: DreamRecord = {
        dream_id: `D-${captured.replace(/[-:.TZ]/g, "").slice(0, 14)}-${digest.slice(0, 6)}`,
        captured_at: captured,
        raw_report: raw,
        raw_sha256: digest,
        lucid,
        confidence,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        sensory_modalities: selectedModalities,
      };
      persist([record, ...records]);
      setReport("");
      setTags("");
      setLucid(false);
      setConfidence(4);
      setSelectedModalities(["visual"]);
    } finally {
      setSaving(false);
    }
  };

  const totalWords = useMemo(
    () => records.reduce((sum, record) => sum + record.raw_report.split(/\s+/).filter(Boolean).length, 0),
    [records],
  );
  const candidates = useMemo(() => recurrenceCandidates(records, 8), [records]);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Dataset Zero"
          title="Immutable dream capture"
          description="Raw reports are sealed in the browser with SHA-256 and stored locally. Annotations live beside the original instead of rewriting it. Nothing here uploads a personal dream report to Morpheus servers."
          action={
            <button
              onClick={() => downloadJson("morpheus-dataset-zero.json", { exported_at: new Date().toISOString(), records })}
              disabled={!records.length}
              className="button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={13} /> Export JSON
            </button>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Metric label="Records" value={records.length} detail="local browser corpus" />
          <Metric label="Words captured" value={totalWords.toLocaleString()} detail="raw report text" />
          <Metric label="Integrity" value="SHA-256" detail="original-text fingerprint" />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[.78fr_1.22fr]">
        <Panel>
          <SectionHeader eyebrow="New record" title="Capture immediately after waking" />
          <div className="space-y-4 p-4">
            <label className="block">
              <span className="mb-2 block text-[10px] uppercase tracking-[.16em] text-slate-600">Raw report</span>
              <textarea
                value={report}
                onChange={(event) => setReport(event.target.value)}
                rows={13}
                placeholder="Record what happened before editing, interpreting, or checking other sources..."
                className="w-full resize-y rounded-xl border border-white/[.08] bg-black/20 px-3 py-3 text-sm leading-6 text-slate-200 outline-none placeholder:text-slate-700 focus:border-sky-300/30"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rounded-xl border border-white/[.07] bg-black/15 p-3">
                <span className="text-[10px] uppercase tracking-[.16em] text-slate-600">Recall confidence · {confidence}/5</span>
                <input
                  type="range"
                  min="0"
                  max="5"
                  value={confidence}
                  onChange={(event) => setConfidence(Number(event.target.value))}
                  className="mt-3 w-full"
                />
              </label>
              <button
                onClick={() => setLucid((value) => !value)}
                className={`rounded-xl border p-3 text-left transition ${
                  lucid ? "border-sky-300/20 bg-sky-300/[.05]" : "border-white/[.07] bg-black/15"
                }`}
              >
                <div className="text-[10px] uppercase tracking-[.16em] text-slate-600">Lucidity</div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${lucid ? "border-sky-300/30 text-sky-200" : "border-white/10 text-transparent"}`}>
                    <Check size={12} />
                  </span>
                  Recognized the dream state
                </div>
              </button>
            </div>

            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[.16em] text-slate-600">Sensory modalities</div>
              <div className="flex flex-wrap gap-2">
                {modalities.map((modality) => {
                  const active = selectedModalities.includes(modality);
                  return (
                    <button
                      key={modality}
                      onClick={() => setSelectedModalities((current) =>
                        active ? current.filter((item) => item !== modality) : [...current, modality]
                      )}
                      className={`rounded-lg border px-2.5 py-1.5 text-[10px] transition ${
                        active ? "border-sky-300/20 bg-sky-300/[.06] text-sky-100" : "border-white/[.07] text-slate-600"
                      }`}
                    >
                      {modality}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-[10px] uppercase tracking-[.16em] text-slate-600">Tags</span>
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="recurring, location-alpha, continuation"
                className="w-full rounded-lg border border-white/[.08] bg-black/20 px-3 py-2.5 text-xs text-slate-300 outline-none placeholder:text-slate-700 focus:border-sky-300/30"
              />
            </label>

            <button onClick={createRecord} disabled={!report.trim() || saving} className="button-primary w-full disabled:cursor-not-allowed disabled:opacity-40">
              <LockKeyhole size={14} /> {saving ? "Sealing..." : "Seal record"}
            </button>
          </div>
        </Panel>

        <Panel>
          <SectionHeader eyebrow="Local corpus" title="Sealed records" description="Delete and export operate only on this browser's local copy." />
          {records.length ? (
            <div className="divide-y divide-white/[.055]">
              {records.map((record) => (
                <article key={record.dream_id} className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-sky-200">{record.dream_id}</span>
                        {record.lucid ? <span className="tag">LUCID</span> : null}
                        <span className="tag">CONF {record.confidence}/5</span>
                      </div>
                      <p className="mt-3 line-clamp-3 max-w-3xl text-xs leading-5 text-slate-400">{record.raw_report}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {record.sensory_modalities.map((item) => <span className="tag-muted" key={item}>{item}</span>)}
                        {record.tags.map((item) => <span className="tag-muted" key={item}>#{item}</span>)}
                      </div>
                    </div>
                    <button
                      onClick={() => persist(records.filter((item) => item.dream_id !== record.dream_id))}
                      className="button-icon shrink-0"
                      title="Delete local record"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-[1fr_2fr]">
                    <div className="flex items-center gap-2 text-[10px] text-slate-650"><FileKey2 size={12} /> {new Date(record.captured_at).toLocaleString()}</div>
                    <div className="flex min-w-0 items-center gap-2 font-mono text-[9px] text-slate-700"><Fingerprint size={12} className="shrink-0" /><span className="truncate">{record.raw_sha256}</span></div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>No records yet. Your first sealed report will appear here.</EmptyState>
          )}
        </Panel>
      </div>

      <Panel>
        <SectionHeader
          eyebrow="M1 local baseline"
          title="Recurrence candidates"
          description="A deterministic local lexical/tag/modality baseline ranks candidate dream pairs without uploading raw reports. It is a screening tool, not evidence that two dreams are the same episode."
          action={<span className="tag-muted">{candidates.length} PAIRS</span>}
        />
        {candidates.length ? (
          <div className="divide-y divide-white/[.055]">
            {candidates.map((pair) => (
              <div key={`${pair.a}-${pair.b}`} className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_1fr_100px_1.2fr] lg:items-center">
                <span className="truncate font-mono text-[10px] text-slate-400">{pair.a}</span>
                <span className="truncate font-mono text-[10px] text-slate-400">{pair.b}</span>
                <span className="font-mono text-xs text-sky-200">{(pair.score * 100).toFixed(1)}%</span>
                <div className="flex flex-wrap gap-1.5">
                  {pair.sharedTokens.length ? pair.sharedTokens.map((token) => (
                    <span key={token} className="tag-muted">{token}</span>
                  )) : <span className="text-[10px] text-slate-700">no shared lexical tokens</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>At least two local records are required for recurrence screening.</EmptyState>
        )}
      </Panel>
    </div>
  );
}
