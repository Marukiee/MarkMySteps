/** City thumbnail via Wikipedia REST summary — keyless, CORS-enabled. */

const cache = new Map<string, string | null>();

export async function cityPhoto(name: string): Promise<string | null> {
  const key = name.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data = (await res.json()) as { thumbnail?: { source?: string } };
    const src = data.thumbnail?.source ?? null;
    cache.set(key, src);
    return src;
  } catch {
    cache.set(key, null);
    return null;
  }
}
