/**
 * The little fact chips on a trip's header card.
 *
 * There is room for four, so they are picked from a fixed priority order and
 * anything without data is skipped. A trip can override the selection (see
 * Reisinstellingen); "auto" simply means "the first four that apply".
 */

export type FactId = 'km' | 'days' | 'stops' | 'photos' | 'travellers' | 'countries';

export interface FactSource {
  distanceKm: number;
  days: number;
  stops: number;
  photoCount: number;
  travellers: number;
  countries: number;
}

export interface Fact {
  id: FactId;
  value: string;
  /** Preferred label, and a shorter fallback for when four chips don't fit. */
  label: string;
  shortLabel: string;
}

/** Priority order used by "auto". */
export const FACT_ORDER: FactId[] = ['km', 'days', 'stops', 'photos', 'travellers', 'countries'];

export const FACT_NAMES: Record<FactId, string> = {
  km: 'Afstand',
  days: 'Aantal dagen',
  stops: 'Aantal stops',
  photos: "Aantal foto's",
  travellers: 'Reisgenoten',
  countries: 'Aantal landen',
};

export const MAX_FACTS = 4;

/** Builds a fact, or null when the trip has nothing to say about it. */
function build(id: FactId, src: FactSource): Fact | null {
  switch (id) {
    case 'km':
      return src.distanceKm > 0
        ? { id, value: src.distanceKm.toLocaleString('nl-NL'), label: 'km', shortLabel: 'km' }
        : null;
    case 'days':
      return src.days > 0
        ? { id, value: String(src.days), label: 'dagen', shortLabel: 'dgn' }
        : null;
    case 'stops':
      // A citytrip is one place, and "1 stops" is not a fact about it — it is
      // the trip. Two or more is a route, and worth a chip; the fourth slot
      // goes to whatever comes next in the order.
      return src.stops > 1
        ? { id, value: String(src.stops), label: 'stops', shortLabel: 'stops' }
        : null;
    case 'photos':
      return src.photoCount > 0
        ? { id, value: String(src.photoCount), label: "foto's", shortLabel: "foto's" }
        : null;
    case 'travellers':
      // You always travel with yourself, so one traveller isn't a fact.
      return src.travellers > 1
        ? { id, value: String(src.travellers), label: 'reisgenoten', shortLabel: 'reizigers' }
        : null;
    case 'countries':
      return src.countries > 0
        ? {
            id,
            value: String(src.countries),
            label: src.countries === 1 ? 'land' : 'landen',
            shortLabel: src.countries === 1 ? 'land' : 'landen',
          }
        : null;
  }
}

/**
 * Resolves the chips to show. `chosen` is the trip's own selection (in its own
 * order); anything it can't fill is topped up from the priority order.
 */
export function resolveFacts(src: FactSource, chosen: FactId[] | null): Fact[] {
  const wanted = chosen && chosen.length > 0 ? chosen : FACT_ORDER;
  const out: Fact[] = [];
  for (const id of wanted) {
    const fact = build(id, src);
    if (fact) out.push(fact);
    if (out.length === MAX_FACTS) return out;
  }
  // A custom selection with unavailable entries falls back to the default order.
  for (const id of FACT_ORDER) {
    if (out.some((f) => f.id === id)) continue;
    const fact = build(id, src);
    if (fact) out.push(fact);
    if (out.length === MAX_FACTS) break;
  }
  return out;
}
