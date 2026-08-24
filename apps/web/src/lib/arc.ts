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
 * A flight, drawn the way it looks from above.
 *
 * Two things make an arc read as a flight rather than as a bent line. The path
 * itself is a great circle — the route a plane actually takes, which on a flat
 * map bends towards the pole — and on top of that it is bowed away from the
 * ground, highest in the middle, the way the globe lifts its arcs off the
 * sphere. The bow is applied in Mercator space, so it is the same height on
 * screen wherever the flight is, and it grows with the distance: a hop across
 * the Alps barely leaves the ground, Amsterdam to Tokyo climbs.
 */
export function flightArc(
  from: [number, number],
  to: [number, number],
  steps = 48,
  /** 1 = the arc itself, 0 = the track it flies over (its shadow). */
  lift = 1,
): [number, number][] {
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const lon1 = from[0] * RAD;
  const lat1 = from[1] * RAD;
  const lon2 = to[0] * RAD;
  const lat2 = to[1] * RAD;

  // Angular distance between the two ends, along the sphere.
  const d =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
        ),
      ),
    );
  if (d < 1e-9) return [from, to];

  // The great circle itself, as a slerp between the two points on the sphere.
  const base: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.sin((1 - t) * d) / Math.sin(d);
    const b = Math.sin(t * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    base.push([Math.atan2(y, x) * DEG, Math.atan2(z, Math.hypot(x, y)) * DEG]);
  }
  // Unwrapped, or a flight over the Pacific is drawn back across the whole map.
  for (let i = 1; i < base.length; i++) {
    while (base[i]![0] - base[i - 1]![0] > 180) base[i]![0] -= 360;
    while (base[i]![0] - base[i - 1]![0] < -180) base[i]![0] += 360;
  }

  // Mercator, so the bow is a constant height on screen rather than shrinking
  // towards the equator.
  const mercY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2)) * DEG;
  const unmercY = (y: number) => (2 * Math.atan(Math.exp(y * RAD)) - Math.PI / 2) * DEG;

  const ax = base[0]![0];
  const ay = mercY(base[0]![1]);
  const bx = base[steps]![0];
  const by = mercY(base[steps]![1]);
  const chord = Math.hypot(bx - ax, by - ay) || 1;
  // Perpendicular to the chord, always the northward one so two flights along
  // the same corridor never bow into each other.
  let nx = -(by - ay) / chord;
  let ny = (bx - ax) / chord;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  // The same shape the globe uses: a little for a short hop, more for a long
  // one, and never so much that the arc becomes a balloon.
  const bow = lift * chord * (0.06 + 0.16 * Math.min(1, (d * DEG) / 70));

  return base.map(([lng, lat], i) => {
    const k = bow * Math.sin((Math.PI * i) / steps);
    return [lng + nx * k, unmercY(mercY(lat) + ny * k)] as [number, number];
  });
}

/** Chained bowed flight arcs through waypoints (a flight with layovers). */
export function multiArc(
  points: [number, number][],
  lift = 1,
): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates: [number, number][] = [];
  for (let i = 1; i < points.length; i++) {
    const seg = flightArc(points[i - 1]!, points[i]!, 36, lift);
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

/**
 * Drops small leading/trailing clusters that sit far (a big jump) from the
 * trip's main body — e.g. a couple of photos taken at home before leaving, or
 * back home after — so the route never draws a long line from home to the first
 * real destination. A dense GPS track has no such jump, so it's left untouched;
 * only sparse photo-derived lines with a stray home snap get trimmed. A real
 * destination has many photos, so only *small* end clusters are removed.
 */
export function trimOutlierEnds(
  coords: [number, number][],
  { jumpKm = 250, maxClusterPts = 3 }: { jumpKm?: number; maxClusterPts?: number } = {},
): [number, number][] {
  if (coords.length < 3) return coords;
  const clusters: [number, number][][] = [];
  let cur: [number, number][] = [coords[0]!];
  for (let i = 1; i < coords.length; i++) {
    if (haversineKm(coords[i - 1]!, coords[i]!) > jumpKm) {
      clusters.push(cur);
      cur = [coords[i]!];
    } else {
      cur.push(coords[i]!);
    }
  }
  clusters.push(cur);
  if (clusters.length < 2) return coords;
  while (clusters.length > 1 && clusters[0]!.length <= maxClusterPts) clusters.shift();
  while (clusters.length > 1 && clusters[clusters.length - 1]!.length <= maxClusterPts) {
    clusters.pop();
  }
  return clusters.flat();
}

/**
 * How close a photo has to have been taken to count as a photo OF a place.
 *
 * Wide enough to cover a city and a day of walking around it, narrow enough
 * that the next town along the road is somewhere else. Used wherever a photo
 * has to be matched to the stop it belongs to: the tiles above the timeline,
 * and the "make this the stop's face" action in the viewer.
 */
export const STOP_NEAR_KM = 30;

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
  GROUND: 'Auto',
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
  /** Day trips hang off a stop; they are never a leg of the route. */
  parentStopId?: string | null;
  /** Draw no line from the previous stop to this one. */
  hideLeg?: boolean;
}

export interface Leg {
  id: string;
  isFlight: boolean;
  /**
   * The ground each hop of a flight passes over: the great circle with no bow,
   * one entry per hop.
   *
   * Per hop, not per flight: Amsterdam → Keflavík → New York bows twice, once
   * over each leg, and a single arc across the whole itinerary sails past the
   * airport it is supposed to touch down at.
   */
  hops?: [number, number][][];
  feature: GeoJSON.Feature<GeoJSON.LineString>;
}

/**
 * Builds the connecting legs for a stop list. Flights are great-circle arcs
 * (through any layover airports); ground legs are straight. Standalone flight
 * "stops" without a city still draw (airport → airport), and each leg chains
 * from wherever the previous one ended.
 */
export function buildLegs(all: LegStop[]): Leg[] {
  const legs: Leg[] = [];
  let prev: [number, number] | null = null;
  // A day trip is an excursion from a stop, not a leg between two stops — it
  // would otherwise insert a detour into the through-route.
  const stops = all.filter((s) => !s.parentStopId);
  for (const s of stops) {
    const dep = airportByCode(s.fromAirport);
    const arr = airportByCode(s.toAirport);
    const city: [number, number] | null =
      s.latitude !== null && s.longitude !== null ? [s.longitude, s.latitude] : null;
    const from: [number, number] | null = dep ? [dep.lon, dep.lat] : prev;
    const to: [number, number] | null = arr ? [arr.lon, arr.lat] : city;
    const isFlight = s.travelMode === 'FLIGHT';
    // Hidden by hand: the stop stays on the route (prev moves on with it), the
    // line to it is simply never built.
    if (from && to && !s.hideLeg) {
      const via = (s.viaAirports ?? [])
        .map((c) => airportByCode(c))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => [a.lon, a.lat] as [number, number]);
      const hops = isFlight
        ? [from, ...via, to].slice(1).map((end, i) => {
            const start = [from, ...via, to][i]!;
            return flightArc(start, end, 36, 0);
          })
        : undefined;
      const feature = isFlight
        ? multiArc([from, ...via, to])
        : ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [from, to] },
            properties: {},
          } as GeoJSON.Feature<GeoJSON.LineString>);
      feature.properties = { flight: isFlight };
      legs.push({ id: s.id, isFlight, feature, hops });
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
  /** Set when this stop is a day trip made FROM that stop and back the same
   *  day. Day trips are not part of the route and consume no nights. */
  parentStopId?: string | null;
  /** The single day a day trip took place (yyyy-mm-dd). */
  dayTripDate?: string | null;
  /** Draw no line from the previous stop to this one. */
  hideLeg?: boolean;
  /** The photo that fronts this stop's tile in the timeline rail. */
  coverMediaId?: string | null;
}

/** A stop with the extra planner fields (nights, notes). */
export interface PlannedStop extends StopPoint {
  nights: number;
  notes: string | null;
}

/**
 * How many places a plan covers, for the "aantal stops" chip.
 *
 * Route stops always count, even a city you sleep in twice. Day trips only
 * count the first time: going into Stockholm three times from Saltsjöbaden is
 * one place you visited, not three stops. Mirrors countStopPlaces on the API.
 */
export function countStopPlaces(
  stops: { latitude: number | null; longitude: number | null; parentStopId?: string | null }[],
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const stop of stops) {
    if (stop.latitude === null || stop.longitude === null) continue;
    const key = `${stop.latitude.toFixed(3)},${stop.longitude.toFixed(3)}`;
    if (stop.parentStopId && seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

/**
 * Splits a polyline only where a segment actually spans a planned flight (its
 * endpoints line up with a flight leg's from/to), never by raw distance. This
 * keeps long ground legs (e.g. Madrid→Barcelona) connected while removing the
 * straight line a flight would otherwise draw — the flight arc bridges it.
 */
export function splitAtFlights(
  coords: [number, number][],
  flights: { from: [number, number]; to: [number, number] }[],
): [number, number][][] {
  if (coords.length < 2) return coords.length ? [coords] : [];
  if (flights.length === 0) return [coords];
  const near = (a: [number, number], b: [number, number]) => haversineKm(a, b) <= 250;
  const spansFlight = (a: [number, number], b: [number, number]) =>
    flights.some(
      (f) => (near(a, f.from) && near(b, f.to)) || (near(a, f.to) && near(b, f.from)),
    );
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [coords[0]!];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    if (spansFlight(a, b)) {
      if (cur.length >= 2) segs.push(cur);
      cur = [b];
    } else {
      cur.push(b);
    }
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}
