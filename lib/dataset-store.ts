import type { DreamRecord } from "@/lib/morpheus";

/** Captured context belongs to the sealed report; later interpretations are revisions. */
export type DreamCaptureContext = {
  subject_id: string;
  session_id: string;
  sleep_episode_id: string;
  awakening_id: string;
  awakened_at: string | null;
  report_latency_seconds: number | null;
  awakening_method: "spontaneous" | "external" | "unknown";
  sleep_stage: string | null;
  protocol_version: string;
  recording_id: string | null;
  marker_ids: string[];
  prior_related_recall: "yes" | "no" | "unknown";
};

export type DreamAnnotation = {
  id: string;
  revision: number;
  created_at: string;
  annotator_id: string;
  method: "self_report" | "independent_annotation";
  blinding: "unblinded" | "condition_hidden";
  note: string;
  tags: string[];
  entities: string[];
  locations: string[];
  events: string[];
  subjective_recurrence: boolean | null;
  subjective_continuation: boolean | null;
};

export type ResearchDreamRecord = DreamRecord & {
  schema_version?: "dataset-zero-v2";
  capture?: DreamCaptureContext;
  annotations?: DreamAnnotation[];
};

const DB_NAME = "morpheus-local";
// The key layout is unchanged; v1 rows remain readable without assigning missing context.
const DB_VERSION = 1;
const STORE = "dream-records";
const LEGACY_KEY = "morpheus.dataset-zero.v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "dream_id" });
        store.createIndex("captured_at", "captured_at");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local corpus could not be opened."));
    request.onblocked = () => reject(new Error("Local corpus is blocked by another tab. Close older Morpheus tabs and retry."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Local corpus transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Local corpus transaction was aborted."));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local corpus read failed."));
  });
}

function legacyRecords(): ResearchDreamRecord[] {
  if (typeof localStorage === "undefined") throw new Error("Local browser storage is unavailable. Reports have not been saved.");
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records)) throw new Error("Legacy corpus is malformed. Preserve a browser backup before recovery.");
  for (const record of records) validateDreamRecord(record as ResearchDreamRecord);
  return records as ResearchDreamRecord[];
}

export function validateDreamRecord(record: ResearchDreamRecord) {
  if (!record || typeof record.dream_id !== "string" || !record.dream_id ||
      typeof record.raw_report !== "string" || !record.raw_report.trim() ||
      typeof record.raw_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(record.raw_sha256) ||
      !Number.isFinite(Date.parse(record.captured_at)) ||
      typeof record.lucid !== "boolean" ||
      !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 5 ||
      !Array.isArray(record.tags) || !record.tags.every((value) => typeof value === "string") ||
      !Array.isArray(record.sensory_modalities) || !record.sensory_modalities.every((value) => typeof value === "string")) {
    throw new Error("Dream record does not match the capture schema.");
  }
  if (record.schema_version && record.schema_version !== "dataset-zero-v2") throw new Error("Unsupported dream record schema.");
  if (record.schema_version === "dataset-zero-v2" && !record.capture) throw new Error("Version 2 records need sealed capture context.");
  if (record.capture) {
    const context = record.capture;
    if (![context.subject_id, context.session_id, context.sleep_episode_id, context.awakening_id, context.protocol_version].every((value) => typeof value === "string" && value.trim())) throw new Error("Capture context requires pseudonymous subject, session, episode, awakening and protocol IDs.");
    if (!["yes", "no", "unknown"].includes(context.prior_related_recall) || !Array.isArray(context.marker_ids) || !context.marker_ids.every((value) => typeof value === "string") ||
        !["spontaneous", "external", "unknown"].includes(context.awakening_method) || (context.awakened_at !== null && typeof context.awakened_at !== "string")) throw new Error("Invalid capture context values.");
    const latency = reportLatencySeconds(context.awakened_at, record.captured_at);
    if (latency !== context.report_latency_seconds) throw new Error("Report latency does not match the recorded awakening time.");
  }
  for (const [index, annotation] of (record.annotations || []).entries()) {
    if (![annotation.tags, annotation.entities, annotation.locations, annotation.events].every((values) => Array.isArray(values) && values.every((value) => typeof value === "string")) || !["self_report", "independent_annotation"].includes(annotation.method) || !["unblinded", "condition_hidden"].includes(annotation.blinding)) throw new Error("Invalid annotation schema.");
    if (annotation.revision !== index + 1 || !annotation.id || !annotation.annotator_id?.trim() || !Number.isFinite(Date.parse(annotation.created_at)) || typeof annotation.note !== "string") throw new Error("Annotation revisions must be sequential and attributed.");
  }
}

export function reportLatencySeconds(awakenedAt: string | null, capturedAt: string): number | null {
  if (!awakenedAt) return null;
  const delta = Date.parse(capturedAt) - Date.parse(awakenedAt);
  if (!Number.isFinite(delta) || delta < 0) throw new Error("Awakening time must precede capture time.");
  return Math.round(delta / 1000);
}

export function assertDreamRecordUpdate(previous: ResearchDreamRecord | undefined, next: ResearchDreamRecord) {
  validateDreamRecord(next);
  if (!previous) return;
  const sealed = (record: ResearchDreamRecord) => JSON.stringify({
    dream_id: record.dream_id, captured_at: record.captured_at, raw_report: record.raw_report,
    raw_sha256: record.raw_sha256, lucid: record.lucid, confidence: record.confidence,
    tags: record.tags, sensory_modalities: record.sensory_modalities,
    schema_version: record.schema_version, capture: record.capture,
  });
  if (sealed(previous) !== sealed(next)) throw new Error("Sealed capture cannot be overwritten. Add a separate annotation revision.");
  const before = previous.annotations || [];
  const after = next.annotations || [];
  if (after.length < before.length || before.some((annotation, index) => JSON.stringify(annotation) !== JSON.stringify(after[index]))) throw new Error("Existing annotations are immutable. Append a new revision.");
}

export function appendDreamAnnotation(record: ResearchDreamRecord, annotation: Omit<DreamAnnotation, "revision">): ResearchDreamRecord {
  const next = { ...record, annotations: [...(record.annotations || []), { ...annotation, revision: (record.annotations?.length || 0) + 1 }] };
  assertDreamRecordUpdate(record, next);
  return next;
}

export function dreamCorpusExport(records: ResearchDreamRecord[], exportedAt = new Date().toISOString()) {
  return {
    schema: "morpheus-dataset-zero-v2", exported_at: exportedAt,
    storage_plane: "local", integrity: "SHA-256 of exact raw report text; does not establish authorship or external timestamp",
    records: [...records].sort((a, b) => a.dream_id.localeCompare(b.dream_id)),
    legacy_context: "Missing v1 context remains unknown; raw reports and digests are preserved.",
  };
}

export async function listDreamRecords(): Promise<ResearchDreamRecord[]> {
  if (typeof indexedDB === "undefined") return legacyRecords().sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const done = transactionDone(tx);
    const [records] = await Promise.all([requestValue(tx.objectStore(STORE).getAll() as IDBRequest<ResearchDreamRecord[]>), done]);
    // Merge rather than discard legacy rows when IndexedDB already contains newer captures.
    const legacy = legacyRecords();
    const existing = new Map(records.map((record) => [record.dream_id, record]));
    for (const record of legacy) {
      const match = existing.get(record.dream_id);
      if (match) assertDreamRecordUpdate(record, match);
      else { await putDreamRecord(record); records.push(record); }
    }
    if (legacy.length) {
      // Retain the untouched legacy payload as an inactive recovery backup, never an active import source.
      if (!localStorage.getItem("morpheus.dataset-zero.legacy-backup.v1")) localStorage.setItem("morpheus.dataset-zero.legacy-backup.v1", localStorage.getItem(LEGACY_KEY)!);
      localStorage.removeItem(LEGACY_KEY);
    }
    return records.sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  } finally { db.close(); }
}

export async function verifyDreamRecordIntegrity(record: ResearchDreamRecord): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(record.raw_report));
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return actual === record.raw_sha256.toLowerCase();
}

export async function putDreamRecord(record: ResearchDreamRecord): Promise<void> {
  validateDreamRecord(record);
  if (!await verifyDreamRecordIntegrity(record)) throw new Error("Raw report does not match its sealed SHA-256 digest.");
  if (typeof indexedDB === "undefined") {
    const previous = legacyRecords();
    assertDreamRecordUpdate(previous.find((item) => item.dream_id === record.dream_id), record);
    localStorage.setItem(LEGACY_KEY, JSON.stringify([record, ...previous.filter((item) => item.dream_id !== record.dream_id)]));
    return;
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    let validationError: Error | undefined;
    const store = tx.objectStore(STORE);
    const request = store.get(record.dream_id);
    request.onsuccess = () => {
      try { assertDreamRecordUpdate(request.result, record); store.put(record); }
      catch (error) { validationError = error instanceof Error ? error : new Error("Capture update rejected."); tx.abort(); }
    };
    try { await done; } catch (error) { throw validationError || error; }
  } finally { db.close(); }
}

export async function deleteDreamRecord(dreamId: string): Promise<void> {
  // Explicit deletion also removes migration recovery copies; never silently re-import deleted reports.
  if (typeof localStorage !== "undefined") {
    for (const key of [LEGACY_KEY, "morpheus.dataset-zero.legacy-backup.v1"]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const rows = JSON.parse(raw) as ResearchDreamRecord[];
      if (!Array.isArray(rows)) throw new Error("Local recovery copy is malformed; deletion was not completed.");
      if (rows.some((record) => record.dream_id === dreamId)) localStorage.setItem(key, JSON.stringify(rows.filter((record) => record.dream_id !== dreamId)));
    }
  }
  if (typeof indexedDB === "undefined") {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyRecords().filter((item) => item.dream_id !== dreamId)));
    return;
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    tx.objectStore(STORE).delete(dreamId);
    await done;
  } finally { db.close(); }
}
