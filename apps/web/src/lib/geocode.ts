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
    city?: string;
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
