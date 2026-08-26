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

  /**
   * Idempotent batch ingest: duplicates (same clientId) are skipped.
   *
   * Nothing may be added to a trip that is over. A queue held on a phone with
   * no signal still lands — those fixes were recorded while the trip ran — but
   * anything stamped after the last day is dropped, from the owner and from
   * fellow travellers alike. A finished trip is finished.
   */
  async ingestBatch(
    tripId: string,
    userId: string,
    points: TrackPointDto[],
  ): Promise<BatchResult> {
    await this.trips.assertCanTrack(tripId, userId);
    const window = await this.tripWindow(tripId);

    const inTrip = points.filter((p) => {
      const at = new Date(p.recordedAt).getTime();
      return Number.isFinite(at) && at >= window.from && at <= window.to;
    });
    if (inTrip.length === 0) return { received: points.length, added: 0 };

    const { count } = await this.prisma.locationPoint.createMany({
      data: inTrip.map((p) => ({
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

  /**
   * The days a trip's own points may fall on: its start, through the end of
   * its last day.
   */
  private async tripWindow(tripId: string): Promise<{ from: number; to: number }> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { startDate: true, endDate: true },
    });
    return {
      from: trip.startDate.getTime(),
      // Dates are DATE columns, so the end date is midnight on the last day.
      to: trip.endDate.getTime() + 86_400_000,
    };
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

  /**
   * The trip's days that have anything on them, for everybody on it.
   *
   * The day picker offers what there is to see rather than every date between
   * the two ends of the trip: a day nobody tracked and nobody photographed
   * would filter the map down to nothing.
   */
  async listTripDays(
    tripId: string,
    userId: string,
  ): Promise<{ day: string; points: number; photos: number }[]> {
    await this.trips.getForMember(tripId, userId);
    const rows = await this.prisma.$queryRaw<{ day: Date; points: bigint; photos: bigint }[]>`
      SELECT
        date_trunc('day', t) AS day,
        SUM(CASE WHEN kind = 'point' THEN 1 ELSE 0 END) AS points,
        SUM(CASE WHEN kind = 'photo' THEN 1 ELSE 0 END) AS photos
      FROM (
        SELECT "recordedAt" AS t, 'point' AS kind
        FROM location_points WHERE "tripId" = ${tripId}::uuid
        UNION ALL
        SELECT "takenAt" AS t, 'photo' AS kind
        FROM media_refs WHERE "tripId" = ${tripId}::uuid
      ) x
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      points: Number(r.points),
      photos: Number(r.photos),
    }));
  }

  /** Drag a point to where you actually were. Only your own points. */
  async movePoint(
    tripId: string,
    userId: string,
    pointId: string,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    await this.trips.getForEditor(tripId, userId);
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
    const window = await this.tripWindow(tripId);
    const at = dto.recordedAt ? new Date(dto.recordedAt).getTime() : Date.now();
    if (!Number.isFinite(at) || at < window.from || at > window.to) {
      throw new BadRequestException('Dat moment valt buiten deze reis.');
    }
    return this.prisma.locationPoint.create({
      data: {
        tripId,
        userId,
        recordedAt: new Date(at),
        latitude: dto.latitude,
        longitude: dto.longitude,
        source: PointSource.MANUAL,
      },
    });
  }

  /** Users may only delete their own points. */
  async removePoint(tripId: string, userId: string, pointId: string): Promise<void> {
    await this.trips.getForEditor(tripId, userId);
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
    await this.trips.getForEditor(tripId, userId);
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
    options: { userIds?: string[]; tolerance?: number; includePhotos?: boolean; day?: string } = {},
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
    const gap = await this.findGap(tripId, userId, lng, lat);

    const road = await osrmRoute([gap.a.lng, gap.a.lat], [gap.b.lng, gap.b.lat]);
    if (road.length < 3) {
      throw new BadRequestException('Kon geen route over de weg vinden.');
    }

    // Keep only the intermediate vertices, and cap them so a long motorway
    // route never inserts thousands of points (which would choke the map).
    return this.storeFill(tripId, userId, gap, downsample(road.slice(1, -1), 120));
  }

  /**
   * The same gesture, over rails.
   *
   * A train is where the tracker gives up: a tunnel under the Pyrenees, a
   * steel carriage at three hundred an hour, and the line comes back an hour
   * later half a country away. The road router is no use — it would send the
   * route down the motorway alongside — so the two stations are asked for by
   * hand and the stretch between them is routed over real track.
   *
   * The stations are drawn into the line themselves, so the result runs from
   * the last fix before the train straight to the platform, along the rails,
   * and out of the far station to wherever the tracker picked up again. One
   * connected line, not a rail line floating loose beside the journey.
   */
  async fillTrainRoute(
    tripId: string,
    userId: string,
    lng: number,
    lat: number,
    from: { lng: number; lat: number },
    to: { lng: number; lat: number },
  ): Promise<{ added: number }> {
    await this.trips.getForEditor(tripId, userId);
    const gap = await this.findGap(tripId, userId, lng, lat);

    // Which station the journey left from follows from the gap, not from which
    // box they were typed into: entering them the other way round would
    // otherwise cross the line over itself.
    const straight =
      segLenKm(gap.a, from) + segLenKm(gap.b, to) <= segLenKm(gap.a, to) + segLenKm(gap.b, from);
    const dep = straight ? from : to;
    const arr = straight ? to : from;

    const rails = await railRoute([dep.lng, dep.lat], [arr.lng, arr.lat]);
    if (rails.length < 3) {
      throw new BadRequestException(
        'Kon geen spoorroute tussen die stations vinden. Buiten Europa kent de spoorkaart geen route.',
      );
    }

    // The stations themselves bracket the rails, so the line joins the track
    // either side of the gap instead of starting at whatever bit of rail the
    // router snapped to.
    const line: [number, number][] = [
      [dep.lng, dep.lat],
      ...downsample(rails, 150),
      [arr.lng, arr.lat],
    ];
    return this.storeFill(tripId, userId, gap, line);
  }

  /**
   * The nearest real gap in the caller's own line to where they pressed.
   *
   * Both drawing gestures work the same way: find the straight stretch that
   * was pressed, and hand back the two fixes that bracket it along with their
   * times, so whatever is drawn in between lands on the timeline where the
   * journey actually happened.
   */
  private async findGap(
    tripId: string,
    userId: string,
    lng: number,
    lat: number,
  ): Promise<{ a: Anchor; b: Anchor }> {
    const rows = await this.prisma.$queryRaw<Anchor[]>`
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

    // The planned stops count as anchors too. A straight line between two
    // stops that were never tracked is exactly the stretch somebody wants to
    // fill in, and without this the gesture answered "there is no route yet"
    // on precisely the trips that needed it. Their times come from the trip
    // start plus the nights before them — the same arithmetic the planner
    // shows — so they slot into the sequence where they belong.
    const planned = await this.plannedAnchors(tripId);
    const merged = [...rows, ...planned].sort((a, b) => a.t.getTime() - b.t.getTime());
    if (merged.length < 2) {
      throw new BadRequestException('Er is nog geen route om aan te vullen.');
    }

    // Nearest consecutive pair whose segment is a real gap (> 1.5 km).
    let best: { a: Anchor; b: Anchor; d: number } | null = null;
    for (let i = 1; i < merged.length; i++) {
      const a = merged[i - 1]!;
      const b = merged[i]!;
      if (segLenKm(a, b) < 1.5) continue;
      const d = pointToSegKm({ lat, lng }, a, b);
      if (!best || d < best.d) best = { a, b, d };
    }
    if (!best || best.d > 60) {
      throw new BadRequestException('Geen recht stuk in de buurt om aan te vullen.');
    }
    return { a: best.a, b: best.b };
  }

  /** Stores a drawn line as the stretch between two anchors, spread over the
   *  time the journey took. */
  private async storeFill(
    tripId: string,
    userId: string,
    gap: { a: Anchor; b: Anchor },
    line: [number, number][],
  ): Promise<{ added: number }> {
    const tA = gap.a.t.getTime();
    const tB = gap.b.t.getTime();
    const data = line.map((c, i) => ({
      tripId,
      userId,
      clientId: randomUUID(),
      recordedAt: new Date(tA + ((i + 1) / (line.length + 1)) * (tB - tA)),
      latitude: c[1],
      longitude: c[0],
      // Its own source so it can be removed separately, without touching real
      // tracked GPS, and it's not drawn as editable waypoint dots.
      source: PointSource.ROUTE_FILL,
    }));
    await this.prisma.locationPoint.createMany({ data, skipDuplicates: true });
    return { added: data.length };
  }

  /**
   * The trip's planned stops as timed points.
   *
   * Dates are never stored on a stop — they follow from the trip's start plus
   * the nights of everything before it — so they are worked out here. Day
   * trips are excursions, not legs, and are left out.
   */
  private async plannedAnchors(
    tripId: string,
  ): Promise<{ t: Date; lat: number; lng: number }[]> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        startDate: true,
        stops: {
          where: { parentStopId: null },
          orderBy: { orderIndex: 'asc' },
          select: { latitude: true, longitude: true, nights: true },
        },
      },
    });
    if (!trip) return [];
    const out: { t: Date; lat: number; lng: number }[] = [];
    let cursor = trip.startDate.getTime();
    for (const stop of trip.stops) {
      if (stop.latitude != null && stop.longitude != null) {
        out.push({ t: new Date(cursor), lat: stop.latitude, lng: stop.longitude });
      }
      cursor += stop.nights * 86_400_000;
    }
    return out;
  }

  /** Is there an auto-drawn stretch near this point? */
  async hasRouteFillNear(
    tripId: string,
    userId: string,
    lng: number,
    lat: number,
  ): Promise<{ near: boolean }> {
    await this.trips.getForMember(tripId, userId);
    const points = await this.prisma.locationPoint.findMany({
      where: { tripId, userId, source: PointSource.ROUTE_FILL },
      select: { latitude: true, longitude: true },
    });
    const near = points.some(
      (p) => segLenKm({ lat, lng }, { lat: p.latitude, lng: p.longitude }) <= 25,
    );
    return { near };
  }

  /**
   * Removes ONE drawn stretch: the run of auto-drawn points nearest where you
   * pressed. A drawn route is a contiguous run in time, so finding the closest
   * point and walking outwards over its neighbours picks out exactly the
   * stretch you meant and leaves every other one alone.
   */
  async clearRouteFillNear(
    tripId: string,
    userId: string,
    lng: number,
    lat: number,
  ): Promise<{ deleted: number }> {
    await this.trips.getForEditor(tripId, userId);
    const points = await this.prisma.locationPoint.findMany({
      where: { tripId, userId },
      orderBy: { recordedAt: 'asc' },
      select: { id: true, latitude: true, longitude: true, source: true },
    });

    let nearest = -1;
    let best = Number.POSITIVE_INFINITY;
    points.forEach((p, i) => {
      if (p.source !== PointSource.ROUTE_FILL) return;
      const d = segLenKm({ lat, lng }, { lat: p.latitude, lng: p.longitude });
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    if (nearest === -1 || best > 25) {
      throw new BadRequestException('Geen getekende route in de buurt.');
    }

    let from = nearest;
    while (from > 0 && points[from - 1]!.source === PointSource.ROUTE_FILL) from -= 1;
    let to = nearest;
    while (to < points.length - 1 && points[to + 1]!.source === PointSource.ROUTE_FILL) to += 1;

    const ids = points.slice(from, to + 1).map((p) => p.id);
    const { count } = await this.prisma.locationPoint.deleteMany({ where: { id: { in: ids } } });
    return { deleted: count };
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
    options: { userIds?: string[]; tolerance?: number; includePhotos?: boolean; day?: string } = {},
  ): Promise<RouteCollection> {

    const tolerance = Math.min(Math.abs(options.tolerance ?? DEFAULT_TOLERANCE), MAX_TOLERANCE);
    const includePhotos = options.includePhotos ?? true;
    const userFilter =
      options.userIds && options.userIds.length > 0
        ? Prisma.sql`AND "userId" = ANY(${options.userIds}::uuid[])`
        : Prisma.empty;

    // One day of the trip instead of all of it. Both sources are filtered, or
    // a day would show its photos strung onto the whole trip's line.
    const day = options.day ? dayBounds(options.day) : null;
    const pointDayFilter = day
      ? Prisma.sql`AND "recordedAt" >= ${day.from} AND "recordedAt" < ${day.to}`
      : Prisma.empty;
    const photoDayFilter = day
      ? Prisma.sql`AND "takenAt" >= ${day.from} AND "takenAt" < ${day.to}`
      : Prisma.empty;

    const photoSource = includePhotos
      ? Prisma.sql`
          UNION ALL
          SELECT "userId", "takenAt" AS t, geom
          FROM media_refs
          WHERE "tripId" = ${tripId}::uuid AND geom IS NOT NULL ${userFilter} ${photoDayFilter}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { userId: string; displayName: string; lat: number; lng: number }[]
    >`
      WITH pts AS (
        SELECT "userId", "recordedAt" AS t, geom
        FROM location_points
        WHERE "tripId" = ${tripId}::uuid ${userFilter} ${pointDayFilter}
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

/** The UTC day a `YYYY-MM-DD` string stands for. */
function dayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime())) {
    throw new BadRequestException('day must be YYYY-MM-DD');
  }
  return { from, to: new Date(from.getTime() + 86_400_000) };
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

/** A point on the timeline a drawn stretch can hang off. */
type Anchor = { t: Date; lat: number; lng: number };

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

/**
 * Keyless rail routing over the OSM track network (public train-profile OSRM
 * at signal.eu.org). Returns the rail polyline as [lng,lat][].
 *
 * Europe only — that is the only region the service publishes — so anything
 * outside it comes back empty and the caller says so rather than drawing a
 * line down a motorway and calling it a train.
 */
async function railRoute(
  a: [number, number],
  b: [number, number],
): Promise<[number, number][]> {
  const url =
    `https://signal.eu.org/osm/eu/route/v1/train/` +
    `${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) return [];
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
