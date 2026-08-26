/**
 * Place search via Photon (photon.komoot.io) — open-source, OSM-based
 * geocoder, no API key, no Google. Used for the stop-name autocomplete;
 * a self-hosted Photon instance can be dropped in later via the same API.
 */

export interface PlaceSuggestion {
  name: string;
  region: string; // e.g. "Vietnam" or "Noord-Holland, Nederland"
  countryCode?: string;
  latitude: number;
  longitude: number;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    country?: string;
    countrycode?: string;
    state?: string;
    county?: string;
    city?: string;
    district?: string;
    locality?: string;
    type?: string;
  };
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  if (query.trim().length < 2) return [];
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '6');
  // 'default' returns every language variant glued together
  // ("Marrakech ⵎⵔⴰⴽⵛ مراكش"); 'en' gives clean single names.
  url.searchParams.set('lang', 'en');
  // Bias towards cities/towns — that's what trip stops usually are.
  url.searchParams.append('osm_tag', 'place');

  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { features: PhotonFeature[] };

  const seen = new Set<string>();
  const suggestions: PlaceSuggestion[] = [];
  for (const feature of data.features) {
    const p = feature.properties;
    if (!p.name) continue;
    const region = [p.state, p.country].filter(Boolean).join(', ');
    const key = `${p.name}|${region}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      name: p.name,
      region,
      countryCode: p.countrycode?.toUpperCase(),
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
    });
  }
  return suggestions;
}

export interface StationSuggestion extends PlaceSuggestion {
  /** A city's main station, as far as its name gives it away. */
  main: boolean;
}

/**
 * What a city calls its main station, in the languages a European trip runs
 * through. Nothing clever: OSM has no tag that says "this is the big one", and
 * the name is what a traveller reads off the ticket anyway.
 */
const MAIN_STATION_WORDS = [
  'centraal',
  'central',
  'centrale',
  'hauptbahnhof',
  'hbf',
  'hovedbanegård',
  'hlavní nádraží',
  'termini',
  'kolodvor',
  'główny',
  'principal',
];

/**
 * Railway stations by name, for drawing a train ride.
 *
 * The same geocoder, asked a narrower question: only things OSM tags as a
 * station or a halt, so "Barcelona" offers Sants and França rather than the
 * city itself. The city would put the drawn rails a few kilometres off the
 * platform they actually left from.
 *
 * Main stations come first and say so, because that is the one somebody means
 * nine times out of ten and reading eight names to find it is work.
 */
export async function searchStations(
  query: string,
  signal?: AbortSignal,
): Promise<StationSuggestion[]> {
  if (query.trim().length < 2) return [];
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '8');
  url.searchParams.set('lang', 'en');
  url.searchParams.append('osm_tag', 'railway:station');
  url.searchParams.append('osm_tag', 'railway:halt');

  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { features: PhotonFeature[] };

  const seen = new Set<string>();
  const suggestions: StationSuggestion[] = [];
  for (const feature of data.features) {
    const p = feature.properties;
    if (!p.name) continue;
    // Where a station sits says more than which province it is in: two
    // "Centraal"s are told apart by their city, not by their country.
    const region = [p.city ?? p.county, p.country].filter(Boolean).join(', ');
    const key = `${p.name}|${region}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lower = p.name.toLowerCase();
    suggestions.push({
      name: p.name,
      region,
      countryCode: p.countrycode?.toUpperCase(),
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
      main: MAIN_STATION_WORDS.some((w) => lower.includes(w)),
    });
  }
  // Photon's own order is kept within each group, so the most likely station
  // stays first among equals.
  return suggestions.sort((a, b) => Number(b.main) - Number(a.main));
}

/**
 * Cached reverse lookups, so paging through a photo album doesn't hammer the
 * geocoder with the same coordinates. Keyed to ~1 km.
 *
 * Only real answers go in here, including a real "there is nothing there".
 * A lookup that failed — no connection, a geocoder that was busy — is not an
 * answer about the place, and caching it meant one bad moment left the line
 * blank for the rest of the session.
 */
const reverseCache = new Map<string, string | null>();

/** A geocoder that never replies must not hold the line blank forever. */
const REVERSE_TIMEOUT_MS = 6000;

async function photonReverse(lat: number, lon: number, settlements: boolean) {
  const url = new URL('https://photon.komoot.io/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('limit', '1');
  url.searchParams.set('lang', 'en');
  if (settlements) {
    // The nearest town, rather than whatever OSM object happens to be closest.
    url.searchParams.append('osm_tag', 'place');
    url.searchParams.set('radius', '30');
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REVERSE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { features: PhotonFeature[] };
    return data.features[0]?.properties ?? null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * "Stad, Land" for a coordinate, or null when nothing sensible comes back.
 * Same keyless Photon instance as the search.
 *
 * The nearest settlement is asked for first. A photo placed from the trip's own
 * tracked route can sit anywhere the route went — a motorway, a field, a ferry
 * — and a plain reverse lookup there answers with the closest unnamed thing,
 * or with nothing at all, which is why those photos showed a coordinate on the
 * map and no place name above them.
 */
export async function reversePlaceName(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = reverseCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const p = (await photonReverse(lat, lon, true)) ?? (await photonReverse(lat, lon, false));
    // Whatever the smallest named thing around here is called. A district or a
    // county is a poor city, but it beats a blank line.
    const city = p?.city ?? p?.district ?? p?.locality ?? p?.name ?? p?.county ?? p?.state ?? null;
    const name = [city, p?.country].filter(Boolean).join(', ') || null;
    reverseCache.set(key, name);
    return name;
  } catch {
    // Not remembered: ask again next time rather than deciding this place has
    // no name because the network had a bad second.
    return null;
  }
}
