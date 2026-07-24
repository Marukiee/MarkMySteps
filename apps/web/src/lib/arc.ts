import { geoInterpolate } from 'd3-geo';
import { airportByCode } from './airports';

/** Great-circle arc between two [lng,lat] points as a GeoJSON LineString. */
export function greatCircleArc(
  from: [number, number],
  to: [number, number],
  steps = 48,
): GeoJSON.Feature<GeoJSON.LineString> {
  const interpolate = geoInterpolate(from, to);
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    coordinates.push(interpolate(i / steps) as [number, number]);
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} };
}

/**
 * A deliberately bowed flight arc between two points — a quadratic curve that
 * bulges perpendicular to the chord, so on a flat map it clearly reads as a
 * flight (a plain geodesic looks almost straight for short hops).
 */
export function flightArc(
  from: [number, number],
  to: [number, number],
  steps = 48,
): [number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector; always bow to the same (upper) side.
  let px = -dy / len;
  let py = dx / len;
  if (py < 0) {
    px = -px;
    py = -py;
  }
  const bow = Math.min(len * 0.28, 22); // degrees, capped
  const cx = (from[0] + to[0]) / 2 + px * bow;
  const cy = (from[1] + to[1]) / 2 + py * bow;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    coords.push([
      mt * mt * from[0] + 2 * mt * t * cx + t * t * to[0],
      mt * mt * from[1] + 2 * mt * t * cy + t * t * to[1],
    ]);
  }
  return coords;
}

/** Chained bowed flight arcs through waypoints (a flight with layovers). */
export function multiArc(points: [number, number][]): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates: [number, number][] = [];
  for (let i = 1; i < points.length; i++) {
    const seg = flightArc(points[i - 1]!, points[i]!, 36);
    coordinates.push(...(i === 1 ? seg : seg.slice(1)));
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} };
}

/**
 * Splits a polyline wherever consecutive points jump more than `maxKm` apart
 * (a flight), so a tracked route isn't drawn as one straight line across the
 * ocean. Returns the sub-segments (each with ≥2 points).
 */
export function splitOnGaps(coords: [number, number][], maxKm = 500): [number, number][][] {
  const segments: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < coords.length; i++) {
    if (i > 0 && haversineKm(coords[i - 1]!, coords[i]!) > maxKm) {
      if (cur.length > 1) segments.push(cur);
      cur = [coords[i]!];
    } else {
      cur.push(coords[i]!);
    }
  }
  if (cur.length > 1) segments.push(cur);
  return segments;
}

/** Great-circle distance in km between two [lng,lat] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export type TravelMode = 'GROUND' | 'TRAIN' | 'BUS' | 'BOAT' | 'FLIGHT';

/** Ordered cycle for the leg toggle (car → train → bus → boat → flight → car). */
export const TRAVEL_MODES: TravelMode[] = ['GROUND', 'TRAIN', 'BUS', 'BOAT', 'FLIGHT'];

export const MODE_LABEL: Record<TravelMode, string> = {
  GROUND: 'Over land',
  TRAIN: 'Trein',
  BUS: 'Bus',
  BOAT: 'Boot',
  FLIGHT: 'Vlucht',
};

// Rough average speeds (km/h) + a fixed overhead (min) for terminals/check-in.
const SPEED: Record<TravelMode, { kmh: number; overhead: number }> = {
  GROUND: { kmh: 75, overhead: 0 },
  TRAIN: { kmh: 110, overhead: 15 },
  BUS: { kmh: 65, overhead: 15 },
  BOAT: { kmh: 35, overhead: 30 },
  FLIGHT: { kmh: 750, overhead: 90 },
};

/** Rough travel duration for a distance by mode, as "3u 41m". */
export function estimateDuration(km: number, mode: TravelMode): string {
  const { kmh, overhead } = SPEED[mode] ?? SPEED.GROUND;
  const totalMin = Math.round((km / kmh) * 60) + overhead;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}u ${m}m` : `${m}m`;
}

export interface LegStop {
  id: string;
  latitude: number | null;
  longitude: number | null;
  travelMode: TravelMode;
  fromAirport: string | null;
  toAirport: string | null;
  viaAirports: string[];
}

export interface Leg {
  id: string;
  isFlight: boolean;
  feature: GeoJSON.Feature<GeoJSON.LineString>;
}

/**
 * Builds the connecting legs for a stop list. Flights are great-circle arcs
 * (through any layover airports); ground legs are straight. Standalone flight
 * "stops" without a city still draw (airport → airport), and each leg chains
 * from wherever the previous one ended.
 */
export function buildLegs(stops: LegStop[]): Leg[] {
  const legs: Leg[] = [];
  let prev: [number, number] | null = null;
  for (const s of stops) {
    const dep = airportByCode(s.fromAirport);
    const arr = airportByCode(s.toAirport);
    const city: [number, number] | null =
      s.latitude !== null && s.longitude !== null ? [s.longitude, s.latitude] : null;
    const from: [number, number] | null = dep ? [dep.lon, dep.lat] : prev;
    const to: [number, number] | null = arr ? [arr.lon, arr.lat] : city;
    const isFlight = s.travelMode === 'FLIGHT';
    if (from && to) {
      const via = (s.viaAirports ?? [])
        .map((c) => airportByCode(c))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => [a.lon, a.lat] as [number, number]);
      const feature = isFlight
        ? multiArc([from, ...via, to])
        : ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [from, to] },
            properties: {},
          } as GeoJSON.Feature<GeoJSON.LineString>);
      feature.properties = { flight: isFlight };
      legs.push({ id: s.id, isFlight, feature });
    }
    prev = to ?? city ?? prev;
  }
  return legs;
}

export interface StopPoint {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  travelMode: TravelMode;
  flightNumber: string | null;
  fromAirport: string | null;
  toAirport: string | null;
  viaAirports: string[];
  orderIndex: number;
  arrivalDate: string;
  departureDate: string;
}

/** A stop with the extra planner fields (nights, notes). */
export interface PlannedStop extends StopPoint {
  nights: number;
  notes: string | null;
}
