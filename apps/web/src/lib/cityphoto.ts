/** City thumbnails via the Wikipedia REST summary: keyless, CORS-enabled. */

const cache = new Map<string, Promise<string[]>>();

async function summaryImages(lang: string, title: string): Promise<string[]> {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
    };
    return [data.thumbnail?.source, data.originalimage?.source].filter(
      (s): s is string => !!s,
    );
  } catch {
    return [];
  }
}

/**
 * Every photo that could stand for a place, best first: the English and Dutch
 * articles' thumbnails and originals, also for the name without its region
 * ("Porto, Portugal" as "Porto"). The caller uses the first one that actually
 * loads, so one broken image never leaves an empty or flickering square.
 */
export function cityPhotoCandidates(name: string): Promise<string[]> {
  const key = name.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const short = name.split(',')[0]!.trim();
  const titles = short && short !== name.trim() ? [name.trim(), short] : [name.trim()];
  const found = Promise.all(
    titles.flatMap((title) => [summaryImages('en', title), summaryImages('nl', title)]),
  ).then((lists) => Array.from(new Set(lists.flat())));
  cache.set(key, found);
  return found;
}

/** The first candidate, for callers that only want one. */
export async function cityPhoto(name: string): Promise<string | null> {
  return (await cityPhotoCandidates(name))[0] ?? null;
}
