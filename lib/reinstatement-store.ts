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
};

const DB_NAME = "morpheus-reinstatement";
const DB_VERSION = 1;
const STORE = "trials";

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
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

export async function listReinstatementTrials(): Promise<ReinstatementTrial[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve(
        (request.result as ReinstatementTrial[]).sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
        ),
      );
    tx.oncomplete = () => db.close();
  });
}

export async function putReinstatementTrial(
  trial: ReinstatementTrial,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(trial);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });

  db.close();
}

export async function deleteReinstatementTrial(
  id: string,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });

  db.close();
}

export function summarizeReinstatement(
  trials: ReinstatementTrial[],
) {
  const completed = trials.filter(
    (trial) => trial.continuityScore !== null,
  );

  const byDelay = new Map<
    number,
    { n: number; total: number; positive: number }
  >();

  for (const trial of completed) {
    const current = byDelay.get(trial.delaySeconds) || {
      n: 0,
      total: 0,
      positive: 0,
    };
    current.n += 1;
    current.total += trial.continuityScore || 0;
    if ((trial.continuityScore || 0) >= 3) current.positive += 1;
    byDelay.set(trial.delaySeconds, current);
  }

  return Array.from(byDelay.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([delaySeconds, value]) => ({
      delaySeconds,
      n: value.n,
      meanScore: value.n ? value.total / value.n : 0,
      continuationRate: value.n ? value.positive / value.n : 0,
    }));
}
