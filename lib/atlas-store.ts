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
};

const DB_NAME = "morpheus-individual-atlas";
const DB_VERSION = 1;
const STORE = "snapshots";

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
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
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const request = subjectId
      ? store.index("subjectId").getAll(subjectId)
      : store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      resolve(
        (request.result as AtlasSnapshot[]).sort(
          (a, b) =>
            Date.parse(a.capturedAt) - Date.parse(b.capturedAt),
        ),
      );
    };
    transaction.oncomplete = () => db.close();
  });
}

export async function putAtlasSnapshot(
  snapshot: AtlasSnapshot,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(snapshot);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });

  db.close();
}

export async function deleteAtlasSnapshot(
  id: string,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });

  db.close();
}
