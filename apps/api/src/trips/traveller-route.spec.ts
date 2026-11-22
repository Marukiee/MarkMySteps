import { TripRole } from '@prisma/client';
import { pickTraveller, TravellerLine, TravellerTrack } from './traveller-route';
import { TripsService } from './trips.service';

// Afrikatrip 2026 in miniature: the organiser takes the train Marrakesh,
// Casablanca, Rabat while a companion is in Spain, Granada to Madrid.
const MARRAKESH: [number, number] = [-7.99, 31.63];
const CASABLANCA: [number, number] = [-7.59, 33.57];
const RABAT: [number, number] = [-6.84, 34.02];
const GRANADA: [number, number] = [-3.6, 37.18];
const MADRID: [number, number] = [-3.7, 40.42];

const OWNER = 'owner';
const MATE = 'mate';
const FRIEND = 'friend';
const GUEST = 'guest';

const ownerLine: TravellerLine = {
  userId: OWNER,
  points: 40,
  meters: 320_000,
  line: [MARRAKESH, CASABLANCA, RABAT],
};
const mateLine: TravellerLine = {
  userId: MATE,
  points: 90,
  meters: 360_000,
  line: [GRANADA, MADRID],
};
const friendLine: TravellerLine = {
  userId: FRIEND,
  points: 10,
  meters: 400_000,
  line: [GRANADA, RABAT],
};

describe('pickTraveller', () => {
  it('takes your own recording when you tracked', () => {
    expect(pickTraveller([ownerLine, mateLine], OWNER, MATE)).toBe(mateLine);
  });

  it("takes the organiser's when you did not track", () => {
    expect(pickTraveller([mateLine, ownerLine], OWNER, FRIEND)).toBe(ownerLine);
  });

  it('takes whoever recorded the most points when the organiser did not track either', () => {
    expect(pickTraveller([friendLine, mateLine], OWNER, GUEST)).toBe(mateLine);
  });

  it("gives a share link, which has no viewer, the organiser's", () => {
    expect(pickTraveller([mateLine, ownerLine], OWNER, null)).toBe(ownerLine);
  });

  it('has nothing to pick when nobody tracked', () => {
    expect(pickTraveller([] as TravellerTrack[], OWNER, MATE)).toBeUndefined();
  });
});

const member = (userId: string, role: TripRole) => ({
  userId,
  role,
  canTrack: role !== TripRole.GUEST,
  fromDate: null,
  toDate: null,
  user: { displayName: userId, username: userId, avatarMime: null },
});

const trip = {
  id: 'trip',
  title: 'Afrikatrip 2026',
  description: null,
  startDate: new Date('2026-03-01'),
  endDate: new Date('2026-03-20'),
  ownerId: OWNER,
  coverMediaId: null,
  markerLng: null,
  markerLat: null,
  color: null,
  autoTrack: false,
  members: [
    member(OWNER, TripRole.OWNER),
    member(MATE, TripRole.MEMBER),
    member(FRIEND, TripRole.MEMBER),
    member(GUEST, TripRole.GUEST),
  ],
  mediaRefs: [],
  stops: [],
};

/** Just enough of Prisma for one trip with no plan and no photos. */
function service(rows: object[]) {
  const prisma = {
    trip: {
      findMany: jest.fn().mockResolvedValue([trip]),
      findUniqueOrThrow: jest.fn().mockResolvedValue(trip),
    },
    stop: { findMany: jest.fn().mockResolvedValue([]) },
    mediaRef: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    // What the grouped query returns: one row per traveller.
    $queryRaw: jest.fn().mockResolvedValue(rows),
  };
  return new TripsService(prisma as never, {} as never);
}

/** The rows travellerLines gets back from PostGIS. */
const lineRows = (lines: TravellerLine[]) =>
  lines.map((l) => ({
    tripId: 'trip',
    userId: l.userId,
    points: BigInt(l.points),
    meters: l.meters,
    geojson: JSON.stringify({ type: 'LineString', coordinates: l.line }),
  }));

describe('home globe route', () => {
  it('draws only your own route when you tracked, never a second traveller', async () => {
    const [t] = await service(lineRows([mateLine, ownerLine])).listForUser(MATE);
    expect(t!.routePath).toEqual([mateLine.line]);
    expect(t!.distanceKm).toBe(360);
  });

  it("draws the organiser's route for a companion who did not track", async () => {
    const [t] = await service(lineRows([mateLine, ownerLine])).listForUser(FRIEND);
    expect(t!.routePath).toEqual([ownerLine.line]);
    expect(t!.distanceKm).toBe(320);
  });

  it('draws the route with the most points when the organiser did not track', async () => {
    const [t] = await service(lineRows([friendLine, mateLine])).listForUser(GUEST);
    expect(t!.routePath).toEqual([mateLine.line]);
  });

  it('runs the journey light along that one route, with no hop to another traveller', async () => {
    const [t] = await service(lineRows([mateLine, ownerLine])).listForUser(FRIEND);
    expect(t!.journey).toEqual([{ flight: false, points: ownerLine.line }]);
  });
});

describe('trip stats distance', () => {
  const tracks = [
    { userId: OWNER, points: BigInt(40), meters: 320_000 },
    { userId: MATE, points: BigInt(90), meters: 360_000 },
  ];

  it('measures your own recording, not everyone added up', async () => {
    expect((await service(tracks).getStatsUnchecked('trip', MATE)).distanceKm).toBe(360);
  });

  it("measures the organiser's recording for somebody who did not track", async () => {
    expect((await service(tracks).getStatsUnchecked('trip', FRIEND)).distanceKm).toBe(320);
  });

  it("gives a share link the organiser's distance", async () => {
    expect((await service(tracks).getStatsUnchecked('trip')).distanceKm).toBe(320);
  });

  it('measures whoever recorded most when the organiser did not track', async () => {
    const others = [
      { userId: FRIEND, points: BigInt(10), meters: 400_000 },
      { userId: MATE, points: BigInt(90), meters: 360_000 },
    ];
    expect((await service(others).getStatsUnchecked('trip')).distanceKm).toBe(360);
  });
});
