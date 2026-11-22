import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Whose recording stands for a trip.
 *
 * Everybody who tracks keeps their own route, and two people tracking side by
 * side are not one route twice as long. Put in time order together they were
 * worse still: the line swung from one to the other and back in straight
 * lines, Marrakesh to Rabat beside the train, Granada to Madrid. So a trip is
 * always told through ONE person's recording:
 *
 *  1. your own, when you tracked;
 *  2. otherwise the organiser's;
 *  3. otherwise whoever recorded the most points.
 *
 * The same rule draws the line on the home globe and measures every distance,
 * so the route you see and the kilometres under it are the same person's.
 */

/** One traveller's share of a trip's recording. */
export type TravellerTrack = {
  userId: string;
  /** How many points they recorded. */
  points: number;
  /** Length of their full recording, before any simplifying. */
  meters: number;
};

/** A traveller's recording as a drawable line. */
export type TravellerLine = TravellerTrack & {
  /** The simplified line, [lng, lat], in the order it was recorded. */
  line: [number, number][];
};

/**
 * The recording that stands for the trip, by the rule above.
 *
 * `viewerId` is the person it is for, or null when nobody in particular is
 * looking (a share link): then the organiser, else the most points.
 */
export function pickTraveller<T extends TravellerTrack>(
  tracks: T[],
  ownerId: string,
  viewerId: string | null,
): T | undefined {
  return (
    (viewerId !== null ? tracks.find((t) => t.userId === viewerId) : undefined) ??
    tracks.find((t) => t.userId === ownerId) ??
    [...tracks].sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId))[0]
  );
}

/**
 * Every traveller's recorded route per trip, one simplified line each.
 *
 * The tolerance is in degrees: 0.05 is roughly 5 km, between the 0.08 this used
 * to be and the 0.03 it briefly was. Finer than the coastline it is drawn over
 * looks stranger than coarser does (a route threading past headlands the land
 * outline does not have reads as a mistake), and the home screen asks for
 * every trip at once, so the line has to stay cheap. The length is measured on
 * the full recording, so simplifying never shortens the distance.
 *
 * A traveller with fewer than two points has no line and is left out.
 */
export async function travellerLines(
  prisma: Pick<PrismaService, '$queryRaw'>,
  tripIds: string[],
): Promise<Map<string, TravellerLine[]>> {
  const rows = await prisma.$queryRaw<
    {
      tripId: string;
      userId: string;
      points: number | bigint;
      meters: number | null;
      geojson: string | null;
    }[]
  >`
    SELECT "tripId", "userId", points,
           ST_Length(line::geography) AS meters,
           ST_AsGeoJSON(ST_Simplify(line, 0.05)) AS geojson
    FROM (
      SELECT "tripId", "userId", COUNT(*) AS points,
             ST_MakeLine(geom ORDER BY "recordedAt") AS line
      FROM location_points
      WHERE "tripId" = ANY(${tripIds}::uuid[])
      GROUP BY "tripId", "userId"
    ) per_traveller
  `;
  const byTrip = new Map<string, TravellerLine[]>();
  for (const row of rows) {
    if (!row.geojson) continue;
    try {
      const geom = JSON.parse(row.geojson) as { type: string; coordinates: number[][] };
      if (geom.type !== 'LineString' || geom.coordinates.length < 2) continue;
      // A tracked GPS route is real travel: kept whole, NL included (an
      // interrail trip that starts at home must still show that leg). Only
      // photo-derived lines strip NL (a home snapshot isn't a journey).
      const list = byTrip.get(row.tripId) ?? [];
      list.push({
        userId: row.userId,
        points: Number(row.points),
        meters: Number(row.meters ?? 0),
        line: geom.coordinates as [number, number][],
      });
      byTrip.set(row.tripId, list);
    } catch {
      /* ignore malformed geometry */
    }
  }
  return byTrip;
}

/**
 * Every traveller's recorded distance on one trip, optionally only between
 * two moments (the days somebody was there). Travellers with fewer than two
 * points have travelled no measurable distance and are left out.
 */
export async function travellerDistances(
  prisma: Pick<PrismaService, '$queryRaw'>,
  tripId: string,
  range?: { from: Date; until: Date },
): Promise<TravellerTrack[]> {
  const within = range
    ? Prisma.sql`AND "recordedAt" >= ${range.from} AND "recordedAt" < ${range.until}`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<
    { userId: string; points: number | bigint; meters: number | null }[]
  >`
    SELECT "userId", COUNT(*) AS points,
           ST_Length(ST_MakeLine(geom ORDER BY "recordedAt")::geography) AS meters
    FROM location_points
    WHERE "tripId" = ${tripId}::uuid ${within}
    GROUP BY "userId"
  `;
  return rows
    .map((r) => ({ userId: r.userId, points: Number(r.points), meters: Number(r.meters ?? 0) }))
    .filter((t) => t.points >= 2);
}
