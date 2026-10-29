import { Injectable, Logger } from '@nestjs/common';

/** A town or city, as the stop field offers it. */
export interface PlaceHit {
  name: string;
  region: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
}

interface NominatimRow {
  name?: string;
  lat: string;
  lon: string;
  importance?: number;
  address?: { state?: string; country?: string; country_code?: string };
}

/** At most this often, as the public Nominatim asks of every application. */
const GAP_MS = 1100;
const CACHE_SIZE = 500;

/**
 * Places by a name the app's own search does not know them by.
 *
 * The stop field asks Photon, which only knows what a place is called today:
 * "Stalingrad" found a hamlet of that name in Czechia, and a friend's stop
 * ended up there instead of in Russia. Nominatim reads old and other names
 * too and answers Volgograd. It is only asked when Photon had no town by that
 * name at all, from here rather than from every phone, so it can be asked
 * politely: one question a second, each answer kept.
 */
@Injectable()
export class PlaceLookupService {
  private readonly log = new Logger(PlaceLookupService.name);
  private readonly cache = new Map<string, PlaceHit[]>();
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  async search(query: string): Promise<PlaceHit[]> {
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (q.length < 3) return [];
    const key = q.toLowerCase();
    const known = this.cache.get(key);
    if (known) return known;

    const job = this.queue.then(async () => {
      const wait = this.last + GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.last = Date.now();
      return this.ask(q);
    });
    // One failing question must not stop the ones queued behind it.
    this.queue = job.catch(() => undefined);
    const hits = await job.catch((err: unknown) => {
      this.log.warn(`Nominatim did not answer for "${q}": ${String(err)}`);
      return null;
    });
    if (hits === null) return [];
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, hits);
    return hits;
  }

  private async ask(q: string): Promise<PlaceHit[]> {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    // Towns and cities, not the bus stop or the street named after one.
    url.searchParams.set('featureType', 'settlement');
    url.searchParams.set('accept-language', 'en');
    url.searchParams.set('limit', '3');
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarkMySteps (self-hosted travel journal; github.com/Marukiee/MarkMySteps)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const rows = (await res.json()) as NominatimRow[];
    return rows
      .filter((row) => row.name && (row.importance ?? 0) >= 0.3)
      .map((row) => ({
        name: row.name!,
        region: [row.address?.state, row.address?.country].filter(Boolean).join(', '),
        countryCode: row.address?.country_code?.toUpperCase(),
        latitude: Number(row.lat),
        longitude: Number(row.lon),
      }));
  }
}
