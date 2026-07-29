import type { PlannedStop, TravelMode } from './arc';

/**
 * The planner's rules, client side.
 *
 * With no connection the API cannot answer with the recomputed stop list, so
 * the same rules are applied here and the request is queued. This is a
 * deliberate mirror of StopsService: the ordering (route stops, each followed
 * by its own day trips) and the dates (trip start plus the nights before a
 * stop; a day trip keeps its own date and consumes nothing).
 *
 * Keep the two in step. Anything that drifts shows up as the list changing
 * shape the moment a connection comes back.
 */

const DAY_MS = 86_400_000;

export interface CreateStopBody {
  id?: string;
  name: string;
  nights: number;
  latitude?: number;
  longitude?: number;
  countryCode?: string;
  travelMode?: TravelMode;
  flightNumber?: string;
  fromAirport?: string;
  toAirport?: string;
  viaAirports?: string[];
  notes?: string;
  afterStopId?: string;
  parentStopId?: string;
  dayTripDate?: string;
}

export type UpdateStopBody = Partial<Omit<CreateStopBody, 'id' | 'afterStopId' | 'parentStopId'>>;

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Route stops in order, each immediately followed by its own day trips. */
function resequence(stops: PlannedStop[], routeOrder?: string[]): PlannedStop[] {
  let route = stops.filter((s) => !s.parentStopId);
  if (routeOrder) {
    const rank = new Map(routeOrder.map((id, i) => [id, i]));
    route = [...route].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  const children = new Map<string, PlannedStop[]>();
  for (const s of stops) {
    if (!s.parentStopId) continue;
    children.set(s.parentStopId, [...(children.get(s.parentStopId) ?? []), s]);
  }
  const out: PlannedStop[] = [];
  for (const stop of route) {
    out.push(stop);
    const kids = (children.get(stop.id) ?? []).sort((a, b) =>
      (a.dayTripDate ?? '').localeCompare(b.dayTripDate ?? ''),
    );
    out.push(...kids);
    children.delete(stop.id);
  }
  for (const kids of children.values()) out.push(...kids);
  return out.map((s, i) => ({ ...s, orderIndex: i }));
}

/** Trip start plus the nights before each stop; day trips keep their own date. */
function withDates(stops: PlannedStop[], tripStart: string): PlannedStop[] {
  let cursor = new Date(`${tripStart.slice(0, 10)}T00:00:00.000Z`).getTime();
  const arrivalOf = new Map<string, string>();
  return stops.map((stop) => {
    if (stop.parentStopId) {
      const day = stop.dayTripDate?.slice(0, 10) ?? arrivalOf.get(stop.parentStopId) ?? isoDay(cursor);
      return { ...stop, arrivalDate: day, departureDate: day };
    }
    const arrival = cursor;
    cursor = arrival + stop.nights * DAY_MS;
    const arrivalDate = isoDay(arrival);
    arrivalOf.set(stop.id, arrivalDate);
    return { ...stop, arrivalDate, departureDate: isoDay(cursor) };
  });
}

function normalise(stops: PlannedStop[], tripStart: string, routeOrder?: string[]): PlannedStop[] {
  return withDates(resequence(stops, routeOrder), tripStart);
}

export function localCreate(
  stops: PlannedStop[],
  tripStart: string,
  body: CreateStopBody & { id: string },
): PlannedStop[] {
  const created: PlannedStop = {
    id: body.id,
    name: body.name.trim(),
    nights: body.parentStopId ? 0 : body.nights,
    notes: body.notes ?? null,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    countryCode: body.countryCode?.toUpperCase() ?? null,
    travelMode: body.travelMode ?? 'GROUND',
    flightNumber: body.flightNumber ?? null,
    fromAirport: body.fromAirport ?? null,
    toAirport: body.toAirport ?? null,
    viaAirports: body.viaAirports ?? [],
    parentStopId: body.parentStopId ?? null,
    dayTripDate: body.parentStopId ? body.dayTripDate ?? null : null,
    orderIndex: stops.length,
    arrivalDate: tripStart.slice(0, 10),
    departureDate: tripStart.slice(0, 10),
  };

  let routeOrder: string[] | undefined;
  if (!body.parentStopId) {
    const route = stops.filter((s) => !s.parentStopId).map((s) => s.id);
    const at = body.afterStopId ? route.indexOf(body.afterStopId) : -1;
    route.splice(at === -1 ? route.length : at + 1, 0, created.id);
    routeOrder = route;
  }
  return normalise([...stops, created], tripStart, routeOrder);
}

export function localUpdate(
  stops: PlannedStop[],
  tripStart: string,
  stopId: string,
  body: UpdateStopBody,
): PlannedStop[] {
  const clearFlight = body.travelMode !== undefined && body.travelMode !== 'FLIGHT';
  const next = stops.map((s) => {
    if (s.id !== stopId) return s;
    return {
      ...s,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.nights !== undefined ? { nights: body.nights } : {}),
      ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
      ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
      ...(body.countryCode !== undefined
        ? { countryCode: body.countryCode.toUpperCase() }
        : {}),
      ...(body.travelMode !== undefined ? { travelMode: body.travelMode } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.dayTripDate !== undefined ? { dayTripDate: body.dayTripDate } : {}),
      ...(clearFlight
        ? { flightNumber: null, fromAirport: null, toAirport: null, viaAirports: [] }
        : {
            ...(body.flightNumber !== undefined ? { flightNumber: body.flightNumber } : {}),
            ...(body.fromAirport !== undefined ? { fromAirport: body.fromAirport } : {}),
            ...(body.toAirport !== undefined ? { toAirport: body.toAirport } : {}),
            ...(body.viaAirports !== undefined ? { viaAirports: body.viaAirports } : {}),
          }),
    };
  });
  return normalise(next, tripStart);
}

/** Deleting a stop takes its day trips with it, exactly like the cascade does. */
export function localDelete(
  stops: PlannedStop[],
  tripStart: string,
  stopId: string,
): PlannedStop[] {
  return normalise(
    stops.filter((s) => s.id !== stopId && s.parentStopId !== stopId),
    tripStart,
  );
}

export function localReorder(
  stops: PlannedStop[],
  tripStart: string,
  stopIds: string[],
): PlannedStop[] {
  return normalise(stops, tripStart, stopIds);
}
