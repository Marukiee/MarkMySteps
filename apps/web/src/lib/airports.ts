/**
 * Every airport with scheduled flights and an IATA code, about four thousand,
 * bundled so it works offline and needs no key. The list comes from
 * OurAirports and is made by scripts/build-airports.mjs.
 */

import { AIRPORT_DATA } from './airportData';

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  /** L, M or S: a hub, a regional airport, or an airstrip with a few flights. */
  size: 'L' | 'M' | 'S';
}

/** Lower case without accents, so "zurich" finds Zürich. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export const AIRPORTS: Airport[] = [];
/** Per airport, folded: its city, its name, and everything a search may match. */
const CITY: string[] = [];
const NAME: string[] = [];
const ALL: string[] = [];

for (const line of AIRPORT_DATA.split('\n')) {
  const [iata, name, city, country, lat, lon, size, words] = line.split('|') as [
    string, string, string, string, string, string, Airport['size'], string,
  ];
  AIRPORTS.push({ iata, name, city, country, lat: Number(lat), lon: Number(lon), size });
  CITY.push(fold(city));
  NAME.push(fold(name));
  ALL.push(fold(`${iata} ${city} ${name} ${words}`));
}

const BY_IATA = new Map(AIRPORTS.map((a) => [a.iata, a]));

export function airportByCode(code?: string | null): Airport | undefined {
  return code ? BY_IATA.get(code.toUpperCase()) : undefined;
}

/**
 * The airport for a known city, within ~250 km: used to fill in a flight leg's
 * airport by itself. A hub counts as closer than it is, so a city with a big
 * airport and an airstrip nearby gets the big one. Undefined if nothing is near.
 */
const DETOUR: Record<Airport['size'], number> = { L: 1, M: 3, S: 6 };

export function nearestAirport(lng: number, lat: number): Airport | undefined {
  let best: Airport | undefined;
  let bestScore = Infinity;
  for (const a of AIRPORTS) {
    // Rough equirectangular distance in km (fine at this scale).
    const x = (a.lon - lng) * Math.cos((lat * Math.PI) / 180);
    const km = Math.hypot(x, a.lat - lat) * 111;
    if (km > 250) continue;
    const score = km * DETOUR[a.size];
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** How well one airport fits what was typed; 0 is not at all. */
function matchScore(i: number, q: string): number {
  const a = AIRPORTS[i]!;
  let score = 0;
  if (a.iata.toLowerCase() === q) score = 100;
  else if (CITY[i] === q) score = 80;
  else if (CITY[i]!.startsWith(q)) score = 60;
  else if (NAME[i]!.startsWith(q)) score = 50;
  else if (ALL[i]!.includes(` ${q}`)) score = 40;
  else if (ALL[i]!.includes(q)) score = 20;
  else return 0;
  return score + (a.size === 'L' ? 6 : a.size === 'M' ? 3 : 0);
}

/** Airports for what was typed: code, city, name or another name it goes by. */
export function searchAirports(query: string, limit = 6): Airport[] {
  const q = fold(query.trim());
  if (!q) return [];
  const hits: { i: number; score: number }[] = [];
  for (let i = 0; i < AIRPORTS.length; i++) {
    const score = matchScore(i, q);
    if (score > 0) hits.push({ i, score });
  }
  // Equal scores keep the list's own order: the hubs come first there.
  return hits
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .slice(0, limit)
    .map((hit) => AIRPORTS[hit.i]!);
}
