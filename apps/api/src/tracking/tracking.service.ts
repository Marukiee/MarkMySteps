import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LocationPoint, PointSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';
import { ManualPointDto, TrackPointDto } from './dto/track-points.dto';

export interface BatchResult {
  received: number;
  added: number;
}

export interface RouteFeature {
  type: 'Feature';
  geometry: unknown; // GeoJSON LineString
  properties: {
    userId: string;
    displayName: string;
    pointCount: number;
  };
}

export interface RouteCollection {
  type: 'FeatureCollection';
  features: RouteFeature[];
}

/** One raw stored fix, as shown in the day editor. */
export interface TrackedPoint {
  id: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracy: number | null;
  source: PointSource;
}

export interface LiveFix {
  userId: string;
  displayName: string;
  hasAvatar: boolean;
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracy: number | null;
}

/** Simplification tolerance in degrees (~33 m at the equator) to smooth out indoor stay jitter. */
const DEFAULT_TOLERANCE = 0.0003;
const MAX_TOLERANCE = 0.01;

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  /** Idempotent batch ingest: duplicates (same clientId) are skipped. */
  async ingestBatch(
    tripId: string,
    userId: string,
    points: TrackPointDto[],
  ): Promise<BatchResult> {
    await this.trips.assertCanTrack(tripId, userId);

    const { count } = await this.prisma.locationPoint.createMany({
      data: points.map((p) => ({
        tripId,
        userId,
        clientId: p.clientId,
        recordedAt: new Date(p.recordedAt),
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        altitude: p.altitude,
        source: PointSource.TRACKED,
      })),
      skipDuplicates: true,
    });

    return { received: points.length, added: count };
  }

  /** Manual/imported waypoints for shaping the route, oldest first. */
  async listManualPoints(
    tripId: string,
    userId: string,
  ): Promise<{ id: string; latitude: number; longitude: number; recordedAt: string }[]> {
    await this.trips.getForMember(tripId, userId);
    const points = await this.prisma.locationPoint.findMany({
      where: { tripId, source: PointSource.MANUAL },
      orderBy: { recordedAt: 'asc' },
      select: { id: true, latitude: true, longitude: true, recordedAt: true },
    });
    return points.map((p) => ({ ...p, recordedAt: p.recordedAt.toISOString() }));
  }

  /**
   * Every one of the caller's OWN points for one calendar day, raw and
   * unsimplified — this is the editing view, where you check whether the route
   * actually matches where you went and drag the odd fix into place.
   */
  async listDayPoints(tripId: string, userId: string, day: string): Promise<TrackedPoint[]> {
    await this.trips.getForMember(tripId, userId);
    const start = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('day must be YYYY-MM-DD');
    }
    const points = await this.prisma.locationPoint.findMany({
      where: {
        tripId,
        userId,
        recordedAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) },
      },
      orderBy: { recordedAt: 'asc' },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        recordedAt: true,
        accuracy: true,
        source: true,
      },
    });
    return points.map((p) => ({
      id: p.id,
      latitude: p.latitude,
      longitude: p.longitude,
      recordedAt: p.recordedAt.toISOString(),
      accuracy: p.accuracy,
      source: p.source,
    }));
  }

  /** Which days of the trip the caller has points for, newest first. */
  async listTrackedDays(tripId: string, userId: string): Promise<{ day: string; count: number }[]> {
    await this.trips.getForMember(tripId, userId);
    const rows = await this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "recordedAt") AS day, COUNT(*) AS count
      FROM location_points
      WHERE "tripId" = ${tripId}::uuid AND "userId" = ${userId}::uuid
      GROUP BY 1
      ORDER BY 1 DESC
    `;
    return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: Number(r.count) }));
  }

  /** Drag a point to where you actually were. Only your own points. */
  async movePoint(
    tripId: string,
    userId: string,
    pointId: string,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    const { count } = await this.prisma.locationPoint.updateMany({
      where: { id: pointId, tripId, userId },
      data: { latitude, longitude },
    });
    if (count === 0) throw new NotFoundException('Point not found');
  }

  /** Hand-placed point to complete a route where tracking has gaps. */
  async addManualPoint(
    tripId: string,
    userId: string,
    dto: ManualPointDto,
  ): Promise<LocationPoint> {
    await this.trips.getForEditor(tripId, userId);
    return this.prisma.locationPoint.create({
      data: {
        tripId,
        userId,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        source: PointSource.MANUAL,
      },
    });
  }

  /** Users may only delete their own points. */
  async removePoint(tripId: string, userId: string, pointId: string): Promise<void> {
    const { count } = await this.prisma.locationPoint.deleteMany({
      where: { id: pointId, tripId, userId },
    });
    if (count === 0) {
      throw new NotFoundException('Point not found');
    }
  }

  /**
   * Wipes the caller's own tracked/imported route data for a trip (keeps
   * manual waypoints). With `day` (YYYY-MM-DD) only that calendar day is
   * cleared. The trip itself is untouched.
   */
  async clearTracked(
    tripId: string,
    userId: string,
    day?: string,
  ): Promise<{ deleted: number }> {
    await this.trips.getForMember(tripId, userId);
    const where: Prisma.LocationPointWhereInput = {
      tripId,
      userId,
      source: {
        in: [PointSource.TRACKED, PointSource.IMPORTED, PointSource.MANUAL, PointSource.ROUTE_FILL],
      },
    };
    if (day) {
      const start = new Date(`${day}T00:00:00.000Z`);
      if (Number.isNaN(start.getTime())) {
        throw new NotFoundException('Invalid day');
      }
      where.recordedAt = { gte: start, lt: new Date(start.getTime() + 86_400_000) };
    }
    const { count } = await this.prisma.locationPoint.deleteMany({ where });
    return { deleted: count };
  }

  /**
   * Per-traveller simplified routes as GeoJSON.
   *
   * Point sources are merged on the server: recorded GPS fixes plus photo
   * EXIF locations (media_refs) — so a route appears even when someone
   * never ran the tracker, and photo spots fill tracking gaps. The merged
   * sequence is ordered by time, built into a line with ST_MakeLine and
   * reduced with ST_SimplifyPreserveTopology so the client never receives
   * thousands of raw points.
   */
  async getRoutes(
    tripId: string,
    requesterId: string,
    options: { userIds?: string[]; tolerance?: number; includePhotos?: boolean } = {},
  ): Promise<RouteCollection> {
    await this.trips.getForMember(tripId, requesterId);
    return this.getRoutesUnchecked(tripId, options);
  }

  /** No membership check — caller must have authorized access (share links). */
  /**
   * "Snap to roads": near a straight gap in the caller's own line, route the two
   * bracketing points over real roads (keyless OSM) and store the road polyline
   * as MANUAL points so the ugly straight stretch becomes a proper route.
   */
  async fillRoute(
    tripId: string,
    userId: string,
    lng: number,
    lat: number,
  ): Promise<{ added: number }> {
    await this.trips.getForEditor(tripId, userId);

    const rows = await this.prisma.$queryRaw<{ t: Date; lat: number; lng: number }[]>`
      SELECT t, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
      FROM (
        SELECT "recordedAt" AS t, geom FROM location_points
        WHERE "tripId" = ${tripId}::uuid AND "userId" = ${userId}::uuid
        UNION ALL
        SELECT "takenAt" AS t, geom FROM media_refs
        WHERE "tripId" = ${tripId}::uuid AND "userId" = ${userId}::uuid AND geom IS NOT NULL
      ) x
      ORDER BY t
    `;
    if (rows.length < 2) {
      throw new BadRequestException('Er is nog geen route om aan te vullen.');
    }

    // Nearest consecutive pair whose segment is a real gap (> 1.5 km).
    let best: { a: (typeof rows)[number]; b: (typeof rows)[number]; d: number } | null = null;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]!;
      const b = rows[i]!;
      if (segLenKm(a, b) < 1.5) continue;
      const d = pointToSegKm({ lat, lng }, a, b);
      if (!best || d < best.d) best = { a, b, d };
    }
    if (!best || best.d > 60) {
      throw new BadRequestException('Geen recht stuk in de buurt om aan te vullen.');
    }

    const road = await osrmRoute([best.a.lng, best.a.lat], [best.b.lng, best.b.lat]);
    if (road.length < 3) {
      throw new BadRequestException('Kon geen route over de weg vinden.');
    }

    // Keep only the intermediate vertices, and cap them so a long motorway
    // route never inserts thousands of points (which would choke the map).
    const tA = best.a.t.getTime();
    const tB = best.b.t.getTime();
    const inner = downsample(road.slice(1, -1), 120);
    const data = inner.map((c, i) => ({
      tripId,
      userId,
      clientId: randomUUID(),
      recordedAt: new Date(tA + ((i + 1) / (inner.length + 1)) * (tB - tA)),
      latitude: c[1],
      longitude: c[0],
      // Its own source so it can be removed separately, without touching real
      // tracked GPS, and it's not drawn as editable waypoint dots.
      source: PointSource.ROUTE_FILL,
    }));
    await this.prisma.locationPoint.createMany({ data, skipDuplicates: true });
    return { added: data.length };
  }

  /** Remove only the auto-drawn road routes (+ legacy manual fills). Real
   *  tracked/imported GPS is kept. */
  async clearRouteFills(tripId: string, userId: string): Promise<{ deleted: number }> {
    await this.trips.getForEditor(tripId, userId);
    const { count } = await this.prisma.locationPoint.deleteMany({
      where: { tripId, userId, source: { in: [PointSource.ROUTE_FILL, PointSource.MANUAL] } },
    });
    return { deleted: count };
  }

  /** Latest recent fix per travelling member — for the live "who's where" map. */
  async getLiveFixes(tripId: string, userId: string): Promise<LiveFix[]> {
    await this.trips.getForMember(tripId, userId);
    const rows = await this.prisma.$queryRaw<
      {
        userId: string;
        displayName: string;
        avatarMime: string | null;
        lat: number;
        lng: number;
        recordedAt: Date;
        accuracy: number | null;
      }[]
    >`
      SELECT DISTINCT ON (lp."userId")
        lp."userId",
        u."displayName",
        u."avatarMime",
        ST_Y(lp.geom::geometry) AS lat,
        ST_X(lp.geom::geometry) AS lng,
        lp."recordedAt",
        lp.accuracy
      FROM location_points lp
      JOIN users u ON u.id = lp."userId"
      WHERE lp."tripId" = ${tripId}::uuid
        AND lp."recordedAt" > now() - interval '2 days'
      ORDER BY lp."userId", lp."recordedAt" DESC
    `;
    return rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      hasAvatar: r.avatarMime !== null,
      latitude: r.lat,
      longitude: r.lng,
      recordedAt: r.recordedAt.toISOString(),
      accuracy: r.accuracy,
    }));
  }

  async getRoutesUnchecked(
    tripId: string,
    options: { userIds?: string[]; tolerance?: number; includePhotos?: boolean } = {},
  ): Promise<RouteCollection> {

    const tolerance = Math.min(Math.abs(options.tolerance ?? DEFAULT_TOLERANCE), MAX_TOLERANCE);
    const includePhotos = options.includePhotos ?? true;
    const userFilter =
      options.userIds && options.userIds.length > 0
        ? Prisma.sql`AND "userId" = ANY(${options.userIds}::uuid[])`
        : Prisma.empty;

    const photoSource = includePhotos
      ? Prisma.sql`
          UNION ALL
          SELECT "userId", "takenAt" AS t, geom
          FROM media_refs
          WHERE "tripId" = ${tripId}::uuid AND geom IS NOT NULL ${userFilter}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { userId: string; displayName: string; lat: number; lng: number }[]
    >`
      WITH pts AS (
        SELECT "userId", "recordedAt" AS t, geom
        FROM location_points
        WHERE "tripId" = ${tripId}::uuid ${userFilter}
        ${photoSource}
      )
      SELECT
        p."userId",
        u."displayName",
        ST_Y(p.geom::geometry) AS lat,
        ST_X(p.geom::geometry) AS lng
      FROM pts p
      JOIN users u ON u.id = p."userId"
      ORDER BY p."userId", p.t
    `;

    const byUser = new Map<string, { displayName: string; coords: [number, number][] }>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? { displayName: row.displayName, coords: [] };
      entry.coords.push([row.lng, row.lat]);
      byUser.set(row.userId, entry);
    }

    const features = [];
    for (const [userId, { displayName, coords }] of byUser) {
      if (coords.length < 2) continue;
      // Standing somewhere sprays fixes in a small web around one spot; each
      // such run collapses to its own centre, so a stay is a point on the line
      // instead of a scribble. Then the usual simplify thins the rest.
      const line = simplifyLine(collapseStays(coords), tolerance);
      if (line.length < 2) continue;
      features.push({
        type: 'Feature' as const,
        geometry: { type: 'LineString', coordinates: line } as unknown,
        properties: { userId, displayName, pointCount: coords.length },
      });
    }

    return { type: 'FeatureCollection', features };
  }
}

/** Radius (metres) within which consecutive fixes count as the same place. */
const STAY_RADIUS_M = 75;

/**
 * Replaces every run of consecutive points that stays inside STAY_RADIUS_M of
 * where the run began by the average of that run.
 */
function collapseStays(coords: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let anchor = coords[0]!;
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;

  const close = (): void => {
    if (n > 0) out.push([sumLng / n, sumLat / n]);
  };

  for (const c of coords) {
    const away =
      segLenKm({ lat: anchor[1], lng: anchor[0] }, { lat: c[1], lng: c[0] }) * 1000 >
      STAY_RADIUS_M;
    if (away) {
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
function simplifyLine(coords: [number, number][], tolerance: number): [number, number][] {
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
      const d = perpDistanceDeg(coords[i]!, coords[first]!, coords[last]!);
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

function perpDistanceDeg(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

type Pt = { lat: number; lng: number };

/** Local equirectangular scale (km per degree) around a latitude. */
function scale(lat: number): [number, number] {
  return [111.32 * Math.cos((lat * Math.PI) / 180), 110.57];
}

function segLenKm(a: Pt, b: Pt): number {
  const [kx, ky] = scale((a.lat + b.lat) / 2);
  return Math.hypot((b.lng - a.lng) * kx, (b.lat - a.lat) * ky);
}

function pointToSegKm(p: Pt, a: Pt, b: Pt): number {
  const [kx, ky] = scale(p.lat);
  const px = p.lng * kx;
  const py = p.lat * ky;
  const ax = a.lng * kx;
  const ay = a.lat * ky;
  const bx = b.lng * kx;
  const by = b.lat * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Keyless OSM routing (public OSRM). Returns the road polyline as [lng,lat][]. */
async function osrmRoute(
  a: [number, number],
  b: [number, number],
): Promise<[number, number][]> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${a[0]},${a[1]};${b[0]},${b[1]}?overview=simplified&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    routes?: { geometry?: { coordinates?: [number, number][] } }[];
  };
  return json.routes?.[0]?.geometry?.coordinates ?? [];
}

/** Evenly reduce a polyline to at most `max` points (endpoints kept). */
function downsample(pts: [number, number][], max: number): [number, number][] {
  if (pts.length <= max) return pts;
  const step = pts.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]!);
  return out;
}
