import { Injectable, NotFoundException } from '@nestjs/common';
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

/** Simplification tolerance in degrees (~11 m at the equator). */
const DEFAULT_TOLERANCE = 0.0001;
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
    await this.trips.getForMember(tripId, userId);

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

  /** Hand-placed point to complete a route where tracking has gaps. */
  async addManualPoint(
    tripId: string,
    userId: string,
    dto: ManualPointDto,
  ): Promise<LocationPoint> {
    await this.trips.getForMember(tripId, userId);
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
      { userId: string; displayName: string; pointCount: bigint; geojson: string }[]
    >`
      WITH pts AS (
        SELECT "userId", "recordedAt" AS t, geom
        FROM location_points
        WHERE "tripId" = ${tripId}::uuid ${userFilter}
        ${photoSource}
      ),
      lines AS (
        SELECT "userId", ST_MakeLine(geom ORDER BY t) AS line, COUNT(*) AS n
        FROM pts
        GROUP BY "userId"
        HAVING COUNT(*) >= 2
      )
      SELECT
        l."userId",
        u."displayName",
        l.n AS "pointCount",
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(l.line, ${tolerance})) AS geojson
      FROM lines l
      JOIN users u ON u.id = l."userId"
    `;

    return {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        geometry: JSON.parse(row.geojson) as unknown,
        properties: {
          userId: row.userId,
          displayName: row.displayName,
          pointCount: Number(row.pointCount),
        },
      })),
    };
  }
}
