import type { DreamRecord } from "@/lib/morpheus";

const DB_NAME = "morpheus-local";
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
    request.onerror = () => reject(request.error);
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listDreamRecords(): Promise<DreamRecord[]> {
  if (typeof indexedDB === "undefined") return legacyRecords();

  try {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const records = await requestValue(store.getAll() as IDBRequest<DreamRecord[]>);
    db.close();

    if (!records.length) {
      const legacy = legacyRecords();
      if (legacy.length) {
        await Promise.all(legacy.map((record) => putDreamRecord(record)));
        try {
          localStorage.removeItem(LEGACY_KEY);
        } catch {}
        return legacy.sort((a, b) => b.captured_at.localeCompare(a.captured_at));
      }
    }

    return records.sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  } catch {
    return legacyRecords();
  }
}

export async function putDreamRecord(record: DreamRecord) {
  if (typeof indexedDB === "undefined") {
    const next = [record, ...legacyRecords().filter((item) => item.dream_id !== record.dream_id)];
    localStorage.setItem(LEGACY_KEY, JSON.stringify(next));
    return;
  }

  const db = await openDb();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).put(record);
  await transactionDone(transaction);
  db.close();
}

export async function deleteDreamRecord(dreamId: string) {
  if (typeof indexedDB === "undefined") {
    const next = legacyRecords().filter((item) => item.dream_id !== dreamId);
    localStorage.setItem(LEGACY_KEY, JSON.stringify(next));
    return;
  }

  const db = await openDb();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(dreamId);
  await transactionDone(transaction);
  db.close();
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function legacyRecords(): DreamRecord[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? (JSON.parse(raw) as DreamRecord[]) : [];
  } catch {
    return [];
  }
}
