import { PrismaClient } from '@prisma/client';
import { travellerDistances, travellerLines } from './traveller-route';

/**
 * The grouped query itself, on a real PostGIS.
 *
 * Runs only when MMS_TEST_DATABASE_URL points at a throwaway database, e.g.
 *
 *   docker run --rm -d -p 127.0.0.1:55439:5432 -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=t postgis/postgis:16-3.5-alpine
 *   MMS_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/t pnpm test
 *
 * Everything happens inside one transaction that is rolled back at the end,
 * in a schema of its own, so it leaves nothing behind.
 */
const url = process.env.MMS_TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

const TRIP = '00000000-0000-4000-8000-000000000001';
const OTHER_TRIP = '00000000-0000-4000-8000-000000000002';
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const MATE = '00000000-0000-4000-8000-0000000000b2';

class Rollback extends Error {}

maybe('travellerLines on PostGIS', () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
  });
  afterAll(() => prisma.$disconnect());

  type Point = { trip: string; user: string; at: string; lng: number; lat: number };

  /** Seeds points, asks the query, and throws everything away again. */
  function run(points: Point[], tripIds: string[]) {
    return seeded(points, (tx) => travellerLines(tx, tripIds));
  }

  async function seeded<T>(points: Point[], ask: (tx: PrismaClient) => Promise<T>): Promise<T> {
    let result: T | undefined;
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('CREATE SCHEMA mms_route_test');
        await tx.$executeRawUnsafe('SET LOCAL search_path TO mms_route_test, public');
        await tx.$executeRawUnsafe(`
          CREATE TABLE location_points (
            "tripId" uuid NOT NULL,
            "userId" uuid NOT NULL,
            "recordedAt" timestamp(3) NOT NULL,
            latitude double precision NOT NULL,
            longitude double precision NOT NULL,
            geom geometry(Point, 4326)
              GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED
          )`);
        for (const p of points) {
          await tx.$executeRaw`
            INSERT INTO location_points ("tripId", "userId", "recordedAt", latitude, longitude)
            VALUES (${p.trip}::uuid, ${p.user}::uuid, ${new Date(p.at)}, ${p.lat}, ${p.lng})`;
        }
        result = await ask(tx as unknown as PrismaClient);
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
    return result!;
  }

  // Two people tracking at the same hours, a country apart: the organiser on
  // the train Marrakesh, Casablanca, Rabat; the companion Granada to Madrid.
  const afrikatrip = [
    { trip: TRIP, user: OWNER, at: '2026-03-05T08:00:00Z', lng: -7.99, lat: 31.63 },
    { trip: TRIP, user: MATE, at: '2026-03-05T08:30:00Z', lng: -3.6, lat: 37.18 },
    { trip: TRIP, user: OWNER, at: '2026-03-05T10:00:00Z', lng: -7.59, lat: 33.57 },
    { trip: TRIP, user: MATE, at: '2026-03-05T11:00:00Z', lng: -3.68, lat: 38.9 },
    { trip: TRIP, user: OWNER, at: '2026-03-05T12:00:00Z', lng: -6.84, lat: 34.02 },
    { trip: TRIP, user: MATE, at: '2026-03-05T13:00:00Z', lng: -3.7, lat: 40.42 },
    // Somebody else's trip, which must not leak in.
    { trip: OTHER_TRIP, user: OWNER, at: '2026-03-05T09:00:00Z', lng: 4.9, lat: 52.37 },
  ];

  it('makes one line per traveller instead of one zigzag through both', async () => {
    const lines = (await run(afrikatrip, [TRIP])).get(TRIP) ?? [];
    const byUser = new Map(lines.map((l) => [l.userId, l]));
    expect([...byUser.keys()].sort()).toEqual([OWNER, MATE]);
    // Each line stays on its own side of the Strait of Gibraltar.
    expect(byUser.get(OWNER)!.line.every(([lng, lat]) => lng < -6 && lat < 35)).toBe(true);
    expect(byUser.get(MATE)!.line.every(([lng, lat]) => lng > -4 && lat > 37)).toBe(true);
    // In the order it was recorded.
    expect(byUser.get(OWNER)!.line[0]).toEqual([-7.99, 31.63]);
    expect(byUser.get(MATE)!.line.at(-1)).toEqual([-3.7, 40.42]);
    // And how many points each recorded, for picking the busiest recorder.
    expect(byUser.get(OWNER)!.points).toBe(3);
  });

  it('measures each traveller on their own recording', async () => {
    const lines = (await run(afrikatrip, [TRIP])).get(TRIP) ?? [];
    const owner = lines.find((l) => l.userId === OWNER)!;
    // Marrakesh, Casablanca, Rabat by rail is some 300 km; the old zigzag over
    // both travellers came to well over 2000.
    expect(owner.meters / 1000).toBeGreaterThan(250);
    expect(owner.meters / 1000).toBeLessThan(400);
  });

  it('only answers for the trips it was asked about', async () => {
    const byTrip = await run(afrikatrip, [TRIP]);
    expect([...byTrip.keys()]).toEqual([TRIP]);
  });

  it('leaves out a traveller with a single point, which is no line', async () => {
    const byTrip = await run(
      [
        ...afrikatrip.filter((p) => p.user === OWNER && p.trip === TRIP),
        { trip: TRIP, user: MATE, at: '2026-03-05T08:30:00Z', lng: -3.6, lat: 37.18 },
      ],
      [TRIP],
    );
    expect((byTrip.get(TRIP) ?? []).map((l) => l.userId)).toEqual([OWNER]);
  });

  it('measures each traveller apart for the stats, within the days asked for', async () => {
    const all = await seeded(afrikatrip, (tx) => travellerDistances(tx, TRIP));
    const owner = all.find((t) => t.userId === OWNER)!;
    expect(all.map((t) => t.userId).sort()).toEqual([OWNER, MATE]);
    expect(owner.points).toBe(3);
    expect(owner.meters / 1000).toBeGreaterThan(250);
    expect(owner.meters / 1000).toBeLessThan(400);

    // Only the morning: the organiser's first two points, the companion's one,
    // which is no distance at all and is left out.
    const morning = await seeded(afrikatrip, (tx) =>
      travellerDistances(tx, TRIP, {
        from: new Date('2026-03-05T00:00:00Z'),
        until: new Date('2026-03-05T10:30:00Z'),
      }),
    );
    expect(morning.map((t) => [t.userId, t.points])).toEqual([[OWNER, 2]]);
  });
});
