import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Trip, TripRole } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { airportCoord } from '../common/airports';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';

/**
 * One leg of a trip, in the order it was travelled.
 *
 * routePath and flightPath say WHAT to draw but not in which order the two
 * interleave, which is all the globe needs to run a light along the journey.
 * Recovering that order by matching endpoints is guesswork: a flight whose
 * arrival airport was left blank ends at the city instead, and two airports an
 * hour apart look like the same place. The order is known here, so it is sent.
 */
export type JourneyLeg = {
  flight: boolean;
  /** Ground: the line's vertices. Flight: [departure, ...layovers, arrival]. */
  points: [number, number][];
};

export type TripMemberView = {
  userId: string;
  role: TripRole;
  canTrack: boolean;
  user: { displayName: string; username: string; hasAvatar: boolean };
};
export type TripWithMembers = Trip & {
  members: TripMemberView[];
  /** coverMediaId when set, else the first trip photo — for the card cover. */
  resolvedCoverId: string | null;
  /** [lng, lat] anchor for the globe, if any stop has coordinates. */
  anchor: [number, number] | null;
  /**
   * Every planned stop that has coordinates, day trips included, in travel
   * order. The globe draws a dot per stop; the route line alone only showed
   * where a trip began and ended.
   */
  stopPoints: [number, number][];
  /** Route distance in km (0 when unknown); only populated by listForUser. */
  distanceKm?: number;
  /**
   * Route for the globe overview as one or more polyline segments (listForUser
   * only). Ground legs stay connected; the line is broken at flights so a flight
   * never shows as a straight coloured line — flightPath draws the arc instead.
   */
  routePath?: [number, number][][];
  /**
   * Flight legs, drawn dashed on the globe. One entry per flight, listing the
   * full itinerary — [departure, ...layovers, arrival] — so the globe can bow
   * each hop while still knowing which points are mere layovers.
   */
  flightPath?: [number, number][][];
  /**
   * The same legs in travel order (listForUser, planned routes only). Absent
   * once a trip has a tracked route: the drawn line is then the recording, and
   * the plan cannot say where inside it the flights fall.
   */
  journey?: JourneyLeg[];
};

/** Country you live in — excluded from a trip's "countries visited" count. */
const HOME_COUNTRY = 'NL';

/**
 * How many places a trip's plan covers, for the "aantal stops" chip.
 *
 * Route stops always count, even a city you sleep in twice. Day trips only
 * count the first time: going into Stockholm three times from Saltsjöbaden is
 * still one place you visited, not three stops.
 */
export function countStopPlaces(
  stops: {
    latitude: number | null;
    longitude: number | null;
    parentStopId?: string | null;
  }[],
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const stop of stops) {
    if (stop.latitude == null || stop.longitude == null) continue;
    // ~100 m grid: the same city searched twice never lands on the exact
    // same coordinate.
    const key = `${stop.latitude.toFixed(3)},${stop.longitude.toFixed(3)}`;
    if (stop.parentStopId && seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

const MEMBERS_INCLUDE = {
  members: {
    include: { user: { select: { displayName: true, username: true, avatarMime: true } } },
  },
  // One photo to fall back on as an automatic cover.
  mediaRefs: {
    take: 1,
    orderBy: { takenAt: 'asc' },
    select: { id: true },
  },
  // Two jobs: a geo anchor for the globe overview, and a dot per place the
  // plan touches. Day trips come along for the dots but are marked, because
  // they are excursions off the route and must not drag the framing.
  stops: {
    where: { latitude: { not: null } },
    orderBy: { orderIndex: 'asc' },
    select: {
      name: true,
      latitude: true,
      longitude: true,
      parentStopId: true,
    },
  },
} as const;

export interface TripStats {
  distanceKm: number;
  countries: string[];
  days: number;
  photoCount: number;
}

type RawStop = {
  name: string;
  latitude: number | null;
  longitude: number | null;
  parentStopId: string | null;
};

/** Departure/arrival legs: real places, but at home, not on the trip. */
const ANCHOR_SKIP = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

type RawTripRow = Trip & {
  members: RawMember[];
  mediaRefs: { id: string }[];
  stops: RawStop[];
};

/** Maps Prisma rows (avatarMime, mediaRefs, stops) to the API shape. */
function mapMembers(trip: RawTripRow): TripWithMembers {
  const { mediaRefs, stops, members, ...rest } = trip;
  // The globe frames a trip on its anchor and hangs the name card off it, so it
  // has to land ON the trip. The first stop is usually the outbound leg, which
  // starts at home — a Sweden trip would then be framed on the Netherlands with
  // its route pushed off the top of the view. Skip those legs and take the
  // MIDDLE of the real destinations, which sits inside the route either way.
  const route = stops.filter((s) => s.parentStopId === null);
  const cities = route.filter((s) => !ANCHOR_SKIP.has(s.name));
  const usable = (cities.length > 0 ? cities : route).filter(
    (s): s is RawStop & { latitude: number; longitude: number } =>
      s.latitude != null && s.longitude != null,
  );
  const mid = usable[Math.floor(usable.length / 2)];
  // A manual marker (interrail loop etc.) still wins.
  const anchor: [number, number] | null =
    trip.markerLng != null && trip.markerLat != null
      ? [trip.markerLng, trip.markerLat]
      : mid
        ? [mid.longitude, mid.latitude]
        : null;
  // Every place the plan names, day trips included, in the order they are
  // travelled. The heen-/terugreis legs carry a coordinate for their distance
  // but are not places you went, so they get no dot — same rule the trip map
  // already uses for its pins.
  const stopPoints = stops
    .filter((s) => !ANCHOR_SKIP.has(s.name) && s.latitude != null && s.longitude != null)
    .map((s) => [s.longitude!, s.latitude!] as [number, number]);
  return {
    ...rest,
    resolvedCoverId: trip.coverMediaId ?? mediaRefs[0]?.id ?? null,
    anchor,
    stopPoints,
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      canTrack: m.canTrack,
      user: {
        displayName: m.user.displayName,
        username: m.user.username,
        hasAvatar: m.user.avatarMime !== null,
      },
    })),
  };
}

// Rough Netherlands bounding box. Home snaps/tracks here shouldn't count as part
// of a foreign trip's route (a train from Castricum to Londen etc.).
const NL_BBOX = { lonMin: 3.2, lonMax: 7.35, latMin: 50.7, latMax: 53.7 };
function inHomeCountry(p: [number, number]): boolean {
  return (
    p[0] >= NL_BBOX.lonMin &&
    p[0] <= NL_BBOX.lonMax &&
    p[1] >= NL_BBOX.latMin &&
    p[1] <= NL_BBOX.latMax
  );
}

/** Drops home-country points from a route, unless the whole trip is at home
 *  (a purely domestic trip stays intact). */
function stripHomeCountry(coords: [number, number][]): [number, number][] {
  const foreign = coords.filter((p) => !inHomeCountry(p));
  return foreign.length === 0 ? coords : foreign;
}

/** Great-circle distance (km) between two [lng,lat] points. */
function kmLngLat(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const la1 = a[1] * toRad;
  const la2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * A jump this big inside a recorded route is a flight, not a drive.
 *
 * Mirrors the globe's own FLIGHT_DEG (6°), which is what turns such a jump into
 * a dashed bow instead of a straight coloured line. The two have to agree, or
 * the light would fly a leg that was drawn as a road.
 */
const FLIGHT_GAP_KM = 660;

/** Endpoints within this of a gap's are taken to be the flight that made it. */
const FLIGHT_MATCH_KM = 120;

/**
 * A recorded route as an ordered journey.
 *
 * The line comes out of PostGIS as ST_MakeLine(geom ORDER BY "recordedAt"), so
 * it is already the trip in the order it happened — no dates needed. Where the
 * tracker went quiet for a flight there is a jump; that jump IS the flight, and
 * everything either side of it is ground. Each gap takes the planned flight
 * whose endpoints match it, so its layovers still show; a gap with no planned
 * flight behind it becomes a plain hop between the two points.
 *
 * A phone that kept a fix through the flight leaves no gap, and then the light
 * simply follows the real path it recorded — which is the truth of it anyway.
 */
function trackedJourney(line: [number, number][], flights: [number, number][][]): JourneyLeg[] {
  const journey: JourneyLeg[] = [];
  let run: [number, number][] = line.length > 0 ? [line[0]!] : [];
  const closeRun = () => {
    if (run.length >= 2) journey.push({ flight: false, points: run });
    run = [];
  };
  for (let i = 1; i < line.length; i++) {
    const from = line[i - 1]!;
    const to = line[i]!;
    if (kmLngLat(from, to) <= FLIGHT_GAP_KM) {
      run.push(to);
      continue;
    }
    closeRun();
    const planned = flights.find((f) => {
      const start = f[0]!;
      const end = f[f.length - 1]!;
      return (
        kmLngLat(start, from) < FLIGHT_MATCH_KM && kmLngLat(end, to) < FLIGHT_MATCH_KM
      );
    });
    journey.push({ flight: true, points: planned ?? [from, to] });
    run = [to];
  }
  closeRun();
  return journey;
}

/** Drops small leading/trailing photo clusters that sit far from the trip's
 *  main body (a couple of snaps taken at home), so the globe line doesn't run
 *  from home to the first real destination. */
function trimOutlierEnds(coords: [number, number][], jumpKm = 250, maxClusterPts = 3): [number, number][] {
  if (coords.length < 3) return coords;
  const clusters: [number, number][][] = [];
  let cur: [number, number][] = [coords[0]!];
  for (let i = 1; i < coords.length; i++) {
    if (kmLngLat(coords[i - 1]!, coords[i]!) > jumpKm) {
      clusters.push(cur);
      cur = [coords[i]!];
    } else {
      cur.push(coords[i]!);
    }
  }
  clusters.push(cur);
  if (clusters.length < 2) return coords;
  while (clusters.length > 1 && clusters[0]!.length <= maxClusterPts) clusters.shift();
  while (clusters.length > 1 && clusters[clusters.length - 1]!.length <= maxClusterPts) clusters.pop();
  return clusters.flat();
}

/** Evenly thins a polyline to at most `max` points (keeps first & last). */
function downsample(points: [number, number][], max: number): [number, number][] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}

type RawMember = {
  userId: string;
  role: TripRole;
  canTrack: boolean;
  user: { displayName: string; username: string; avatarMime: string | null };
};

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(ownerId: string, dto: CreateTripDto): Promise<TripWithMembers> {
    const { startDate, endDate } = parseDates(dto.startDate, dto.endDate);
    const trip = await this.prisma.trip.create({
      data: {
        ...(dto.id ? { id: dto.id } : {}),
        title: dto.title.trim(),
        description: dto.description?.trim(),
        startDate,
        endDate,
        ownerId,
        members: { create: { userId: ownerId, role: TripRole.OWNER } },
      },
      include: MEMBERS_INCLUDE,
    });
    return mapMembers(trip);
  }

  async listForUser(userId: string): Promise<TripWithMembers[]> {
    const trips = await this.prisma.trip.findMany({
      where: { members: { some: { userId } } },
      orderBy: { startDate: 'desc' },
      include: MEMBERS_INCLUDE,
    });
    if (trips.length === 0) return [];

    // One grouped query for route distance per trip (cheap panel stat).
    const distances = await this.prisma.$queryRaw<{ tripId: string; meters: number | null }[]>`
      SELECT "tripId", ST_Length(ST_MakeLine(geom ORDER BY "recordedAt")::geography) AS meters
      FROM location_points
      WHERE "tripId" = ANY(${trips.map((t) => t.id)}::uuid[])
      GROUP BY "tripId"
    `;
    const kmByTrip = new Map(
      distances.map((d) => [d.tripId, Math.round((d.meters ?? 0) / 1000)]),
    );

    // Simplified tracked route per trip, as GeoJSON, for the globe overview.
    // The tolerance is in degrees: 0.05 is roughly 5 km, between the 0.08 this
    // used to be and the 0.03 it briefly was. Finer than the coastline it is
    // drawn over looks stranger than coarser does — a route threading past
    // headlands the land outline does not have reads as a mistake — and the
    // home screen asks for every trip at once, so the line has to stay cheap.
    const tripIds = trips.map((t) => t.id);
    const routeRows = await this.prisma.$queryRaw<{ tripId: string; geojson: string | null }[]>`
      SELECT "tripId",
             ST_AsGeoJSON(ST_Simplify(ST_MakeLine(geom ORDER BY "recordedAt"), 0.05)) AS geojson
      FROM location_points
      WHERE "tripId" = ANY(${tripIds}::uuid[])
      GROUP BY "tripId"
    `;
    const routeByTrip = new Map<string, [number, number][]>();
    for (const row of routeRows) {
      if (!row.geojson) continue;
      try {
        const geom = JSON.parse(row.geojson) as { type: string; coordinates: number[][] };
        if (geom.type === 'LineString' && geom.coordinates.length >= 2) {
          // A tracked GPS route is real travel — keep it whole, NL included (an
          // interrail trip that starts at home must still show that leg). Only
          // photo-derived lines strip NL (a home snapshot isn't a journey).
          routeByTrip.set(row.tripId, geom.coordinates as [number, number][]);
        }
      } catch {
        /* ignore malformed geometry */
      }
    }

    // Planned route for trips without a tracked route. Flight legs are drawn as
    // great-circle arcs (through any airports/layovers) so they read as flights,
    // even standalone heen-/terugvlucht stops that have no city coordinates.
    const plannedStops = await this.prisma.stop.findMany({
      where: { tripId: { in: tripIds } },
      orderBy: [{ tripId: 'asc' }, { orderIndex: 'asc' }],
      select: {
        id: true,
        tripId: true,
        parentStopId: true,
        latitude: true,
        longitude: true,
        travelMode: true,
        fromAirport: true,
        toAirport: true,
        viaAirports: true,
        hideLeg: true,
      },
    });
    const asLngLat = (c: [number, number] | null): [number, number] | null =>
      c ? [c[1], c[0]] : null; // airportCoord is [lat,lon]
    const rawByTrip = new Map<string, (typeof plannedStops)[number][]>();
    for (const s of plannedStops) {
      const list = rawByTrip.get(s.tripId) ?? [];
      list.push(s);
      rawByTrip.set(s.tripId, list);
    }
    // Planned ground route as connected segments, broken at each flight leg.
    const stopsByTrip = new Map<string, [number, number][][]>();
    // Flight legs kept separately so the globe draws them as thin dashed arcs.
    const flightsByTrip = new Map<string, [number, number][][]>();
    // The same legs, but kept in the order they are travelled (see JourneyLeg).
    const journeyByTrip = new Map<string, JourneyLeg[]>();
    for (const [tripId, all] of rawByTrip) {
      // Day trips branch off the route rather than being part of it, so the
      // main line is built from the route stops only.
      const list = all.filter((s) => !s.parentStopId);
      // Built as ONE ordered list and split afterwards, so the ground segments,
      // the flights and the order can never disagree with each other.
      const journey: JourneyLeg[] = [];
      let seg: [number, number][] = [];
      const closeGround = () => {
        if (seg.length >= 2) journey.push({ flight: false, points: seg });
        seg = [];
      };
      let prev: [number, number] | null = null;
      for (const s of list) {
        const dep = asLngLat(airportCoord(s.fromAirport));
        const arr = asLngLat(airportCoord(s.toAirport));
        const city: [number, number] | null =
          s.longitude != null && s.latitude != null ? [s.longitude, s.latitude] : null;
        const from = dep ?? prev;
        const to = arr ?? city;
        if (!to) continue;
        if (s.travelMode === 'FLIGHT' && from) {
          // Flight arc goes to flightPath; the ground line is broken here so no
          // straight coloured line is drawn under the flight.
          const via = (s.viaAirports ?? [])
            .map((c) => asLngLat(airportCoord(c)))
            .filter((c): c is [number, number] => !!c);
          // One entry per flight, holding the whole itinerary including its
          // layovers: [AMS, KEF, JFK]. The globe bows each hop separately but
          // only treats the OUTER ends as places you visited — a layover is an
          // airport you changed planes at, so it gets a grey airport dot, never
          // a coloured trip dot.
          closeGround();
          journey.push({ flight: true, points: [from, ...via, to] });
          prev = to; // ground resumes from the arrival
          continue;
        }
        // A leg somebody hid draws nothing, but the stop after it is still on
        // the route: break the line here and pick it up from this stop.
        if (s.hideLeg) {
          closeGround();
          seg.push(to);
          prev = to;
          continue;
        }
        if (seg.length === 0 && from) seg.push(from);
        seg.push(to);
        prev = to;
      }
      closeGround();
      if (journey.length > 0) journeyByTrip.set(tripId, journey);

      const segments = journey.filter((l) => !l.flight).map((l) => l.points);
      const flights = journey.filter((l) => l.flight).map((l) => l.points);

      // Day trips as a spur: a short line from the stop you slept at out to the
      // place you went for the day. It gets its own coloured dot at the end,
      // and it never joins the through-route.
      const byId = new Map(all.map((s) => [s.id, s]));
      for (const s of all) {
        if (!s.parentStopId || s.latitude == null || s.longitude == null) continue;
        const parent = byId.get(s.parentStopId);
        if (!parent || parent.latitude == null || parent.longitude == null) continue;
        segments.push([
          [parent.longitude, parent.latitude],
          [s.longitude, s.latitude],
        ]);
      }

      if (segments.length > 0) stopsByTrip.set(tripId, segments);
      if (flights.length > 0) flightsByTrip.set(tripId, flights);
    }

    // Photo-GPS fallback: trips with no track and no planned stops still show
    // on the globe from their geotagged Immich photos (ordered by time).
    const photos = await this.prisma.mediaRef.findMany({
      where: { tripId: { in: tripIds }, latitude: { not: null }, longitude: { not: null } },
      orderBy: [{ tripId: 'asc' }, { takenAt: 'asc' }],
      select: { tripId: true, latitude: true, longitude: true },
    });
    const photosByTrip = new Map<string, [number, number][]>();
    for (const p of photos) {
      const list = photosByTrip.get(p.tripId) ?? [];
      list.push([p.longitude!, p.latitude!]);
      photosByTrip.set(p.tripId, list);
    }
    for (const [tripId, line] of photosByTrip) {
      photosByTrip.set(tripId, trimOutlierEnds(stripHomeCountry(line)));
    }

    return trips.map((t) => {
      const base = mapMembers(t);
      const tracked = routeByTrip.get(t.id);
      const planned = stopsByTrip.get(t.id);
      const photoLine = photosByTrip.get(t.id);
      const routePath: [number, number][][] | undefined =
        tracked && tracked.length >= 2
          ? [tracked]
          : planned && planned.length > 0
            ? planned
            : photoLine && photoLine.length >= 2
              ? [downsample(photoLine, 80)]
              : undefined;
      const anchor = base.anchor ?? photoLine?.[0] ?? null;
      const flightPath = flightsByTrip.get(t.id);
      // Whichever line is actually drawn is the one the journey describes: the
      // recording when there is one (which carries its own order, having been
      // built in time order), otherwise the plan.
      const journey =
        tracked && tracked.length >= 2
          ? trackedJourney(tracked, flightPath ?? [])
          : journeyByTrip.get(t.id);
      return {
        ...base,
        anchor,
        distanceKm: kmByTrip.get(t.id) ?? 0,
        routePath,
        flightPath,
        journey,
      };
    });
  }

  /** Returns the trip if `userId` is a member; 404 otherwise (no existence leak). */
  async getForMember(tripId: string, userId: string): Promise<TripWithMembers> {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, members: { some: { userId } } },
      include: MEMBERS_INCLUDE,
    });
    if (!trip) {
      throw new NotFoundException('Trip not found');
    }
    return mapMembers(trip);
  }

  async update(tripId: string, userId: string, dto: UpdateTripDto): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);

    const { startDate, endDate } = parseDates(
      dto.startDate ?? trip.startDate.toISOString(),
      dto.endDate ?? trip.endDate.toISOString(),
    );

    // Cover must reference a photo that actually belongs to this trip.
    if (dto.coverMediaId) {
      const media = await this.prisma.mediaRef.findFirst({
        where: { id: dto.coverMediaId, tripId },
      });
      if (!media) {
        throw new BadRequestException('coverMediaId is not a photo of this trip');
      }
    }

    // Shortening a trip must drop the photos that now fall outside it, or the
    // timeline keeps showing days the trip no longer covers.
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      const until = new Date(endDate.getTime() + 86_400_000); // end date inclusive
      await this.prisma.mediaRef.deleteMany({
        where: { tripId, OR: [{ takenAt: { lt: startDate } }, { takenAt: { gte: until } }] },
      });
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        startDate,
        endDate,
        ...(dto.coverMediaId !== undefined ? { coverMediaId: dto.coverMediaId } : {}),
        ...(dto.autoTrack !== undefined ? { autoTrack: dto.autoTrack } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.markerLng !== undefined ? { markerLng: dto.markerLng } : {}),
        ...(dto.markerLat !== undefined ? { markerLat: dto.markerLat } : {}),
      },
      include: MEMBERS_INCLUDE,
    });
    return mapMembers(updated);
  }

  /** Headline numbers for the trip: distance, countries, days, photos. */
  async getStats(tripId: string, userId: string): Promise<TripStats> {
    await this.getForMember(tripId, userId);
    return this.getStatsUnchecked(tripId);
  }

  /** Same numbers without a membership check — for share links. */
  async getStatsUnchecked(tripId: string): Promise<TripStats> {
    const trip = await this.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });

    const [distanceRow] = await this.prisma.$queryRaw<{ meters: number | null }[]>`
      SELECT ST_Length(
        ST_MakeLine(geom ORDER BY "recordedAt")::geography
      ) AS meters
      FROM location_points
      WHERE "tripId" = ${tripId}::uuid
    `;

    const [photoCount, stopCountries, orderedStops] = await Promise.all([
      this.prisma.mediaRef.count({ where: { tripId } }),
      this.prisma.stop.findMany({
        where: { tripId, countryCode: { not: null } },
        select: { countryCode: true },
        distinct: ['countryCode'],
      }),
      this.prisma.stop.findMany({
        where: { tripId },
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
          travelMode: true,
          parentStopId: true,
        },
      }),
    ]);

    // A manually-entered begin/end leg (Heenreis/Terugreis by any ground mode)
    // with its own coordinate adds that driven stretch to the total — it's the
    // part from/to home that usually isn't GPS-tracked. Flights don't count as
    // "driven" kilometres.
    const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);
    const hasCoord = (s: { latitude: number | null; longitude: number | null }) =>
      s.latitude != null && s.longitude != null;
    const cities = orderedStops.filter(
      (s) => hasCoord(s) && !LEG_NAMES.has(s.name) && !s.parentStopId,
    );
    let extraKm = 0;

    // A day trip is a there-and-back detour from the stop you slept at, and
    // those kilometres are never tracked (you leave the phone's route as one
    // long stay), so they're added from the plan.
    const stopById = new Map(orderedStops.map((s) => [s.id, s]));
    for (const s of orderedStops) {
      if (!s.parentStopId || !hasCoord(s)) continue;
      const parent = stopById.get(s.parentStopId);
      if (!parent || !hasCoord(parent)) continue;
      extraKm +=
        2 * kmLngLat([s.longitude!, s.latitude!], [parent.longitude!, parent.latitude!]);
    }

    orderedStops.forEach((s, i) => {
      if (!hasCoord(s) || !LEG_NAMES.has(s.name) || s.travelMode === 'FLIGHT') return;
      // Leading leg connects to the first city, trailing leg to the last city.
      const neighbour = i === 0 ? cities[0] : cities[cities.length - 1];
      if (neighbour) {
        extraKm += kmLngLat(
          [s.longitude!, s.latitude!],
          [neighbour.longitude!, neighbour.latitude!],
        );
      }
    });

    const days =
      Math.round(
        (trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000,
      ) + 1;

    return {
      distanceKm: Math.round((distanceRow?.meters ?? 0) / 1000 + extraKm),
      // Home country doesn't count as a "country visited" — a trip that starts
      // and ends in NL isn't a trip to the Netherlands.
      countries: stopCountries
        .map((s) => s.countryCode!)
        .filter((c) => c && c.toUpperCase() !== HOME_COUNTRY),
      days,
      photoCount,
    };
  }

  async remove(tripId: string, userId: string): Promise<void> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);
    await this.prisma.trip.delete({ where: { id: tripId } });
  }

  /**
   * Puts one or more handles on the trip.
   *
   * All or nothing: a list with one unknown name is rejected whole, so what the
   * picker shows afterwards is never half of what you ticked.
   */
  async addMembersByUsername(
    tripId: string,
    userId: string,
    usernames: string[],
  ): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);

    const wanted = [
      ...new Set(usernames.map((u) => u.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)),
    ];
    if (wanted.length === 0) {
      throw new BadRequestException('No username given');
    }

    const invitees = await this.prisma.user.findMany({
      where: { username: { in: wanted } },
      select: { id: true, username: true },
    });
    const missing = wanted.filter((u) => !invitees.some((i) => i.username === u));
    if (missing.length > 0) {
      throw new NotFoundException(
        missing.length === 1
          ? `Geen account met de naam @${missing[0]} op deze server`
          : `Geen account gevonden voor: ${missing.map((m) => `@${m}`).join(', ')}`,
      );
    }

    // seen: false — being put on someone else's trip is news, and the app says
    // so once. skipDuplicates keeps a re-add from resetting that for people who
    // were already on the trip.
    await this.prisma.tripMember.createMany({
      data: invitees.map((i) => ({
        tripId,
        userId: i.id,
        role: TripRole.MEMBER,
        seen: i.id === userId,
      })),
      skipDuplicates: true,
    });
    // The popup at launch says it once; the bell keeps it until it is read.
    await this.notifications.tripAdded(
      invitees.map((i) => i.id),
      tripId,
      userId,
    );

    return this.getForMember(tripId, userId);
  }

  /**
   * Trips somebody else added you to that you have not been told about yet.
   * Read once at launch; the app announces them and marks them seen.
   */
  async listUnseenMemberships(
    userId: string,
  ): Promise<{ id: string; title: string; ownerName: string; coverId: string | null }[]> {
    const rows = await this.prisma.tripMember.findMany({
      where: { userId, seen: false },
      select: {
        trip: {
          select: {
            id: true,
            title: true,
            coverMediaId: true,
            // Something to look at, when there is something: the trip's cover,
            // or the first photo on it.
            mediaRefs: { take: 1, orderBy: { takenAt: 'asc' }, select: { id: true } },
            owner: { select: { displayName: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => ({
      id: r.trip.id,
      title: r.trip.title,
      ownerName: r.trip.owner.displayName,
      coverId: r.trip.coverMediaId ?? r.trip.mediaRefs[0]?.id ?? null,
    }));
  }

  async markMembershipsSeen(userId: string): Promise<void> {
    await this.prisma.tripMember.updateMany({
      where: { userId, seen: false },
      data: { seen: true },
    });
  }

  async removeMember(tripId: string, userId: string, memberId: string): Promise<void> {
    const trip = await this.getForMember(tripId, userId);
    // Owners can remove anyone; members may remove themselves (leave).
    if (userId !== memberId) {
      this.assertOwner(trip, userId);
    }
    if (memberId === trip.ownerId) {
      throw new BadRequestException('The owner cannot leave their own trip');
    }
    await this.prisma.tripMember.delete({
      where: { tripId_userId: { tripId, userId: memberId } },
    });
  }

  private assertOwner(trip: Trip, userId: string): void {
    if (trip.ownerId !== userId) {
      throw new ForbiddenException('Only the trip owner can do this');
    }
  }

  /** Trip for a caller allowed to edit it (owner or reisgenoot, not a guest). */
  async getForEditor(tripId: string, userId: string): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, userId);
    const me = trip.members.find((m) => m.userId === userId);
    if (!me || me.role === TripRole.GUEST) {
      throw new ForbiddenException('Guests can only view this trip');
    }
    return trip;
  }

  /** Throws unless the caller may record their own track for this trip. */
  async assertCanTrack(tripId: string, userId: string): Promise<void> {
    const trip = await this.getForMember(tripId, userId);
    const me = trip.members.find((m) => m.userId === userId);
    if (!me || me.role === TripRole.GUEST || (me.role !== TripRole.OWNER && !me.canTrack)) {
      throw new ForbiddenException('You do not have permission to track on this trip');
    }
  }

  /** Owner updates a member's role and/or tracking permission. */
  async updateMember(
    tripId: string,
    ownerId: string,
    memberId: string,
    dto: { role?: TripRole; canTrack?: boolean },
  ): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, ownerId);
    this.assertOwner(trip, ownerId);
    if (memberId === trip.ownerId) {
      throw new BadRequestException('The owner role cannot be changed');
    }
    await this.prisma.tripMember.update({
      where: { tripId_userId: { tripId, userId: memberId } },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.canTrack !== undefined ? { canTrack: dto.canTrack } : {}),
      },
    });
    // Turned down to guest: their photos leave the trip with them. The Immich
    // sync stops adding new ones, but what earlier runs put there has to go
    // now — the demotion is meant to take effect on the page, not in a
    // quarter of an hour, and only for a trip that is still syncing.
    if (dto.role === TripRole.GUEST) {
      await this.prisma.mediaRef.deleteMany({ where: { tripId, userId: memberId } });
    }
    return this.getForMember(tripId, ownerId);
  }
}

function parseDates(start: string, end: string): { startDate: Date; endDate: Date } {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (endDate < startDate) {
    throw new BadRequestException('endDate must be on or after startDate');
  }
  return { startDate, endDate };
}
