export type TrialState = "CREATED" | "AWAKENED" | "FOLLOWUP" | "SCORED" | "EXCLUDED";
export type TrialProtocol = {
  version: "m2-protocol-v2";
  registeredAt: string;
  operatorId: string;
  delaySeconds: number;
  intentionCondition: boolean;
  assignment: "manual";
  scoringRule: string;
  analysisPlan: string;
  preDreamId: string | null;
};
export type TrialTransition = { state: TrialState; at: string; reason: string; markerId?: string };
export type ReinstatementTrial = {
  id: string;
  sessionId: string;
  createdAt: string;
  delaySeconds: number;
  intentionCondition: boolean;
  preDreamId?: string;
  postDreamId?: string;
  continuityScore: number | null;
  blinded: boolean;
  notes: string;
  completedAt?: string;
  schemaVersion?: "reinstatement-trial-v2";
  protocol?: TrialProtocol;
  protocolSha256?: string;
  state?: TrialState;
  transitions?: TrialTransition[];
  scorerId?: string;
  scoringMethod?: "operator_unblinded" | "independent_condition_hidden";
  exclusionReason?: string;
};

const DB_NAME = "morpheus-reinstatement";
const STORE = "trials";

const permittedTransitions: Record<TrialState, TrialState[]> = {
  CREATED: ["AWAKENED", "FOLLOWUP", "EXCLUDED"], AWAKENED: ["FOLLOWUP", "EXCLUDED"],
  FOLLOWUP: ["SCORED", "EXCLUDED"], SCORED: ["EXCLUDED"], EXCLUDED: [],
};

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable. The trial has not been saved."));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error || new Error("Trial database could not be opened."));
    request.onblocked = () => reject(new Error("Trial storage is blocked by another tab."));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId");
        store.createIndex("createdAt", "createdAt");
      }
    };
  });
}
function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Trial storage failed."));
    tx.onabort = () => reject(tx.error || new Error("Trial update was aborted."));
  });
}

export async function protocolDigest(protocol: TrialProtocol) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(protocol)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function transitionTrial(trial: ReinstatementTrial, state: TrialState, reason: string, at = new Date().toISOString(), markerId?: string): ReinstatementTrial {
  if (!trial.state || !permittedTransitions[trial.state].includes(state)) throw new Error("Invalid trial state transition.");
  const previousAt = trial.transitions?.at(-1)?.at || trial.createdAt;
  if (!reason.trim() || !Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(previousAt)) throw new Error("A trial transition requires a reason and a non-decreasing timestamp.");
  return { ...trial, state, transitions: [...(trial.transitions || []), { state, reason, at, ...(markerId ? { markerId } : {}) }], ...(state === "EXCLUDED" ? { exclusionReason: reason } : {}) };
}

export function scoreTrial(trial: ReinstatementTrial, score: number, postDreamId: string, notes: string, scorerId: string, at = new Date().toISOString()): ReinstatementTrial {
  if (!Number.isInteger(score) || score < 0 || score > 5 || !postDreamId.trim() || !trial.preDreamId?.trim() || !scorerId.trim()) throw new Error("Scoring requires two report IDs, a scorer ID and an integer score from 0 to 5.");
  const followup = trial.state === "FOLLOWUP" ? trial : transitionTrial(trial, "FOLLOWUP", "Follow-up report linked", at);
  const scored = transitionTrial(followup, "SCORED", "Operator continuity score recorded", at);
  // This workstation shows the operator the condition, so its scores cannot claim blinding.
  return { ...scored, continuityScore: score, postDreamId: postDreamId.trim(), notes, scorerId, blinded: false, scoringMethod: "operator_unblinded", completedAt: at };
}

export function assertTrialUpdate(previous: ReinstatementTrial | undefined, next: ReinstatementTrial) {
  if (!next.id || !next.sessionId || !Number.isFinite(Date.parse(next.createdAt)) || !Number.isFinite(next.delaySeconds) || next.delaySeconds <= 0 || typeof next.intentionCondition !== "boolean" || typeof next.blinded !== "boolean") throw new Error("Invalid trial metadata.");
  if (next.schemaVersion && next.schemaVersion !== "reinstatement-trial-v2") throw new Error("Unsupported trial schema.");
  if (next.schemaVersion === "reinstatement-trial-v2") {
    if (!next.protocol || !/^[a-f0-9]{64}$/.test(next.protocolSha256 || "") || !next.transitions?.length || !next.state) throw new Error("Versioned trials require a sealed protocol and transition log.");
    if (next.protocol.version !== "m2-protocol-v2" || next.protocol.assignment !== "manual") throw new Error("This trial protocol records manual assignment only.");
    if (next.protocol.registeredAt !== next.createdAt || !next.protocol.operatorId?.trim() || !next.protocol.scoringRule?.trim() || !next.protocol.analysisPlan?.trim()) throw new Error("Protocol snapshot requires registration time, operator, rubric and analysis plan.");
    const log = next.transitions;
    if (log[0].state !== "CREATED" || log[0].at !== next.createdAt || log.at(-1)?.state !== next.state) throw new Error("Trial state must match its transition log.");
    for (let index = 0; index < log.length; index += 1) {
      if (!Number.isFinite(Date.parse(log[index].at)) || !log[index].reason.trim() ||
          (index > 0 && (Date.parse(log[index].at) < Date.parse(log[index - 1].at) || !permittedTransitions[log[index - 1].state]?.includes(log[index].state)))) throw new Error("Trial transition log contains an invalid transition.");
    }
    if (next.delaySeconds !== next.protocol.delaySeconds || next.intentionCondition !== next.protocol.intentionCondition || (next.preDreamId || null) !== next.protocol.preDreamId) throw new Error("Trial condition does not match its registered protocol.");
    const scoringEvent = log.find((event) => event.state === "SCORED");
    if (scoringEvent && (next.continuityScore === null || !next.preDreamId?.trim() || !next.postDreamId?.trim() || !next.scorerId?.trim() || next.completedAt !== scoringEvent.at)) throw new Error("A scored trial requires both report references, assessor and completion timestamp.");
    if (!scoringEvent && (next.continuityScore !== null || next.completedAt || next.scorerId || next.scoringMethod)) throw new Error("Scores require a recorded scoring transition.");
    if (scoringEvent && !["operator_unblinded", "independent_condition_hidden"].includes(next.scoringMethod || "")) throw new Error("A scored trial requires explicit scoring provenance.");
    if (next.blinded && (next.scoringMethod !== "independent_condition_hidden" || !next.scorerId || next.scorerId === next.protocol.operatorId)) throw new Error("Blinding requires a separate condition-hidden assessor; operator scores are unblinded.");
  }
  if (next.continuityScore !== null && (!Number.isInteger(next.continuityScore) || next.continuityScore < 0 || next.continuityScore > 5)) throw new Error("Invalid continuity score.");
  if (!previous) return;
  const immutable = (trial: ReinstatementTrial) => JSON.stringify([trial.id, trial.sessionId, trial.createdAt, trial.delaySeconds, trial.intentionCondition, trial.preDreamId, trial.protocol, trial.protocolSha256, trial.schemaVersion]);
  if (immutable(previous) !== immutable(next)) throw new Error("Registered protocol and condition cannot be changed retrospectively.");
  const before = previous.transitions || [];
  const after = next.transitions || [];
  if (after.length < before.length || before.some((event, index) => JSON.stringify(event) !== JSON.stringify(after[index]))) throw new Error("Trial history cannot be rewritten.");
  if (previous.continuityScore !== null && JSON.stringify([previous.continuityScore, previous.postDreamId, previous.notes, previous.scorerId, previous.blinded, previous.scoringMethod, previous.completedAt]) !== JSON.stringify([next.continuityScore, next.postDreamId, next.notes, next.scorerId, next.blinded, next.scoringMethod, next.completedAt])) throw new Error("Completed scores are immutable; retain exclusions and plan a new trial.");
}

export async function listReinstatementTrials(): Promise<ReinstatementTrial[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const finished = done(tx);
    const request = tx.objectStore(STORE).getAll();
    const [records] = await Promise.all([new Promise<ReinstatementTrial[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }), finished]);
    return records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } finally { db.close(); }
}

export async function putReinstatementTrial(trial: ReinstatementTrial): Promise<void> {
  assertTrialUpdate(undefined, trial);
  if (trial.protocol && await protocolDigest(trial.protocol) !== trial.protocolSha256) throw new Error("Registered protocol digest does not match.");
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const finished = done(tx);
    const store = tx.objectStore(STORE);
    const request = store.get(trial.id);
    let validationError: Error | undefined;
    request.onsuccess = () => {
      try { assertTrialUpdate(request.result, trial); store.put(trial); }
      catch (error) { validationError = error instanceof Error ? error : new Error("Trial update rejected."); tx.abort(); }
    };
    try { await finished; } catch (error) { throw validationError || error; }
  } finally { db.close(); }
}

export async function deleteReinstatementTrial(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const finished = done(tx);
    tx.objectStore(STORE).delete(id);
    await finished;
  } finally { db.close(); }
}

export function blindedScoringPacket(trial: ReinstatementTrial, packetId: string) {
  if (!packetId.trim()) throw new Error("A separate reviewer packet ID is required.");
  // No condition, delay, session, timestamp or operator ID is exposed to the assessor.
  return { schema: "m2-scoring-packet-v1", packetId, preDreamId: trial.preDreamId || null, postDreamId: trial.postDreamId || null, scoringRule: trial.protocol?.scoringRule || "Legacy rubric unknown", instruction: "Score the supplied reports independently before condition disclosure. Report IDs alone do not contain report text." };
}

export function summarizeReinstatement(trials: ReinstatementTrial[]) {
  const groups = new Map<string, { delaySeconds: number; intentionCondition: boolean; blinded: boolean; protocolVersion: string; n: number; total: number; positive: number }>();
  for (const trial of trials.filter((row) => row.continuityScore !== null && row.state !== "EXCLUDED")) {
    const protocolVersion = trial.protocol?.version || "legacy_unverified";
    const key = [trial.delaySeconds, trial.intentionCondition, trial.blinded, protocolVersion].join(":");
    const row = groups.get(key) || { delaySeconds: trial.delaySeconds, intentionCondition: trial.intentionCondition, blinded: trial.blinded, protocolVersion, n: 0, total: 0, positive: 0 };
    row.n += 1; row.total += trial.continuityScore || 0;
    if ((trial.continuityScore || 0) >= 3) row.positive += 1;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => a.delaySeconds - b.delaySeconds || Number(a.intentionCondition) - Number(b.intentionCondition)).map((row) => ({ ...row, meanScore: row.total / row.n, continuationRate: row.positive / row.n, evidence: "descriptive_only" as const }));
}
