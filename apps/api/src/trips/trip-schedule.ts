import { airportCoord } from '../common/airports';

/**
 * When a trip's plan has you where, worked out from the stops alone.
 *
 * Stops carry no dates: a stop is reached on the trip's first day plus the
 * nights of every stop before it. That is enough to say on which day a flight
 * was taken or a day trip made, and so which of them fall inside the part of a
 * trip somebody was actually there for.
 */

/** The way out from home and back: legs of the route, not places visited. */
export const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

/** Everything the plan needs to know about a stop, for a Prisma select. */
export const PLAN_STOP_SELECT = {
  id: true,
  name: true,
  orderIndex: true,
  nights: true,
  parentStopId: true,
  dayTripDate: true,
  travelMode: true,
  fromAirport: true,
  toAirport: true,
  latitude: true,
  longitude: true,
  countryCode: true,
} as const;

export interface PlanStop {
  id: string;
  name: string;
  orderIndex: number;
  nights: number;
  parentStopId: string | null;
  dayTripDate: Date | null;
  travelMode: string;
  fromAirport: string | null;
  toAirport: string | null;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
}

export interface TripPlan {
  /** Each stop with the days it covers, as 'YYYY-MM-DD'. Day trips are one day. */
  visits: { stop: PlanStop; from: string; to: string }[];
  /** The day of every flight, one per arc the map draws. */
  flights: string[];
  /** Kilometres the plan adds to what was tracked, with the day they fall on. */
  extras: { km: number; day: string }[];
}

/** Great-circle distance (km) between two [lng,lat] points. */
export function kmLngLat(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const la1 = a[1] * toRad;
  const la2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

const point = (s: PlanStop): [number, number] | null =>
  s.latitude != null && s.longitude != null ? [s.longitude, s.latitude] : null;

export function planTrip(stops: PlanStop[], tripStart: Date): TripPlan {
  const route = stops.filter((s) => !s.parentStopId).sort((a, b) => a.orderIndex - b.orderIndex);
  const start = isoDay(tripStart);

  const arrival = new Map<string, string>();
  let nightsBefore = 0;
  for (const stop of route) {
    arrival.set(stop.id, addDays(start, nightsBefore));
    nightsBefore += Math.max(0, stop.nights);
  }

  const visits: TripPlan['visits'] = [];
  for (const stop of route) {
    const from = arrival.get(stop.id)!;
    visits.push({ stop, from, to: addDays(from, Math.max(0, stop.nights)) });
  }
  const byId = new Map(stops.map((s) => [s.id, s]));
  for (const stop of stops) {
    if (!stop.parentStopId) continue;
    const day = stop.dayTripDate ? isoDay(stop.dayTripDate) : arrival.get(stop.parentStopId) ?? start;
    visits.push({ stop, from: day, to: day });
  }

  // The same legs the map draws (apps/web/src/lib/arc.ts): a leg starts at
  // its departure airport or where the last one ended, and ends at its arrival
  // airport or the stop itself. A first stop without a departure airport has
  // no leg to it, whatever its mode says.
  const flights: string[] = [];
  let prev: [number, number] | null = null;
  for (const stop of route) {
    const dep = airportCoord(stop.fromAirport);
    const arr = airportCoord(stop.toAirport);
    const city = point(stop);
    const from = dep ?? prev;
    const to = arr ?? city;
    if (from && to && stop.travelMode === 'FLIGHT') flights.push(arrival.get(stop.id)!);
    prev = to ?? city ?? prev;
  }

  // What tracking never sees. A day trip there and back from where you slept,
  // and the stretch from or to home on a ground leg typed in by hand. Flights
  // are not kilometres travelled in this sense.
  const extras: TripPlan['extras'] = [];
  for (const stop of stops) {
    if (!stop.parentStopId) continue;
    const here = point(stop);
    const parent = byId.get(stop.parentStopId);
    const base = parent && point(parent);
    if (!here || !base) continue;
    const day = visits.find((v) => v.stop.id === stop.id)!.from;
    extras.push({ km: 2 * kmLngLat(here, base), day });
  }
  const cities = route.filter((s) => point(s) && !LEG_NAMES.has(s.name));
  route.forEach((stop, i) => {
    const here = point(stop);
    if (!here || !LEG_NAMES.has(stop.name) || stop.travelMode === 'FLIGHT') return;
    const neighbour = i === 0 ? cities[0] : cities[cities.length - 1];
    if (neighbour) extras.push({ km: kmLngLat(here, point(neighbour)!), day: arrival.get(stop.id)! });
  });

  return { visits, flights, extras };
}
