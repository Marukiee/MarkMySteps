/**
 * Offline read cache. Every trip you open (its data + photo thumbnails) is
 * stored via the Cache Storage API, so with no connection you can still browse
 * the trips you've already viewed. Writes still need the network.
 */

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
    await cache.put(keyFor(path), res);
  } catch {
    /* best-effort */
  }
}

export async function thumbCacheMatch(path: string): Promise<Response | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(THUMB_CACHE);
    return (await cache.match(keyFor(path))) ?? null;
  } catch {
    return null;
  }
}
