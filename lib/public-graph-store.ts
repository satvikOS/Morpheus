import type { KnowledgeRecord } from "@/components/workstation/public-data-graph";

const DB_NAME = "morpheus-public-graph";
const DB_VERSION = 1;
const STORE = "records";
const MAX_RECORDS = 1200;

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "graphKey",
        });
        store.createIndex("firstSeenAt", "firstSeenAt");
      }
    };
  });
}

export async function listKnowledgeRecords(): Promise<KnowledgeRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const records = (request.result as KnowledgeRecord[])
        .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
        .slice(-MAX_RECORDS);
      resolve(records);
    };
    transaction.oncomplete = () => db.close();
  });
}

export async function upsertKnowledgeRecords(
  records: KnowledgeRecord[],
): Promise<void> {
  if (typeof indexedDB === "undefined" || !records.length) return;
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);

    for (const record of records) store.put(record);

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });

  const all = await new Promise<KnowledgeRecord[]>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as KnowledgeRecord[]);
  });

  if (all.length > MAX_RECORDS) {
    const excess = all
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
      .slice(0, all.length - MAX_RECORDS);

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const record of excess) store.delete(record.graphKey);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
    });
  }

  db.close();
}
