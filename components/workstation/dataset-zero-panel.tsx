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
import { downloadJson, sha256 } from "@/lib/morpheus";
import { recurrenceCandidates } from "@/lib/dream-analysis";
import {
  appendDreamAnnotation,
  dreamCorpusExport,
  reportLatencySeconds,
  type ResearchDreamRecord,
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
  const [records, setRecords] = useState<ResearchDreamRecord[]>([]);
  const [report, setReport] = useState("");
  const [lucid, setLucid] = useState(false);
  const [confidence, setConfidence] = useState(4);
  const [tags, setTags] = useState("");
  const [selectedModalities, setSelectedModalities] = useState<string[]>(["visual"]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [subjectId, setSubjectId] = useState("subject-001");
  const [sessionId, setSessionId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [awakenedAt, setAwakenedAt] = useState("");
  const [priorRecall, setPriorRecall] = useState<"yes" | "no" | "unknown">("unknown");
  const [annotationTarget, setAnnotationTarget] = useState("");
  const [annotationNote, setAnnotationNote] = useState("");

  useEffect(() => {
    let active = true;
    void listDreamRecords().then((items) => {
      if (!active) return;
      setRecords(items);
      setLoaded(true);
    }).catch((error: unknown) => {
      if (active) { setStorageError(error instanceof Error ? error.message : "Could not load the local corpus."); setLoaded(true); }
    });
    return () => {
      active = false;
    };
  }, []);

  const createRecord = async () => {
    const raw = report;
    if (!raw.trim() || saving) return;
    if (![subjectId, sessionId, episodeId].every((value) => value.trim())) { setStorageError("Enter pseudonymous subject, session and sleep episode IDs before sealing."); return; }

    setSaving(true);
    setStorageError("");
    try {
      const captured = new Date().toISOString();
      const digest = await sha256(raw);
      const awakened = awakenedAt ? new Date(awakenedAt).toISOString() : null;
      const record: ResearchDreamRecord = {
        schema_version: "dataset-zero-v2",
        capture: {
          subject_id: subjectId.trim(), session_id: sessionId.trim(), sleep_episode_id: episodeId.trim(),
          awakening_id: crypto.randomUUID(), awakened_at: awakened,
          report_latency_seconds: reportLatencySeconds(awakened, captured),
          awakening_method: "unknown", sleep_stage: null, protocol_version: "m0-capture-v2",
          recording_id: null, marker_ids: [], prior_related_recall: priorRecall,
        },
        annotations: [],
        dream_id: `D-${crypto.randomUUID()}`,
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
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Report could not be saved. Your text remains in the editor.");
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async (dreamId: string) => {
    const confirmed = window.confirm(
      "Delete this local sealed record from this browser? This cannot be undone from Morpheus.",
    );
    if (!confirmed) return;
    try {
      await deleteDreamRecord(dreamId);
      setRecords((current) => current.filter((item) => item.dream_id !== dreamId));
    } catch (error) { setStorageError(error instanceof Error ? error.message : "Record could not be deleted."); }
  };

  const addAnnotation = async () => {
    const record = records.find((row) => row.dream_id === annotationTarget);
    if (!record || !annotationNote.trim() || saving) return;
    setSaving(true);
    setStorageError("");
    try {
      const next = appendDreamAnnotation(record, {
        id: crypto.randomUUID(), created_at: new Date().toISOString(), annotator_id: subjectId.trim() || "self",
        method: "self_report", blinding: "unblinded", note: annotationNote, tags: [], entities: [], locations: [], events: [],
        subjective_recurrence: null, subjective_continuation: null,
      });
      await putDreamRecord(next);
      setRecords((current) => current.map((row) => row.dream_id === next.dream_id ? next : row));
      setAnnotationNote(""); setAnnotationTarget("");
    } catch (error) { setStorageError(error instanceof Error ? error.message : "Annotation could not be saved."); }
    finally { setSaving(false); }
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
      {storageError ? <div role="alert" className="rounded-lg border border-red-400/30 bg-red-950/20 p-4 text-sm text-red-200">{storageError}</div> : null}
      <Panel>
        <SectionHeader
          eyebrow="Dataset Zero"
          title="Immutable dream capture"
          description="Seal the exact narrative with capture context. Later annotations are separate, attributed revisions. Reports stay in this browser; export a backup before clearing site data."
          action={
            <button
              onClick={() =>
                downloadJson("morpheus-dataset-zero.json", dreamCorpusExport(records))
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field-label"><span>Subject ID (pseudonym)</span><input className="field-control" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} placeholder="subject-001" /></label>
              <label className="field-label"><span>Session ID</span><input className="field-control" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="sleep-session-001" /></label>
              <label className="field-label"><span>Sleep episode ID</span><input className="field-control" value={episodeId} onChange={(event) => setEpisodeId(event.target.value)} placeholder="Same ID for reports from one episode" /></label>
              <label className="field-label"><span>Awakening time (optional)</span><input type="datetime-local" className="field-control" value={awakenedAt} onChange={(event) => setAwakenedAt(event.target.value)} /></label>
            </div>
            <label className="field-label"><span>Recalled a related dream before sleeping?</span><select className="field-control" value={priorRecall} onChange={(event) => setPriorRecall(event.target.value as "yes" | "no" | "unknown")}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
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
              disabled={!report.trim() || !subjectId.trim() || !sessionId.trim() || !episodeId.trim() || saving}
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

                  <div className="mt-3 text-xs leading-5 text-slate-400">
                    {record.capture ? `${record.capture.subject_id} · ${record.capture.session_id} · episode ${record.capture.sleep_episode_id} · report latency ${record.capture.report_latency_seconds === null ? "unknown" : record.capture.report_latency_seconds + " s"}` : "Legacy capture: subject, episode and report latency unknown"}
                  </div>
                  {(record.annotations || []).map((annotation) => <p key={annotation.id} className="mt-3 border-l border-white/15 pl-3 text-sm leading-6 text-slate-300">Annotation {annotation.revision} · {annotation.annotator_id}: {annotation.note}</p>)}
                  <button className="button-secondary mt-3" onClick={() => { setAnnotationTarget(record.dream_id); setAnnotationNote(""); }}>Add annotation</button>
                  {annotationTarget === record.dream_id ? <div className="mt-3 space-y-3"><label className="field-label"><span>Separate annotation (raw text stays sealed)</span><textarea className="dataset-textarea" rows={3} value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} /></label><button className="button-primary" disabled={!annotationNote.trim() || saving} onClick={() => void addAnnotation()}>Save annotation revision</button><button className="button-secondary ml-2" onClick={() => setAnnotationTarget("")}>Cancel</button></div> : null}
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
          description="Lexical, TF-IDF, tag and sensory comparisons screen report pairs. Background ranks use disjoint, known episodes from the same subject. They are descriptive: no permutation significance or recovered dream identity is claimed. All scanned comparisons count toward the family screen."
          action={<span className="tag-muted">{candidates.length} PAIRS</span>}
        />
        {candidates.length ? (
          <div className="divide-y divide-white/[.055]">
            {candidates.map((pair) => (
              <div
                key={`${pair.a}-${pair.b}`}
                className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_1fr_90px_110px_1.2fr] lg:items-center"
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
                <span className="font-mono text-[10px] text-slate-500">
                  {pair.backgroundTailFraction != null
                    ? `background rank ${pair.backgroundTailFraction.toFixed(3)} · n=${pair.backgroundComparisons}; family screen ${pair.familyScreeningBound?.toFixed(3)} (${pair.testedComparisons} pairs)`
                    : `background unavailable · ${pair.testedComparisons} pairs scanned`}
                  <span className="block mt-1">TF-IDF {((pair.tfidf || 0) * 100).toFixed(1)}% · descriptive only</span>
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
