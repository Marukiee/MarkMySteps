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
  /** Simplified [lng,lat] polyline for the globe overview (listForUser only). */
  routePath?: [number, number][];
  /** Flight legs as separate great-circle arcs, drawn dashed on the globe. */
  flightPath?: [number, number][][];
};

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
  // A geo anchor for the globe overview: prefer a planned stop's city.
  stops: {
    where: { latitude: { not: null } },
    take: 1,
    orderBy: { orderIndex: 'asc' },
    select: { latitude: true, longitude: true },
  },
} as const;

export interface TripStats {
  distanceKm: number;
  countries: string[];
  days: number;
  photoCount: number;
}

type RawStop = { latitude: number | null; longitude: number | null };

type RawTripRow = Trip & {
  members: RawMember[];
  mediaRefs: { id: string }[];
  stops: RawStop[];
};

/** Maps Prisma rows (avatarMime, mediaRefs, stops) to the API shape. */
function mapMembers(trip: RawTripRow): TripWithMembers {
  const { mediaRefs, stops, members, ...rest } = trip;
  const stop = stops[0];
  const anchor: [number, number] | null =
    stop?.latitude != null && stop.longitude != null ? [stop.longitude, stop.latitude] : null;
  return {
    ...rest,
    resolvedCoverId: trip.coverMediaId ?? mediaRefs[0]?.id ?? null,
    anchor,
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      user: {
        displayName: m.user.displayName,
        username: m.user.username,
        hasAvatar: m.user.avatarMime !== null,
      },
    })),
  };
}

/** Great-circle arc between two [lng,lat] points as `steps`+1 points. */
function greatCircle(a: [number, number], b: [number, number], steps: number): [number, number][] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const [lon1, lat1] = [a[0] * toRad, a[1] * toRad];
  const [lon2, lat2] = [b[0] * toRad, b[1] * toRad];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  if (d === 0) return [a, b];
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([Math.atan2(y, x) * toDeg, Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg]);
  }
  return out;
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
             ST_AsGeoJSON(ST_Simplify(ST_MakeLine(geom ORDER BY "recordedAt"), 0.35)) AS geojson
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
    const stopsByTrip = new Map<string, [number, number][]>();
    // Flight legs kept separately so the globe can draw them as thin dashed arcs
    // regardless of whether the trip's main line is tracked or planned.
    const flightsByTrip = new Map<string, [number, number][][]>();
    for (const [tripId, list] of rawByTrip) {
      const line: [number, number][] = [];
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
          // Build the flight arc as its own segment (through any layovers). The
          // main line only gets the endpoints, so splitOnGaps breaks it and the
          // dashed arc bridges the gap — no coloured ground line under a flight.
          const via = (s.viaAirports ?? [])
            .map((c) => asLngLat(airportCoord(c)))
            .filter((c): c is [number, number] => !!c);
          const pts = [from, ...via, to];
          const flightSeg: [number, number][] = [];
          for (let k = 1; k < pts.length; k++) {
            const arc = greatCircle(pts[k - 1]!, pts[k]!, 24);
            flightSeg.push(...(flightSeg.length === 0 ? arc : arc.slice(1)));
          }
          if (flightSeg.length >= 2) flights.push(flightSeg);
        }
        if (line.length === 0 && from) line.push(from);
        line.push(to);
        prev = to;
      }
      if (line.length >= 2) stopsByTrip.set(tripId, line);
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

    return trips.map((t) => {
      const base = mapMembers(t);
      const tracked = routeByTrip.get(t.id);
      const planned = stopsByTrip.get(t.id);
      const photoLine = photosByTrip.get(t.id);
      const routePath =
        tracked && tracked.length >= 2
          ? tracked
          : planned && planned.length >= 2
            ? planned
            : photoLine && photoLine.length >= 2
              ? downsample(photoLine, 80)
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

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        startDate,
        endDate,
        ...(dto.coverMediaId !== undefined ? { coverMediaId: dto.coverMediaId } : {}),
        ...(dto.autoTrack !== undefined ? { autoTrack: dto.autoTrack } : {}),
      },
      include: MEMBERS_INCLUDE,
    });
    return mapMembers(updated);
  }

  /** Headline numbers for the trip: distance, countries, days, photos. */
  async getStats(tripId: string, userId: string): Promise<TripStats> {
    const trip = await this.getForMember(tripId, userId);

    const [distanceRow] = await this.prisma.$queryRaw<{ meters: number | null }[]>`
      SELECT ST_Length(
        ST_MakeLine(geom ORDER BY "recordedAt")::geography
      ) AS meters
      FROM location_points
      WHERE "tripId" = ${tripId}::uuid
    `;

    const [photoCount, stopCountries] = await Promise.all([
      this.prisma.mediaRef.count({ where: { tripId } }),
      this.prisma.stop.findMany({
        where: { tripId, countryCode: { not: null } },
        select: { countryCode: true },
        distinct: ['countryCode'],
      }),
    ]);

    const days =
      Math.round(
        (trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000,
      ) + 1;

    return {
      distanceKm: Math.round((distanceRow?.meters ?? 0) / 1000),
      countries: stopCountries.map((s) => s.countryCode!).filter(Boolean),
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
}

function parseDates(start: string, end: string): { startDate: Date; endDate: Date } {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (endDate < startDate) {
    throw new BadRequestException('endDate must be on or after startDate');
  }
  return { startDate, endDate };
}
