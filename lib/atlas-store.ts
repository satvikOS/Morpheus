export type AtlasSnapshot = {
  id: string;
  subjectId: string;
  sessionId: string;
  state: "awake" | "imagery" | "sleep" | "dream" | "other";
  capturedAt: string;
  source: string;
  sampleRate: number;
  channelCount: number;
  features: number[];
  featureNames: string[];
  metadata?: Record<string, string | number | boolean | null>;
  schemaVersion?: "atlas-snapshot-v2";
  provenance?: {
    sourceKind: "simulation_fixture" | "local_acquisition_unverified" | "unknown";
    featureSchema: string;
    preprocessingVersion: string;
    recordingId: string | null;
    qualityFlags: string[];
    evidence: "engineering_features_only";
  };
};

const DB_NAME = "morpheus-individual-atlas";
const DB_VERSION = 1;
const STORE = "snapshots";

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Atlas storage could not be opened."));
    request.onblocked = () => reject(new Error("Atlas storage is blocked by another tab."));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "id",
        });
        store.createIndex("subjectId", "subjectId");
        store.createIndex("capturedAt", "capturedAt");
      }
    };
  });
}

export async function listAtlasSnapshots(
  subjectId?: string,
): Promise<AtlasSnapshot[]> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable; atlas storage cannot be read.");
  const db = await openDb();
  try {
    return await new Promise<AtlasSnapshot[]>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const store = transaction.objectStore(STORE);
      const request = subjectId ? store.index("subjectId").getAll(subjectId) : store.getAll();
      let rows: AtlasSnapshot[] = [];
      request.onsuccess = () => { rows = request.result; };
      transaction.oncomplete = () => resolve(rows.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)));
      transaction.onerror = () => reject(transaction.error || new Error("Atlas read failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Atlas read aborted."));
    });
  } finally { db.close(); }
}

export async function putAtlasSnapshot(
  snapshot: AtlasSnapshot,
): Promise<void> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable; atlas changes have not been saved.");
  const normalized = normalizeAtlasSnapshot(snapshot);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.get(snapshot.id);
      let failure: Error | undefined;
      request.onsuccess = () => {
        if (request.result && JSON.stringify(normalizeAtlasSnapshot(request.result)) !== JSON.stringify(normalized)) {
          failure = new Error("Atlas snapshots are immutable. Capture a new measurement instead.");
          transaction.abort();
        } else store.put(normalized);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(failure || transaction.error || new Error("Atlas write aborted."));
      transaction.oncomplete = () => resolve();
    });
  } finally { db.close(); }
}

export async function deleteAtlasSnapshot(
  id: string,
): Promise<void> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable; atlas changes have not been saved.");
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(id);
      transaction.onerror = () => reject(transaction.error || new Error("Atlas deletion failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Atlas deletion aborted."));
      transaction.oncomplete = () => resolve();
    });
  } finally { db.close(); }
}


export function normalizeAtlasSnapshot(snapshot: AtlasSnapshot): AtlasSnapshot {
  if (!snapshot.id || !snapshot.subjectId || !snapshot.sessionId || !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      !["awake", "imagery", "sleep", "dream", "other"].includes(snapshot.state) || typeof snapshot.source !== "string" || !snapshot.source.trim() ||
      !Number.isFinite(snapshot.sampleRate) || snapshot.sampleRate <= 0 ||
      !Number.isInteger(snapshot.channelCount) || snapshot.channelCount <= 0 ||
      !Array.isArray(snapshot.features) || !snapshot.features.length || !Array.isArray(snapshot.featureNames) || snapshot.features.length !== snapshot.featureNames.length ||
      !snapshot.features.every(Number.isFinite) || !snapshot.featureNames.every((name) => typeof name === "string" && name.trim()) || new Set(snapshot.featureNames).size !== snapshot.featureNames.length) {
    throw new Error("Atlas measurement requires finite, named features and subject/session provenance.");
  }
  if (snapshot.schemaVersion && snapshot.schemaVersion !== "atlas-snapshot-v2") throw new Error("Unsupported atlas snapshot schema.");
  const mode = snapshot.metadata?.sourceMode;
  if (mode !== undefined && !["live", "simulation", "unverified"].includes(String(mode))) throw new Error("Unknown atlas acquisition mode.");
  const derivedKind = mode === "simulation" ? "simulation_fixture" : mode === "live" ? "local_acquisition_unverified" : "unknown";
  const supplied = snapshot.provenance;
  if (supplied && (!["simulation_fixture", "local_acquisition_unverified", "unknown"].includes(supplied.sourceKind) ||
      supplied.evidence !== "engineering_features_only" || typeof supplied.featureSchema !== "string" || !supplied.featureSchema.trim() ||
      typeof supplied.preprocessingVersion !== "string" || !supplied.preprocessingVersion.trim() ||
      (supplied.recordingId !== null && typeof supplied.recordingId !== "string") ||
      !Array.isArray(supplied.qualityFlags) || !supplied.qualityFlags.every((flag) => typeof flag === "string" && flag.trim()))) throw new Error("Invalid atlas engineering provenance.");
  if (supplied && mode !== undefined && supplied.sourceKind !== derivedKind) throw new Error("Atlas source provenance conflicts with the acquisition mode.");
  for (const key of ["featureSchema", "preprocessingVersion"] as const) {
    if (supplied && snapshot.metadata?.[key] !== undefined && String(snapshot.metadata[key]) !== supplied[key]) throw new Error("Atlas feature provenance conflicts with its metadata.");
  }
  const sourceKind = supplied?.sourceKind || derivedKind;
  const qualityFlags: string[] = [];
  for (const feature of ["flatlineRatio", "clippingRatio"]) {
    const index = snapshot.featureNames.indexOf(feature);
    if (index >= 0 && snapshot.features[index] >= 0.05) qualityFlags.push(feature + ">=0.05 (engineering screen)");
  }
  if (sourceKind === "unknown") qualityFlags.push("Source provenance unknown");
  return { ...snapshot, schemaVersion: "atlas-snapshot-v2", provenance: {
    sourceKind, featureSchema: String(snapshot.metadata?.featureSchema || "legacy_features_unspecified"),
    preprocessingVersion: String(snapshot.metadata?.preprocessingVersion || "not_recorded"),
    recordingId: typeof snapshot.metadata?.recordingId === "string" ? snapshot.metadata.recordingId : null,
    ...supplied, qualityFlags: [...new Set([...(supplied?.qualityFlags || []), ...qualityFlags])], evidence: "engineering_features_only",
  } };
}

function featureCosine(a: number[], b: number[]) {
  const magnitude = Math.hypot(...a) * Math.hypot(...b);
  return magnitude ? a.reduce((sum, value, index) => sum + value * b[index], 0) / magnitude : null;
}

/** Descriptive within-subject feature trajectories; does not establish memory contents or neural stability. */
export function longitudinalAtlasSummary(snapshots: AtlasSnapshot[], subjectId: string) {
  const rows = snapshots.filter((row) => row.subjectId === subjectId).map(normalizeAtlasSnapshot);
  const families = new Map<string, AtlasSnapshot[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.state, row.provenance!.sourceKind, row.provenance!.featureSchema, row.provenance!.preprocessingVersion, row.sampleRate, row.channelCount, row.featureNames]);
    families.set(key, [...(families.get(key) || []), row]);
  }
  return [...families.values()].map((family) => {
    const sessions = [...new Set(family.map((row) => row.sessionId))].map((sessionId) => {
      const measurements = family.filter((row) => row.sessionId === sessionId);
      const mean = family[0].features.map((_, index) => measurements.reduce((sum, row) => sum + row.features[index], 0) / measurements.length);
      const standardError = mean.map((value, index) => measurements.length > 1 ? Math.sqrt(measurements.reduce((sum, row) => sum + (row.features[index] - value) ** 2, 0) / (measurements.length - 1) / measurements.length) : null);
      return { sessionId, capturedAt: measurements.map((row) => row.capturedAt).sort()[0], n: measurements.length, mean, standardError,
        flaggedMeasurements: measurements.filter((row) => row.provenance!.qualityFlags.length > 0).length };
    }).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    const adjacentComparisons = sessions.slice(1).map((row, index) => ({ fromSession: sessions[index].sessionId, toSession: row.sessionId, cosine: featureCosine(sessions[index].mean, row.mean) }));
    return { state: family[0].state, sourceKind: family[0].provenance!.sourceKind, featureSchema: family[0].provenance!.featureSchema,
      featureNames: family[0].featureNames, sessions, adjacentComparisons, evidence: "descriptive_only" as const,
      limitation: "Hand-crafted feature cosine depends on feature scaling. Standard errors describe repeated snapshots, not independent sessions or decoding accuracy." };
  });
}
