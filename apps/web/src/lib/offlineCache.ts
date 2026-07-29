/**
 * Offline read cache. Every trip you open (its data + photo thumbnails) is
 * stored via the Cache Storage API, so with no connection you can still browse
 * the trips you've already viewed. Writes still need the network.
 */

import { dbAll, dbDeleteMany, dbGet, dbPut } from './localDb';
import { getThumbCacheLimitMb } from './prefs';

const DATA_CACHE = 'mms-data-v1';
export const THUMB_CACHE = 'mms-thumb-v1';

// Cache keys must be absolute URLs; use a synthetic, stable origin.
const KEY_BASE = 'https://mms.cache';

function keyFor(path: string): string {
  return `${KEY_BASE}${path}`;
}

export async function cachePutJson(path: string, data: unknown): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put(
      keyFor(path),
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  } catch {
    /* storage full / unavailable — cache is best-effort */
  }
}

export async function cacheGetJson<T>(path: string): Promise<T | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(DATA_CACHE);
    const res = await cache.match(keyFor(path));
    return res ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function thumbCachePut(path: string, res: Response): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(THUMB_CACHE);
    // Measure before storing: Cache Storage cannot be asked how big an entry
    // is afterwards, and without that there is no budget to keep.
    const copy = res.clone();
    await cache.put(keyFor(path), res);
    const size = (await copy.blob()).size;
    await noteThumb(path, size);
  } catch {
    /* best-effort */
  }
}

export async function thumbCacheMatch(path: string): Promise<Response | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(THUMB_CACHE);
    const hit = (await cache.match(keyFor(path))) ?? null;
    // Touch it, so the least recently LOOKED AT entries are the ones evicted —
    // not the oldest ones, which may be the trip you keep coming back to.
    if (hit) void touchThumb(path);
    return hit;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------
   Budget

   Every thumbnail that has ever been on screen used to stay forever, which on
   a photo-heavy account is hundreds of megabytes nobody asked for. The cache
   now has a ceiling, and the least recently used entries make room.
   ------------------------------------------------------------------------- */

interface ThumbEntry {
  path: string;
  size: number;
  /** Last time it was stored or read. */
  at: number;
}

const USAGE_KEY = 'thumbUsage';
/** Evicting down to exactly the limit would evict again on the next photo. */
const EVICT_TO = 0.85;

let evicting = false;

async function noteThumb(path: string, size: number): Promise<void> {
  const previous = await dbGet<ThumbEntry>('thumbs', path);
  await dbPut<ThumbEntry>('thumbs', { path, size, at: Date.now() });
  await addUsage(size - (previous?.size ?? 0));
  void enforceThumbBudget();
}

async function touchThumb(path: string): Promise<void> {
  const entry = await dbGet<ThumbEntry>('thumbs', path);
  if (!entry) return;
  // Only worth a write once an hour; a scrolling timeline would otherwise
  // rewrite every row it passes.
  if (Date.now() - entry.at < 3_600_000) return;
  await dbPut<ThumbEntry>('thumbs', { ...entry, at: Date.now() });
}

async function addUsage(delta: number): Promise<void> {
  const current = (await dbGet<number>('meta', USAGE_KEY)) ?? 0;
  await dbPut('meta', Math.max(0, current + delta), USAGE_KEY);
}

/** Bytes the thumbnail cache is currently holding. */
export async function thumbCacheUsage(): Promise<number> {
  return (await dbGet<number>('meta', USAGE_KEY)) ?? 0;
}

/** Drops the least recently used thumbnails until the cache is under budget. */
export async function enforceThumbBudget(): Promise<void> {
  if (evicting) return;
  const limit = getThumbCacheLimitMb() * 1024 * 1024;
  if (limit <= 0) return; // "unlimited"
  const usage = await thumbCacheUsage();
  if (usage <= limit) return;

  evicting = true;
  try {
    const entries = (await dbAll<ThumbEntry>('thumbs')).sort((a, b) => a.at - b.at);
    const cache = await caches.open(THUMB_CACHE);
    let left = usage;
    const target = limit * EVICT_TO;
    const dropped: string[] = [];
    for (const entry of entries) {
      if (left <= target) break;
      await cache.delete(keyFor(entry.path));
      dropped.push(entry.path);
      left -= entry.size;
    }
    await dbDeleteMany('thumbs', dropped);
    await dbPut('meta', Math.max(0, left), USAGE_KEY);
  } catch {
    /* best-effort */
  } finally {
    evicting = false;
  }
}

/** Throws the whole thumbnail cache away. */
export async function clearThumbCache(): Promise<void> {
  try {
    await caches.delete(THUMB_CACHE);
    const entries = await dbAll<ThumbEntry>('thumbs');
    await dbDeleteMany('thumbs', entries.map((e) => e.path));
    await dbPut('meta', 0, USAGE_KEY);
  } catch {
    /* best-effort */
  }
}
