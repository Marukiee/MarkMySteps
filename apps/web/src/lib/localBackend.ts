import type { MediaItem, RouteCollection, Trip, TripMember } from '../api/types';
import { PlannedStop, haversineKm } from './arc';
import { mediaSrc, queryGallery, requestGalleryPermission } from './gallery';
import { dbAll, dbByTrip, dbDelete, dbDeleteMany, dbGet, dbPut, dbPutMany } from './localDb';
import { LOCAL_USER, localUser, setLocalName } from './localMode';
import { localCreate, localDelete, localReorder, localUpdate } from './plannerLocal';

/**
 * The API, served from the device.
 *
 * Rather than teaching every page about a second data source, this answers the
 * same paths with the same shapes — so `api('/trips/x/stops')` works whether it
 * goes over the network or not, and no component knows the difference.
 *
 * What is deliberately absent: anything that needs a second party. Travel
 * companions, live positions and share links raise `LocalUnsupported`, which
 * the UI shows as "needs a server" rather than as a failure.
 */

export class LocalUnsupported extends Error {
  readonly status = 501;

  constructor(what: string) {
    super(`${what} werkt alleen met een server.`);
  }
}

class LocalNotFound extends Error {
  readonly status = 404;

  constructor(what = 'Niet gevonden') {
    super(what);
  }
}

interface StoredTrip {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  coverMediaId: string | null;
  autoTrack: boolean;
  color: string | null;
  markerLng: number | null;
  markerLat: number | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredPoint {
  id: string;
  clientId: string | null;
  tripId: string;
  userId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  source: 'TRACKED' | 'MANUAL' | 'ROUTE_FILL' | 'IMPORTED';
}

interface StoredNote {
  id: string;
  tripId: string;
  authorId: string;
  day: string;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredMedia extends MediaItem {
  tripId: string;
}

const DAY_MS = 86_400_000;
const HOME_COUNTRY = 'NL';
const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

/** The only member a local trip has. */
function selfMember(): TripMember {
  const me = localUser();
  return {
    userId: me.id,
    role: 'OWNER',
    canTrack: true,
    user: {
      displayName: me.displayName,
      username: me.username,
      hasAvatar: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry — the same rules the API applies, minus PostGIS.
// ---------------------------------------------------------------------------

/** Radius within which consecutive fixes count as the same place. */
const STAY_RADIUS_M = 75;

/** Replaces each run of fixes that stays put by the average of that run, so a
 *  night in one spot is a point on the line instead of a scribble. */
function collapseStays(coords: [number, number][]): [number, number][] {
  if (coords.length === 0) return [];
  const out: [number, number][] = [];
  let anchor = coords[0]!;
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;
  const close = () => {
    if (n > 0) out.push([sumLng / n, sumLat / n]);
  };
  for (const c of coords) {
    if (haversineKm(anchor, c) * 1000 > STAY_RADIUS_M) {
      close();
      anchor = c;
      sumLng = 0;
      sumLat = 0;
      n = 0;
    }
    sumLng += c[0];
    sumLat += c[1];
    n += 1;
  }
  close();
  return out;
}

/** Douglas-Peucker with the tolerance in degrees, as ST_Simplify used it. */
function simplify(coords: [number, number][], tolerance: number): [number, number][] {
  if (coords.length < 3 || tolerance <= 0) return coords;
  const keep = new Array<boolean>(coords.length).fill(false);
  keep[0] = true;
  keep[coords.length - 1] = true;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let index = -1;
    let far = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(coords[i]!, coords[first]!, coords[last]!);
      if (d > far) {
        far = d;
        index = i;
      }
    }
    if (index === -1) continue;
    keep[index] = true;
    stack.push([first, index], [index, last]);
  }
  return coords.filter((_, i) => keep[i]);
}

function perpDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Points and photo locations of one trip, in time order. */
async function trackLine(tripId: string, includePhotos = true): Promise<[number, number][]> {
  const points = await dbByTrip<StoredPoint>('points', tripId);
  const rows: { t: number; c: [number, number] }[] = points.map((p) => ({
    t: new Date(p.recordedAt).getTime(),
    c: [p.longitude, p.latitude] as [number, number],
  }));
  if (includePhotos) {
    const media = await dbByTrip<StoredMedia>('media', tripId);
    for (const m of media) {
      if (m.latitude === null || m.longitude === null) continue;
      rows.push({ t: new Date(m.takenAt).getTime(), c: [m.longitude, m.latitude] });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.map((r) => r.c);
}

async function routeKm(tripId: string): Promise<number> {
  const points = (await dbByTrip<StoredPoint>('points', tripId)).sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  );
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm(
      [points[i - 1]!.longitude, points[i - 1]!.latitude],
      [points[i]!.longitude, points[i]!.latitude],
    );
  }
  return km;
}

/** Trip dates come from the plan: start plus every night, day trips excluded. */
async function syncEndDate(trip: StoredTrip, stops: PlannedStop[]): Promise<void> {
  const nights = stops.filter((s) => !s.parentStopId).reduce((sum, s) => sum + s.nights, 0);
  if (stops.length === 0) return;
  const end = new Date(new Date(`${trip.startDate.slice(0, 10)}T00:00:00.000Z`).getTime() + nights * DAY_MS)
    .toISOString()
    .slice(0, 10);
  if (end !== trip.endDate.slice(0, 10)) {
    await dbPut('trips', { ...trip, endDate: end, updatedAt: new Date().toISOString() });
  }
}

async function stopsOf(tripId: string): Promise<PlannedStop[]> {
  const stops = await dbByTrip<PlannedStop>('stops', tripId);
  return stops.sort((a, b) => a.orderIndex - b.orderIndex);
}

async function requireTrip(tripId: string): Promise<StoredTrip> {
  const trip = await dbGet<StoredTrip>('trips', tripId);
  if (!trip) throw new LocalNotFound('Reis niet gevonden');
  return trip;
}

/** Writes a stop list back, replacing whatever was there for that trip. */
async function saveStops(tripId: string, next: PlannedStop[]): Promise<PlannedStop[]> {
  const before = await stopsOf(tripId);
  const keep = new Set(next.map((s) => s.id));
  await dbDeleteMany('stops', before.filter((s) => !keep.has(s.id)).map((s) => s.id));
  await dbPutMany('stops', next.map((s) => ({ ...s, tripId })));
  return next;
}

// ---------------------------------------------------------------------------
// Trip shape for the list / detail pages
// ---------------------------------------------------------------------------

async function tripView(trip: StoredTrip, withRoute: boolean): Promise<Trip> {
  const stops = await stopsOf(trip.id);
  const media = await dbByTrip<StoredMedia>('media', trip.id);

  // Anchor: the middle of the real destinations, so a trip is framed on itself
  // and not on the outbound leg that starts at home.
  const cities = stops.filter(
    (s) => !LEG_NAMES.has(s.name) && !s.parentStopId && s.latitude !== null && s.longitude !== null,
  );
  const mid = cities[Math.floor(cities.length / 2)];
  const anchor: [number, number] | null =
    trip.markerLng != null && trip.markerLat != null
      ? [trip.markerLng, trip.markerLat]
      : mid
        ? [mid.longitude!, mid.latitude!]
        : null;

  const base: Trip = {
    id: trip.id,
    title: trip.title,
    description: trip.description,
    startDate: trip.startDate,
    endDate: trip.endDate,
    coverMediaId: trip.coverMediaId,
    resolvedCoverId: trip.coverMediaId ?? media[0]?.id ?? null,
    anchor,
    color: trip.color,
    markerLng: trip.markerLng,
    markerLat: trip.markerLat,
    autoTrack: trip.autoTrack,
    ownerId: trip.ownerId,
    members: [selfMember()],
  };
  if (!withRoute) return base;

  const tracked = simplify(await trackLine(trip.id, false), 0.08);
  const planned = plannedSegments(stops);
  return {
    ...base,
    distanceKm: Math.round(await routeKm(trip.id)),
    routePath:
      tracked.length >= 2 ? [tracked] : planned.ground.length > 0 ? planned.ground : undefined,
    flightPath: planned.flights.length > 0 ? planned.flights : undefined,
  };
}

/** Ground line broken at every flight, plus the flights as their own
 *  itineraries — the same split the API does for the globe. */
function plannedSegments(stops: PlannedStop[]): {
  ground: [number, number][][];
  flights: [number, number][][];
} {
  const route = stops.filter((s) => !s.parentStopId);
  const segments: [number, number][][] = [];
  const flights: [number, number][][] = [];
  let seg: [number, number][] = [];
  let prev: [number, number] | null = null;

  for (const s of route) {
    const city: [number, number] | null =
      s.latitude !== null && s.longitude !== null ? [s.longitude, s.latitude] : null;
    if (!city) continue;
    if (s.travelMode === 'FLIGHT' && prev) {
      flights.push([prev, city]);
      if (seg.length >= 2) segments.push(seg);
      seg = [];
      prev = city;
      continue;
    }
    if (seg.length === 0 && prev) seg.push(prev);
    seg.push(city);
    prev = city;
  }
  if (seg.length >= 2) segments.push(seg);

  // Day trips branch off their parent rather than joining the through-route.
  const byId = new Map(stops.map((s) => [s.id, s]));
  for (const s of stops) {
    if (!s.parentStopId || s.latitude === null || s.longitude === null) continue;
    const parent = byId.get(s.parentStopId);
    if (!parent || parent.latitude === null || parent.longitude === null) continue;
    segments.push([
      [parent.longitude, parent.latitude],
      [s.longitude, s.latitude],
    ]);
  }
  return { ground: segments, flights };
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

type Handler = (req: Request, params: string[]) => Promise<unknown>;

const routes: { method: string; pattern: RegExp; handle: Handler }[] = [];

function route(method: string, pattern: string, handle: Handler): void {
  // ":x" matches one path segment.
  const source = `^${pattern.replace(/:[a-z]+/gi, '([^/]+)')}$`;
  routes.push({ method, pattern: new RegExp(source), handle });
}

/* ---- Account ---- */

route('GET', '/users/me', async () => localUser());
route('PATCH', '/users/me', async (req) => {
  // The name is the one thing there is to change, and it lives where the rest
  // of the app can read it without opening the database.
  if (typeof req.body.displayName === 'string') setLocalName(req.body.displayName);
  return localUser();
});
route('GET', '/users/friends', async () => []);
route('GET', '/users/suggestions', async () => []);

/**
 * The same numbers the server computes, over the device's own database. There
 * is only one traveller here, so the id in the path is not checked against
 * anything: whoever asks, gets their own.
 */
route('GET', '/users/:id/stats', async () => {
  const trips = await dbAll<StoredTrip>('trips');
  trips.sort((a, b) => b.startDate.localeCompare(a.startDate));

  const countries = new Set<string>();
  const places = new Set<string>();
  let flights = 0;
  let days = 0;
  let ongoing = 0;
  let distanceKm = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const trip of trips) {
    for (const stop of await stopsOf(trip.id)) {
      const code = stop.countryCode?.toUpperCase();
      if (code && code !== HOME_COUNTRY) countries.add(code);
      places.add(`${code ?? ''}/${stop.name.trim().toLowerCase()}`);
      if (stop.travelMode === 'FLIGHT') flights += 1;
    }
    days +=
      Math.round(
        (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / DAY_MS,
      ) + 1;
    if (trip.startDate.slice(0, 10) <= today && trip.endDate.slice(0, 10) >= today) ongoing += 1;
    distanceKm += await routeKm(trip.id);
  }

  const media = await dbAll<StoredMedia>('media');

  return {
    user: localUser(),
    sharedTrips: 0,
    trips: trips.length,
    ongoing,
    days,
    countries: [...countries].sort(),
    places: places.size,
    flights,
    distanceKm: Math.round(distanceKm),
    photoCount: media.length,
    recent: trips.slice(0, 5).map((t) => ({
      id: t.id,
      title: t.title,
      startDate: t.startDate.slice(0, 10),
      endDate: t.endDate.slice(0, 10),
      color: t.color ?? null,
    })),
  };
});

/* ---- Trips ---- */

route('GET', '/trips', async () => {
  const trips = await dbAll<StoredTrip>('trips');
  trips.sort((a, b) => b.startDate.localeCompare(a.startDate));
  return Promise.all(trips.map((t) => tripView(t, true)));
});

route('POST', '/trips', async (req) => {
  const now = new Date().toISOString();
  const trip: StoredTrip = {
    id: (req.body.id as string) ?? crypto.randomUUID(),
    title: String(req.body.title ?? '').trim(),
    description: (req.body.description as string) ?? null,
    startDate: String(req.body.startDate).slice(0, 10),
    endDate: String(req.body.endDate).slice(0, 10),
    coverMediaId: null,
    autoTrack: false,
    color: null,
    markerLng: null,
    markerLat: null,
    ownerId: LOCAL_USER.id,
    createdAt: now,
    updatedAt: now,
  };
  await dbPut('trips', trip);
  return tripView(trip, false);
});

route('GET', '/trips/:id', async (_req, [id]) => tripView(await requireTrip(id!), false));

route('PATCH', '/trips/:id', async (req, [id]) => {
  const trip = await requireTrip(id!);
  const next: StoredTrip = {
    ...trip,
    ...(req.body.title !== undefined ? { title: String(req.body.title).trim() } : {}),
    ...(req.body.description !== undefined
      ? { description: (req.body.description as string) ?? null }
      : {}),
    ...(req.body.startDate !== undefined
      ? { startDate: String(req.body.startDate).slice(0, 10) }
      : {}),
    ...(req.body.endDate !== undefined ? { endDate: String(req.body.endDate).slice(0, 10) } : {}),
    ...(req.body.coverMediaId !== undefined
      ? { coverMediaId: (req.body.coverMediaId as string) ?? null }
      : {}),
    ...(req.body.autoTrack !== undefined ? { autoTrack: Boolean(req.body.autoTrack) } : {}),
    ...(req.body.color !== undefined ? { color: (req.body.color as string) ?? null } : {}),
    ...(req.body.markerLng !== undefined
      ? { markerLng: (req.body.markerLng as number) ?? null }
      : {}),
    ...(req.body.markerLat !== undefined
      ? { markerLat: (req.body.markerLat as number) ?? null }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  await dbPut('trips', next);
  // Shortening a trip drops the photos that now fall outside it, as the API does.
  if (req.body.startDate !== undefined || req.body.endDate !== undefined) {
    const media = await dbByTrip<StoredMedia>('media', next.id);
    const outside = media.filter(
      (m) => m.takenAt.slice(0, 10) < next.startDate || m.takenAt.slice(0, 10) > next.endDate,
    );
    await dbDeleteMany('media', outside.map((m) => m.id));
  }
  return tripView(next, false);
});

route('DELETE', '/trips/:id', async (_req, [id]) => {
  const tripId = id!;
  for (const store of ['stops', 'points', 'notes', 'media'] as const) {
    const rows = await dbByTrip<{ id: string }>(store, tripId);
    await dbDeleteMany(store, rows.map((r) => r.id));
  }
  await dbDelete('trips', tripId);
  return undefined;
});

route('GET', '/trips/:id/stats', async (_req, [id]) => {
  const trip = await requireTrip(id!);
  const stops = await stopsOf(trip.id);
  const media = await dbByTrip<StoredMedia>('media', trip.id);

  const hasCoord = (s: PlannedStop) => s.latitude !== null && s.longitude !== null;
  const cities = stops.filter((s) => hasCoord(s) && !LEG_NAMES.has(s.name) && !s.parentStopId);
  let extraKm = 0;

  // A day trip is a there-and-back detour that tracking never sees.
  const byId = new Map(stops.map((s) => [s.id, s]));
  for (const s of stops) {
    if (!s.parentStopId || !hasCoord(s)) continue;
    const parent = byId.get(s.parentStopId);
    if (!parent || !hasCoord(parent)) continue;
    extraKm += 2 * haversineKm([s.longitude!, s.latitude!], [parent.longitude!, parent.latitude!]);
  }
  // A manually placed begin/end leg adds the stretch from or to home.
  stops.forEach((s, i) => {
    if (!hasCoord(s) || !LEG_NAMES.has(s.name) || s.travelMode === 'FLIGHT') return;
    const neighbour = i === 0 ? cities[0] : cities[cities.length - 1];
    if (neighbour) {
      extraKm += haversineKm(
        [s.longitude!, s.latitude!],
        [neighbour.longitude!, neighbour.latitude!],
      );
    }
  });

  const days =
    Math.round(
      (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / DAY_MS,
    ) + 1;

  return {
    distanceKm: Math.round((await routeKm(trip.id)) + extraKm),
    countries: [
      ...new Set(
        stops
          .map((s) => s.countryCode)
          .filter((c): c is string => !!c && c.toUpperCase() !== HOME_COUNTRY),
      ),
    ],
    days,
    photoCount: media.length,
  };
});

/* ---- Stops ---- */

route('GET', '/trips/:id/stops', async (_req, [id]) => stopsOf(id!));

route('POST', '/trips/:id/stops', async (req, [id]) => {
  const trip = await requireTrip(id!);
  const body = { id: crypto.randomUUID(), ...req.body } as Parameters<typeof localCreate>[2];
  const next = localCreate(await stopsOf(trip.id), trip.startDate, body);
  await saveStops(trip.id, next);
  await syncEndDate(trip, next);
  return next;
});

route('PATCH', '/trips/:id/stops/:stopId', async (req, [id, stopId]) => {
  const trip = await requireTrip(id!);
  const next = localUpdate(await stopsOf(trip.id), trip.startDate, stopId!, req.body);
  await saveStops(trip.id, next);
  await syncEndDate(trip, next);
  return next;
});

route('DELETE', '/trips/:id/stops/:stopId', async (_req, [id, stopId]) => {
  const trip = await requireTrip(id!);
  const next = localDelete(await stopsOf(trip.id), trip.startDate, stopId!);
  await saveStops(trip.id, next);
  await syncEndDate(trip, next);
  return next;
});

route('PUT', '/trips/:id/stops/order', async (req, [id]) => {
  const trip = await requireTrip(id!);
  const next = localReorder(
    await stopsOf(trip.id),
    trip.startDate,
    (req.body.stopIds as string[]) ?? [],
  );
  await saveStops(trip.id, next);
  return next;
});

/* ---- Tracking ---- */

route('POST', '/trips/:id/points/batch', async (req, [id]) => {
  const tripId = id!;
  const incoming = (req.body.points ?? []) as StoredPoint[];
  const existing = await dbByTrip<StoredPoint>('points', tripId);
  const seen = new Set(existing.map((p) => p.clientId).filter(Boolean));
  const fresh = incoming
    .filter((p) => !p.clientId || !seen.has(p.clientId))
    .map((p) => ({
      id: crypto.randomUUID(),
      clientId: p.clientId ?? null,
      tripId,
      userId: LOCAL_USER.id,
      recordedAt: p.recordedAt,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy ?? null,
      altitude: p.altitude ?? null,
      source: 'TRACKED' as const,
    }));
  await dbPutMany('points', fresh);
  return { received: incoming.length, added: fresh.length };
});

route('GET', '/trips/:id/points', async (_req, [id]) => {
  const points = await dbByTrip<StoredPoint>('points', id!);
  return points
    .filter((p) => p.source === 'MANUAL')
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .map((p) => ({
      id: p.id,
      latitude: p.latitude,
      longitude: p.longitude,
      recordedAt: p.recordedAt,
    }));
});

route('GET', '/trips/:id/points/day', async (req, [id]) => {
  const day = req.query.get('day') ?? '';
  const points = await dbByTrip<StoredPoint>('points', id!);
  return points
    .filter((p) => p.recordedAt.slice(0, 10) === day)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
});

route('GET', '/trips/:id/points/days', async (_req, [id]) => {
  const points = await dbByTrip<StoredPoint>('points', id!);
  const counts = new Map<string, number>();
  for (const p of points) {
    const day = p.recordedAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => b.day.localeCompare(a.day));
});

route('POST', '/trips/:id/points', async (req, [id]) => {
  const point: StoredPoint = {
    id: crypto.randomUUID(),
    clientId: null,
    tripId: id!,
    userId: LOCAL_USER.id,
    recordedAt: (req.body.recordedAt as string) ?? new Date().toISOString(),
    latitude: req.body.latitude as number,
    longitude: req.body.longitude as number,
    accuracy: null,
    altitude: null,
    source: 'MANUAL',
  };
  await dbPut('points', point);
  return point;
});

route('PATCH', '/trips/:id/points/:pointId', async (req, [, pointId]) => {
  const point = await dbGet<StoredPoint>('points', pointId!);
  if (!point) throw new LocalNotFound('Punt niet gevonden');
  await dbPut('points', {
    ...point,
    latitude: req.body.latitude as number,
    longitude: req.body.longitude as number,
  });
  return undefined;
});

route('DELETE', '/trips/:id/points/:pointId', async (_req, [, pointId]) => {
  await dbDelete('points', pointId!);
  return undefined;
});

route('DELETE', '/trips/:id/tracked', async (req, [id]) => {
  const day = req.query.get('day');
  const points = await dbByTrip<StoredPoint>('points', id!);
  const doomed = points.filter((p) => !day || p.recordedAt.slice(0, 10) === day);
  await dbDeleteMany('points', doomed.map((p) => p.id));
  return { deleted: doomed.length };
});

route('GET', '/trips/:id/route-fill/near', async (req, [id]) => {
  const lng = Number(req.query.get('lng'));
  const lat = Number(req.query.get('lat'));
  const points = await dbByTrip<StoredPoint>('points', id!);
  const near = points.some(
    (p) => p.source === 'ROUTE_FILL' && haversineKm([lng, lat], [p.longitude, p.latitude]) <= 25,
  );
  return { near };
});

/**
 * Drawing a train ride, offline mode's own copy.
 *
 * The same two questions as the server's: where is the gap in the line, and
 * what do the rails between those two stations look like. The router is a
 * public one and answers the browser directly, so this needs nothing the app
 * does not already have.
 */
route('POST', '/trips/:id/route-fill/train', async (req, [id]) => {
  const tripId = id!;
  const lng = Number(req.body.lng);
  const lat = Number(req.body.lat);
  const from = req.body.from as { lng: number; lat: number };
  const to = req.body.to as { lng: number; lat: number };

  // Everything that sits on the timeline: the fixes, the photos, and the
  // planned stops, which are the only anchors a trip nobody tracked has.
  const points = await dbByTrip<StoredPoint>('points', tripId);
  const anchors: { t: number; lng: number; lat: number }[] = points.map((p) => ({
    t: new Date(p.recordedAt).getTime(),
    lng: p.longitude,
    lat: p.latitude,
  }));
  for (const m of await dbByTrip<StoredMedia>('media', tripId)) {
    if (m.latitude === null || m.longitude === null) continue;
    anchors.push({ t: new Date(m.takenAt).getTime(), lng: m.longitude, lat: m.latitude });
  }
  for (const stop of await dbByTrip<PlannedStop>('stops', tripId)) {
    if (stop.parentStopId || stop.latitude === null || stop.longitude === null) continue;
    anchors.push({
      t: new Date(stop.arrivalDate).getTime(),
      lng: stop.longitude,
      lat: stop.latitude,
    });
  }
  anchors.sort((a, b) => a.t - b.t);
  if (anchors.length < 2) throw new LocalNotFound('Er is nog geen route om aan te vullen');

  // The gap that was pressed: the nearest consecutive pair that is a real
  // stretch of line rather than two fixes on the same street corner.
  let best: { a: (typeof anchors)[number]; b: (typeof anchors)[number]; d: number } | null = null;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!;
    const b = anchors[i]!;
    if (haversineKm([a.lng, a.lat], [b.lng, b.lat]) < 2) continue;
    const mid: [number, number] = [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2];
    const d = haversineKm([lng, lat], mid);
    if (!best || d < best.d) best = { a, b, d };
  }
  if (!best) throw new LocalNotFound('Geen recht stuk in de buurt om aan te vullen');

  // Which station it left from follows from the gap, not from the order the
  // two boxes were filled in.
  const reach = (p: { lng: number; lat: number }, q: { lng: number; lat: number }) =>
    haversineKm([p.lng, p.lat], [q.lng, q.lat]);
  const straight =
    reach(best.a, from) + reach(best.b, to) <= reach(best.a, to) + reach(best.b, from);
  const dep = straight ? from : to;
  const arr = straight ? to : from;

  const url =
    `https://signal.eu.org/osm/eu/route/v1/train/` +
    `${dep.lng},${dep.lat};${arr.lng},${arr.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url).catch(() => null);
  const json = res?.ok
    ? ((await res.json()) as { routes?: { geometry?: { coordinates?: [number, number][] } }[] })
    : null;
  const rails = json?.routes?.[0]?.geometry?.coordinates ?? [];
  if (rails.length < 3) {
    throw new LocalNotFound(
      'Kon geen spoorroute tussen die stations vinden. Buiten Europa kent de spoorkaart geen route.',
    );
  }

  // Thinned out, and with the stations themselves on either end so the drawn
  // stretch joins the line before and after the train instead of floating
  // beside it.
  const step = rails.length / 150;
  const inner: [number, number][] = [];
  for (let i = 0; i < Math.min(150, rails.length); i++) inner.push(rails[Math.floor(i * step)]!);
  const line: [number, number][] = [[dep.lng, dep.lat], ...inner, [arr.lng, arr.lat]];

  const drawn: StoredPoint[] = line.map((c, i) => ({
    id: crypto.randomUUID(),
    clientId: null,
    tripId,
    userId: LOCAL_USER.id,
    recordedAt: new Date(
      best!.a.t + ((i + 1) / (line.length + 1)) * (best!.b.t - best!.a.t),
    ).toISOString(),
    latitude: c[1],
    longitude: c[0],
    accuracy: null,
    altitude: null,
    source: 'ROUTE_FILL',
  }));
  await dbPutMany('points', drawn);
  return { added: drawn.length };
});

route('DELETE', '/trips/:id/route-fill', async (req, [id]) => {
  const points = (await dbByTrip<StoredPoint>('points', id!)).sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  );
  const lng = Number(req.query.get('lng'));
  const lat = Number(req.query.get('lat'));

  // With a coordinate: only the one drawn stretch you pressed on. A drawn route
  // is a contiguous run in time, so the nearest point plus its neighbours is
  // exactly that stretch.
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    let nearest = -1;
    let best = Number.POSITIVE_INFINITY;
    points.forEach((p, i) => {
      if (p.source !== 'ROUTE_FILL') return;
      const d = haversineKm([lng, lat], [p.longitude, p.latitude]);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    if (nearest === -1 || best > 25) throw new LocalNotFound('Geen getekende route in de buurt');
    let from = nearest;
    while (from > 0 && points[from - 1]!.source === 'ROUTE_FILL') from -= 1;
    let to = nearest;
    while (to < points.length - 1 && points[to + 1]!.source === 'ROUTE_FILL') to += 1;
    const ids = points.slice(from, to + 1).map((p) => p.id);
    await dbDeleteMany('points', ids);
    return { deleted: ids.length };
  }

  const doomed = points.filter((p) => p.source === 'ROUTE_FILL' || p.source === 'MANUAL');
  await dbDeleteMany('points', doomed.map((p) => p.id));
  return { deleted: doomed.length };
});

route('GET', '/trips/:id/route', async (req, [id]) => {
  const includePhotos = req.query.get('photos') !== 'false';
  const coords = simplify(collapseStays(await trackLine(id!, includePhotos)), 0.0003);
  const collection: RouteCollection = { type: 'FeatureCollection', features: [] };
  if (coords.length >= 2) {
    collection.features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        userId: LOCAL_USER.id,
        displayName: LOCAL_USER.displayName,
        pointCount: coords.length,
      },
    });
  }
  return collection;
});

route('GET', '/trips/:id/live', async () => []);

/* ---- Photos and notes ---- */

route('GET', '/trips/:id/media', async (_req, [id]) => {
  const media = await dbByTrip<StoredMedia>('media', id!);
  return media.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
});

route('GET', '/trips/:id/notes', async (_req, [id]) => {
  const notes = await dbByTrip<StoredNote>('notes', id!);
  return notes.sort((a, b) => a.day.localeCompare(b.day));
});

route('POST', '/trips/:id/notes', async (req, [id]) => {
  const tripId = id!;
  const day = String(req.body.day).slice(0, 10);
  const existing = (await dbByTrip<StoredNote>('notes', tripId)).find((n) => n.day === day);
  const now = new Date().toISOString();
  const note: StoredNote = existing
    ? { ...existing, body: String(req.body.body), updatedAt: now }
    : {
        id: crypto.randomUUID(),
        tripId,
        authorId: LOCAL_USER.id,
        day,
        title: null,
        body: String(req.body.body),
        createdAt: now,
        updatedAt: now,
      };
  await dbPut('notes', note);
  return note;
});

route('DELETE', '/trips/:id/notes/:noteId', async (_req, [, noteId]) => {
  await dbDelete('notes', noteId!);
  return undefined;
});

/* ---- Things that genuinely need a server ---- */

route('GET', '/trips/:id/share', async () => []);
route('POST', '/trips/:id/share', async () => {
  throw new LocalUnsupported('Een deel-link maken');
});
route('GET', '/trips/:id/members', async () => [selfMember()]);
route('POST', '/trips/:id/members', async () => {
  throw new LocalUnsupported('Reisgenoten toevoegen');
});
/**
 * Pulls the trip's photos out of the phone's own library.
 *
 * The local counterpart of the Immich sync, and it works the same way: match on
 * the day a photo was taken, keep its EXIF coordinates. A media id IS its
 * content URI (encoded), so nothing has to look up where a thumbnail lives —
 * see fetchBlobUrl.
 */
route('POST', '/trips/:id/sync', async (_req, [id]) => {
  const trip = await requireTrip(id!);
  const permissions = await requestGalleryPermission();
  if (!permissions.library) {
    throw new LocalUnsupported('Zonder toegang tot je fotobibliotheek koppelen');
  }

  const items = await queryGallery(trip.startDate, trip.endDate);
  const existing = await dbByTrip<StoredMedia>('media', trip.id);
  const known = new Set(existing.map((m) => m.id));
  const fresh: StoredMedia[] = [];
  for (const item of items) {
    const mediaId = encodeURIComponent(item.uri);
    if (known.has(mediaId)) continue;
    fresh.push({
      id: mediaId,
      tripId: trip.id,
      userId: LOCAL_USER.id,
      immichAssetId: item.uri,
      assetType: item.video ? 'VIDEO' : 'IMAGE',
      takenAt: new Date(item.takenAt).toISOString(),
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      // Shape as the gallery reports it, so the justified grid can lay these
      // out without first decoding every file.
      width: item.width || null,
      height: item.height || null,
    });
  }
  await dbPutMany('media', fresh);
  return {
    tripId: trip.id,
    usersSynced: 1,
    assetsFound: items.length,
    assetsAdded: fresh.length,
    // Worth surfacing: without it every photo lands without a map position.
    hasLocation: permissions.location,
  };
});
// A local video plays straight from its content URI; there is no proxy to ask.
route('GET', '/media/:mediaId/video-url', async (_req, [mediaId]) => ({
  url: mediaSrc(decodeURIComponent(mediaId!)),
}));

route('GET', '/immich/connection', async () => {
  throw new LocalNotFound('Geen Immich-koppeling');
});
// An object, not null: the banner reads `.version` off whatever comes back.
route('GET', '/app/latest', async () => ({}));

/**
 * Answers one request from the device. Throws `LocalUnsupported` for anything
 * that needs a second party, and `LocalNotFound` for a missing record — both
 * carry a `status`, so the caller treats them exactly like a server's answer.
 */
export async function localRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const [rawPath, rawQuery = ''] = path.split('?');
  for (const entry of routes) {
    if (entry.method !== method) continue;
    const match = entry.pattern.exec(rawPath!);
    if (!match) continue;
    const result = await entry.handle(
      {
        method,
        path: rawPath!,
        query: new URLSearchParams(rawQuery),
        body: (options.body ?? {}) as Record<string, unknown>,
      },
      match.slice(1),
    );
    return result as T;
  }
  throw new LocalUnsupported(`${method} ${rawPath}`);
}
