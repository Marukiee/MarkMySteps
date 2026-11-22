import { TripRole } from '@prisma/client';
import { pickTravellerLines, TravellerLine, TripsService } from './trips.service';

// Afrikatrip 2026 in miniature: the organiser takes the train Marrakesh,
// Casablanca, Rabat while a companion is in Spain, Granada to Madrid.
const MARRAKESH: [number, number] = [-7.99, 31.63];
const CASABLANCA: [number, number] = [-7.59, 33.57];
const RABAT: [number, number] = [-6.84, 34.02];
const GRANADA: [number, number] = [-3.6, 37.18];
const MADRID: [number, number] = [-3.7, 40.42];

const OWNER = 'owner';
const MATE = 'mate';
const GUEST = 'guest';

const ownerLine: TravellerLine = {
  userId: OWNER,
  meters: 320_000,
  line: [MARRAKESH, CASABLANCA, RABAT],
};
const mateLine: TravellerLine = { userId: MATE, meters: 360_000, line: [GRANADA, MADRID] };

describe('pickTravellerLines', () => {
  it('draws only the organiser when you merely look on', () => {
    expect(pickTravellerLines([mateLine, ownerLine], OWNER, null)).toEqual([ownerLine]);
  });

  it('adds your own line when you travel along, the organiser first', () => {
    expect(pickTravellerLines([mateLine, ownerLine], OWNER, MATE)).toEqual([ownerLine, mateLine]);
  });

  it('draws the organiser once when the organiser is the one looking', () => {
    expect(pickTravellerLines([ownerLine, mateLine], OWNER, OWNER)).toEqual([ownerLine]);
  });

  it('falls back to everyone, longest first, when nobody wanted recorded anything', () => {
    const short: TravellerLine = { userId: 'b', meters: 1_000, line: [GRANADA, MADRID] };
    expect(pickTravellerLines([short, mateLine], OWNER, null)).toEqual([mateLine, short]);
  });

  it('skips a line too short to draw, also when deciding whom to fall back to', () => {
    const dot: TravellerLine = { userId: OWNER, meters: 0, line: [RABAT] };
    expect(pickTravellerLines([dot, mateLine], OWNER, null)).toEqual([mateLine]);
  });

  it('draws nothing when nobody recorded anything', () => {
    expect(pickTravellerLines([], OWNER, MATE)).toEqual([]);
  });
});

/** Just enough of Prisma for listForUser on one trip with no plan and no photos. */
function fakePrisma(lines: TravellerLine[]) {
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
      member(GUEST, TripRole.GUEST),
    ],
    mediaRefs: [],
    stops: [],
  };
  return {
    trip: { findMany: jest.fn().mockResolvedValue([trip]) },
    stop: { findMany: jest.fn().mockResolvedValue([]) },
    mediaRef: { findMany: jest.fn().mockResolvedValue([]) },
    // What the grouped query returns: one row per traveller.
    $queryRaw: jest.fn().mockResolvedValue(
      lines.map((l) => ({
        tripId: 'trip',
        userId: l.userId,
        meters: l.meters,
        geojson: JSON.stringify({ type: 'LineString', coordinates: l.line }),
      })),
    ),
  };
}

function service(lines: TravellerLine[]) {
  return new TripsService(fakePrisma(lines) as never, {} as never);
}

describe('listForUser route per traveller', () => {
  it('sends each traveller as a separate piece, never one line through both', async () => {
    const [trip] = await service([mateLine, ownerLine]).listForUser(MATE);
    expect(trip!.routePath).toEqual([ownerLine.line, mateLine.line]);
  });

  it('shows a guest only the organiser', async () => {
    const [trip] = await service([mateLine, ownerLine]).listForUser(GUEST);
    expect(trip!.routePath).toEqual([ownerLine.line]);
  });

  it('runs the journey along the organiser alone, with no hop over to Spain', async () => {
    const [trip] = await service([mateLine, ownerLine]).listForUser(MATE);
    expect(trip!.journey).toEqual([{ flight: false, points: ownerLine.line }]);
  });

  it('measures the distance of one traveller rather than a zigzag between two', async () => {
    const [trip] = await service([mateLine, ownerLine]).listForUser(MATE);
    expect(trip!.distanceKm).toBe(320);
  });

  it('shows the companion when the organiser recorded nothing', async () => {
    const [trip] = await service([mateLine]).listForUser(GUEST);
    expect(trip!.routePath).toEqual([mateLine.line]);
    expect(trip!.distanceKm).toBe(360);
  });
});
