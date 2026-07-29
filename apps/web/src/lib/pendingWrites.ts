import { api } from '../api/client';

/**
 * Write-behind queue for edits made without a connection.
 *
 * Reads already fall back to the offline cache; this is the other half, so
 * planning a trip on a plane or in a tunnel works the same as anywhere else.
 * Requests are replayed in the order they were made — the planner's operations
 * depend on each other (a stop has to exist before it can be reordered), so
 * they may never be parallelised or reordered.
 *
 * Anything the client creates while offline carries an id it chose itself, so
 * a later edit of that same thing refers to an id the server will agree with
 * once the create lands. No id remapping, no bookkeeping.
 */

const KEY = 'mms.pending';

export interface PendingWrite {
  id: string;
  path: string;
  method: string;
  body?: unknown;
  at: number;
  /** Human-readable, for the "waiting to sync" hint. */
  label?: string;
}

type Listener = (writes: PendingWrite[]) => void;
let listeners: Listener[] = [];

function read(): PendingWrite[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as PendingWrite[];
  } catch {
    return [];
  }
}

function write(list: PendingWrite[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full — nothing useful to do here */
  }
  for (const listener of listeners) listener(list);
}

export function pendingWrites(): PendingWrite[] {
  return read();
}

export function onPendingChange(listener: Listener): () => void {
  listeners.push(listener);
  listener(read());
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function enqueueWrite(entry: Omit<PendingWrite, 'id' | 'at'>): void {
  write([...read(), { ...entry, id: crypto.randomUUID(), at: Date.now() }]);
}

let flushing = false;

/**
 * Replays the queue oldest first. A request that the server rejects outright
 * (a stop that no longer exists, a value it won't accept) is dropped — retrying
 * it forever would block everything behind it. A network failure stops the run
 * and leaves the rest queued for the next attempt.
 */
export async function flushPendingWrites(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    let queue = read();
    while (queue.length > 0) {
      const next = queue[0]!;
      try {
        await api(next.path, { method: next.method, body: next.body });
      } catch (err) {
        // ApiError means the server answered; anything else is the network.
        const answered = typeof (err as { status?: number }).status === 'number';
        if (!answered) return;
      }
      queue = read().filter((w) => w.id !== next.id);
      write(queue);
    }
  } finally {
    flushing = false;
  }
}

/** Replays whatever is queued as soon as there is a connection again. */
export function initPendingWrites(): void {
  void flushPendingWrites();
  window.addEventListener('online', () => void flushPendingWrites());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushPendingWrites();
  });
}
