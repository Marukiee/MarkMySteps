import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Trip, TripRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { airportCoord } from '../common/airports';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';

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
  /** Route distance in km (0 when unknown); only populated by listForUser. */
  distanceKm?: number;
  /**
   * Route for the globe overview as one or more polyline segments (listForUser
   * only). Ground legs stay connected; the line is broken at flights so a flight
   * never shows as a straight coloured line — flightPath draws the arc instead.
   */
  routePath?: [number, number][][];
  /** Flight legs as separate great-circle arcs, drawn dashed on the globe. */
  flightPath?: [number, number][][];
};

/** Country you live in — excluded from a trip's "countries visited" count. */
const HOME_COUNTRY = 'NL';

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
  // A geo anchor for the globe overview: the planned stops, in order.
  stops: {
    where: { latitude: { not: null } },
    orderBy: { orderIndex: 'asc' },
    select: { name: true, latitude: true, longitude: true },
  },
} as const;

export interface TripStats {
  distanceKm: number;
  countries: string[];
  days: number;
  photoCount: number;
}

type RawStop = { name: string; latitude: number | null; longitude: number | null };

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
  const cities = stops.filter((s) => !ANCHOR_SKIP.has(s.name));
  const usable = (cities.length > 0 ? cities : stops).filter(
    (s): s is { name: string; latitude: number; longitude: number } =>
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
  return {
    ...rest,
    resolvedCoverId: trip.coverMediaId ?? mediaRefs[0]?.id ?? null,
    anchor,
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
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateTripDto): Promise<TripWithMembers> {
    const { startDate, endDate } = parseDates(dto.startDate, dto.endDate);
    const trip = await this.prisma.trip.create({
      data: {
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
    const tripIds = trips.map((t) => t.id);
    const routeRows = await this.prisma.$queryRaw<{ tripId: string; geojson: string | null }[]>`
      SELECT "tripId",
             ST_AsGeoJSON(ST_Simplify(ST_MakeLine(geom ORDER BY "recordedAt"), 0.08)) AS geojson
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
        tripId: true,
        latitude: true,
        longitude: true,
        travelMode: true,
        fromAirport: true,
        toAirport: true,
        viaAirports: true,
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
    for (const [tripId, list] of rawByTrip) {
      const segments: [number, number][][] = [];
      let seg: [number, number][] = [];
      const flights: [number, number][][] = [];
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
          const pts = [from, ...via, to];
          // Emit each hop as its own endpoint pair so a layover flight draws as
          // TWO separate bows on the globe (AMS→KEF, KEF→JFK), not one arc that
          // skips the stopover.
          for (let k = 1; k < pts.length; k++) {
            flights.push([pts[k - 1]!, pts[k]!]);
          }
          if (seg.length >= 2) segments.push(seg);
          seg = [];
          prev = to; // ground resumes from the arrival
          continue;
        }
        if (seg.length === 0 && from) seg.push(from);
        seg.push(to);
        prev = to;
      }
      if (seg.length >= 2) segments.push(seg);
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
      return { ...base, anchor, distanceKm: kmByTrip.get(t.id) ?? 0, routePath, flightPath };
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
        select: { name: true, latitude: true, longitude: true, travelMode: true },
      }),
    ]);

    // A manually-entered begin/end leg (Heenreis/Terugreis by any ground mode)
    // with its own coordinate adds that driven stretch to the total — it's the
    // part from/to home that usually isn't GPS-tracked. Flights don't count as
    // "driven" kilometres.
    const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);
    const hasCoord = (s: { latitude: number | null; longitude: number | null }) =>
      s.latitude != null && s.longitude != null;
    const cities = orderedStops.filter((s) => hasCoord(s) && !LEG_NAMES.has(s.name));
    let extraKm = 0;
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

  async addMemberByUsername(
    tripId: string,
    userId: string,
    username: string,
  ): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);

    const invitee = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase().replace(/^@/, '') },
    });
    if (!invitee) {
      throw new NotFoundException('No account with that username on this server');
    }

    await this.prisma.tripMember.upsert({
      where: { tripId_userId: { tripId, userId: invitee.id } },
      create: { tripId, userId: invitee.id, role: TripRole.MEMBER },
      update: {},
    });

    return this.getForMember(tripId, userId);
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
