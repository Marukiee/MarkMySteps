/**
 * The device's own store, for running without a server.
 *
 * IndexedDB rather than a SQLite plugin: nothing the app asks of its data needs
 * SQL, the heavy geometry work already lives in plain functions, and staying on
 * a web API keeps the browser build working too.
 *
 * Every record carries the id the client chose. That is what makes "add a
 * server later" a plain upload of what is already here rather than a migration
 * with id translation.
 */

const DB_NAME = 'mms-local';
const DB_VERSION = 2;

export type StoreName = 'trips' | 'stops' | 'points' | 'notes' | 'media' | 'meta' | 'thumbs';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('trips')) {
        db.createObjectStore('trips', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('stops')) {
        db.createObjectStore('stops', { keyPath: 'id' }).createIndex('tripId', 'tripId');
      }
      if (!db.objectStoreNames.contains('points')) {
        db.createObjectStore('points', { keyPath: 'id' }).createIndex('tripId', 'tripId');
      }
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('tripId', 'tripId');
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' }).createIndex('tripId', 'tripId');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
      // Bookkeeping for the thumbnail cache: what is in it, how big it is and
      // when it was last looked at. Cache Storage itself cannot answer any of
      // those, so the budget has to be tracked alongside it.
      if (!db.objectStoreNames.contains('thumbs')) {
        db.createObjectStore('thumbs', { keyPath: 'path' }).createIndex('at', 'at');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
  return dbPromise;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  body: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = body(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function dbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(key));
}

export function dbPut<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
  return run<void>(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
}

export function dbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  return run<void>(store, 'readwrite', (s) => s.delete(key));
}

export function dbAll<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll());
}

/** Everything in `store` belonging to one trip. */
export function dbByTrip<T>(store: StoreName, tripId: string): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.index('tripId').getAll(tripId));
}

/** Writes several records of one store in a single transaction. */
export function dbPutMany<T>(store: StoreName, values: T[]): Promise<void> {
  if (values.length === 0) return Promise.resolve();
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        for (const value of values) objectStore.put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function dbDeleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        for (const key of keys) objectStore.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}
