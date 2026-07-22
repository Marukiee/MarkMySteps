/**
 * Offline point buffer on IndexedDB. GPS fixes land here first; a flusher
 * uploads them in batches whenever the network allows and removes them
 * after the server confirms. Survives app restarts and days offline.
 */

export interface BufferedPoint {
  clientId: string;
  tripId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
}

const DB_NAME = 'markmysteps';
const STORE = 'points';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'clientId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error as Error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error as Error);
      }),
  );
}

export function bufferPoint(point: BufferedPoint): Promise<IDBValidKey> {
  return tx('readwrite', (store) => store.put(point));
}

export function peekPoints(limit = 500): Promise<BufferedPoint[]> {
  return tx('readonly', (store) => store.getAll(undefined, limit) as IDBRequest<BufferedPoint[]>);
}

export function bufferedCount(): Promise<number> {
  return tx('readonly', (store) => store.count());
}

export async function removePoints(clientIds: string[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const id of clientIds) store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error as Error);
  });
}
