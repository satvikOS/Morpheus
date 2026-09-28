"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  FileKey2,
  Fingerprint,
  HardDrive,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import type { DreamRecord } from "@/lib/morpheus";
import { downloadJson, sha256 } from "@/lib/morpheus";
import { recurrenceCandidates } from "@/lib/dream-analysis";
import {
  deleteDreamRecord,
  listDreamRecords,
  putDreamRecord,
} from "@/lib/dataset-store";
import { EmptyState, Metric, Panel, SectionHeader } from "./ui";

const modalities = [
  "visual",
  "auditory",
  "touch",
  "proprioception",
  "vestibular",
  "smell",
  "taste",
  "other",
];

export default function DatasetZeroPanel() {
  const [records, setRecords] = useState<DreamRecord[]>([]);
  const [report, setReport] = useState("");
  const [lucid, setLucid] = useState(false);
  const [confidence, setConfidence] = useState(4);
  const [tags, setTags] = useState("");
  const [selectedModalities, setSelectedModalities] = useState<string[]>(["visual"]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void listDreamRecords().then((items) => {
      if (!active) return;
      setRecords(items);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

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
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        sensory_modalities: selectedModalities,
      };

      await putDreamRecord(record);
      setRecords((current) => [record, ...current]);
      setReport("");
      setTags("");
      setLucid(false);
      setConfidence(4);
      setSelectedModalities(["visual"]);
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async (dreamId: string) => {
    const confirmed = window.confirm(
      "Delete this local sealed record from this browser? This cannot be undone from Morpheus.",
    );
    if (!confirmed) return;
    await deleteDreamRecord(dreamId);
    setRecords((current) => current.filter((item) => item.dream_id !== dreamId));
  };

  const totalWords = useMemo(
    () =>
      records.reduce(
        (sum, record) =>
          sum + record.raw_report.split(/\s+/).filter(Boolean).length,
        0,
      ),
    [records],
  );
  const candidates = useMemo(
    () => recurrenceCandidates(records, 8),
    [records],
  );

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Dataset Zero"
          title="Immutable dream capture"
          description="Raw reports are hashed before storage and retained in browser IndexedDB rather than transient React state or ordinary localStorage. Annotations remain separate from the sealed original."
          action={
            <button
              onClick={() =>
                downloadJson("morpheus-dataset-zero.json", {
                  exported_at: new Date().toISOString(),
                  schema: "morpheus-dataset-zero-v1",
                  records,
                })
              }
              disabled={!records.length}
              className="button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={13} /> Export JSON
            </button>
          }
        />
        <div className="metric-grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Records"
            value={loaded ? records.length : "…"}
            detail="IndexedDB local corpus"
          />
          <Metric
            label="Words captured"
            value={totalWords.toLocaleString()}
            detail="raw report text"
          />
          <Metric
            label="Integrity"
            value="SHA-256"
            detail="original-text fingerprint"
          />
          <Metric
            label="Storage plane"
            value="LOCAL"
            detail="no raw-report server upload"
          />
        </div>
      </Panel>

      <div className="dataset-layout">
        <Panel>
          <SectionHeader
            eyebrow="New record"
            title="Capture immediately after waking"
            description="Seal only after the raw narrative is complete. The hold interlock prevents accidental irreversible capture."
          />
          <div className="space-y-4 p-4">
            <label className="field-label">
              <span>Raw report</span>
              <textarea
                value={report}
                onChange={(event) => setReport(event.target.value)}
                rows={14}
                placeholder="Record what happened before editing, interpreting, checking messages, images, or other sources…"
                className="dataset-textarea"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="dataset-control-card">
                <span>Recall confidence · {confidence}/5</span>
                <input
                  type="range"
                  min="0"
                  max="5"
                  value={confidence}
                  onChange={(event) => setConfidence(Number(event.target.value))}
                  className="mt-3 w-full accent-sky-300"
                />
              </label>

              <button
                onClick={() => setLucid((value) => !value)}
                className={
                  lucid
                    ? "dataset-control-card dataset-control-card-active"
                    : "dataset-control-card"
                }
              >
                <span>Lucidity</span>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                  <span
                    className={
                      lucid
                        ? "flex h-5 w-5 items-center justify-center rounded-md border border-sky-300/30 text-sky-200"
                        : "flex h-5 w-5 items-center justify-center rounded-md border border-white/10 text-transparent"
                    }
                  >
                    <Check size={12} />
                  </span>
                  Recognized the dream state
                </div>
              </button>
            </div>

            <div>
              <div className="field-caption">Sensory modalities</div>
              <div className="flex flex-wrap gap-2">
                {modalities.map((modality) => {
                  const active = selectedModalities.includes(modality);
                  return (
                    <button
                      key={modality}
                      onClick={() =>
                        setSelectedModalities((current) =>
                          active
                            ? current.filter((item) => item !== modality)
                            : [...current, modality],
                        )
                      }
                      className={
                        active
                          ? "dataset-chip dataset-chip-active"
                          : "dataset-chip"
                      }
                    >
                      {modality}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="field-label">
              <span>Tags</span>
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="recurring, location-alpha, continuation"
                className="field-control"
              />
            </label>

            <HoldToSeal
              disabled={!report.trim() || saving}
              busy={saving}
              onConfirm={createRecord}
            />
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            eyebrow="Local corpus"
            title="Sealed records"
            description="IndexedDB is appropriate for the browser-side text corpus. Continuous biosignal recordings remain in the local acquisition plane, not browser storage."
            action={
              <div className="flex items-center gap-2 text-[9px] uppercase tracking-[.13em] text-slate-600">
                <HardDrive size={12} />
                IndexedDB
              </div>
            }
          />
          {records.length ? (
            <div className="divide-y divide-white/[.055]">
              {records.map((record) => (
                <article key={record.dream_id} className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-sky-200">
                          {record.dream_id}
                        </span>
                        {record.lucid ? <span className="tag">LUCID</span> : null}
                        <span className="tag">CONF {record.confidence}/5</span>
                      </div>

                      <p className="mt-3 line-clamp-4 max-w-4xl text-xs leading-5 text-slate-400">
                        {record.raw_report}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {record.sensory_modalities.map((item) => (
                          <span className="tag-muted" key={item}>
                            {item}
                          </span>
                        ))}
                        {record.tags.map((item) => (
                          <span className="tag-muted" key={item}>
                            #{item}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => void removeRecord(record.dream_id)}
                      className="button-icon shrink-0"
                      title="Delete local record"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-[1fr_2fr]">
                    <div className="flex items-center gap-2 text-[10px] text-slate-650">
                      <FileKey2 size={12} />
                      {new Date(record.captured_at).toLocaleString()}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 font-mono text-[9px] text-slate-700">
                      <Fingerprint size={12} className="shrink-0" />
                      <span className="truncate">{record.raw_sha256}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>
              No records yet. The first sealed report will be stored in this
              browser&apos;s IndexedDB database.
            </EmptyState>
          )}
        </Panel>
      </div>

      <Panel>
        <SectionHeader
          eyebrow="M1 local baseline"
          title="Recurrence candidates"
          description="A deterministic local lexical, tag, and modality baseline ranks candidate dream pairs without uploading raw reports. It is a screening tool, not evidence that two dreams are the same episode."
          action={<span className="tag-muted">{candidates.length} PAIRS</span>}
        />
        {candidates.length ? (
          <div className="divide-y divide-white/[.055]">
            {candidates.map((pair) => (
              <div
                key={`${pair.a}-${pair.b}`}
                className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_1fr_100px_1.2fr] lg:items-center"
              >
                <span className="truncate font-mono text-[10px] text-slate-400">
                  {pair.a}
                </span>
                <span className="truncate font-mono text-[10px] text-slate-400">
                  {pair.b}
                </span>
                <span className="font-mono text-xs text-sky-200">
                  {(pair.score * 100).toFixed(1)}%
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {pair.sharedTokens.length ? (
                    pair.sharedTokens.map((token) => (
                      <span key={token} className="tag-muted">
                        {token}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-slate-700">
                      no shared lexical tokens
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            At least two local records are required for recurrence screening.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}

function HoldToSeal({
  disabled,
  busy,
  onConfirm,
}: {
  disabled: boolean;
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (raf.current) window.cancelAnimationFrame(raf.current);
    timer.current = null;
    raf.current = null;
    setHolding(false);
    setProgress(0);
  };

  const begin = () => {
    if (disabled || busy || holding) return;
    setHolding(true);
    startedAt.current = performance.now();

    const tick = () => {
      const elapsed = performance.now() - startedAt.current;
      setProgress(Math.min(100, (elapsed / 900) * 100));
      if (elapsed < 900) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    timer.current = window.setTimeout(() => {
      cancel();
      void onConfirm();
    }, 900);
  };

  useEffect(() => cancel, []);

  return (
    <button
      disabled={disabled || busy}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={() => {
        if (holding) cancel();
      }}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) begin();
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") cancel();
      }}
      className="hold-seal"
    >
      <span className="hold-seal-progress" style={{ width: `${progress}%` }} />
      <span className="relative z-10 flex items-center justify-center gap-2">
        <LockKeyhole size={14} />
        {busy
          ? "Sealing…"
          : holding
            ? "Keep holding to seal"
            : "Press and hold to seal record"}
      </span>
    </button>
  );
}
