import { type PlanStop } from './trip-schedule';
import { countStopPlaces, tripDistanceKm } from './trips.service';

let order = 0;
function stop(name: string, extra: Partial<PlanStop> = {}): PlanStop {
  return {
    id: name,
    name,
    orderIndex: order++,
    nights: 2,
    parentStopId: null,
    dayTripDate: null,
    travelMode: 'GROUND',
    fromAirport: null,
    toAirport: null,
    latitude: 37.18,
    longitude: -3.6,
    countryCode: 'ES',
    ...extra,
  };
}

describe('countStopPlaces', () => {
  beforeEach(() => (order = 0));

  it('counts every route stop, even a city slept in twice', () => {
    expect(
      countStopPlaces([
        stop('Granada'),
        stop('Sevilla', { latitude: 37.39, longitude: -5.98 }),
        stop('Granada'),
      ]),
    ).toBe(3);
  });

  it('counts a day trip once per place, however often it is made', () => {
    const base = stop('Saltsjöbaden', { latitude: 59.28, longitude: 18.31, countryCode: 'SE' });
    const trip = (id: string) =>
      stop(id, { name: 'Stockholm', parentStopId: base.id, latitude: 59.329, longitude: 18.068 });
    expect(countStopPlaces([base, trip('a'), trip('b'), trip('c')])).toBe(2);
  });

  it('counts two nearby places as two (Granada and Monachil, 8 km apart)', () => {
    const granada = stop('Granada');
    const monachil = stop('Monachil', { parentStopId: granada.id, latitude: 37.133, longitude: -3.537 });
    expect(countStopPlaces([granada, monachil])).toBe(2);
  });

  it('leaves out the way there and back, even when they carry a coordinate', () => {
    expect(
      countStopPlaces([
        stop('Heenreis', { nights: 0, latitude: 52.09, longitude: 5.12, countryCode: 'NL' }),
        stop('Granada'),
        stop('Sevilla', { latitude: 37.39, longitude: -5.98 }),
        stop('Terugvlucht', { nights: 0, travelMode: 'FLIGHT', latitude: 52.3, longitude: 4.76 }),
      ]),
    ).toBe(2);
  });

  it('keeps a real place whose name only starts like a leg', () => {
    expect(countStopPlaces([stop('Heenvliet', { latitude: 51.86, longitude: 4.25 }), stop('Granada')])).toBe(2);
  });

  it('skips stops without a position', () => {
    expect(countStopPlaces([stop('Granada'), stop('Nowhere', { latitude: null, longitude: null })])).toBe(1);
  });
});

describe('tripDistanceKm', () => {
  beforeEach(() => (order = 0));
  const start = new Date('2026-04-01T00:00:00Z');

  it('is the tracked distance when the plan adds nothing', () => {
    expect(tripDistanceKm(1234.4, [stop('Granada'), stop('Sevilla')], start)).toBe(1234);
  });

  it('adds a day trip there and back to what was tracked', () => {
    const granada = stop('Granada');
    // About 8.6 km away: 17 km there and back.
    const monachil = stop('Monachil', { parentStopId: granada.id, latitude: 37.133, longitude: -3.537 });
    const km = tripDistanceKm(100, [granada, monachil], start);
    expect(km).toBeGreaterThanOrEqual(115);
    expect(km).toBeLessThanOrEqual(119);
  });

  it('stays empty without a recorded route, whatever the plan adds', () => {
    const granada = stop('Granada');
    const monachil = stop('Monachil', { parentStopId: granada.id, latitude: 37.133, longitude: -3.537 });
    expect(tripDistanceKm(0, [granada, monachil], start)).toBe(0);
  });

  it('adds nothing for a flight home', () => {
    const plan = [
      stop('Granada'),
      stop('Terugvlucht', { nights: 0, travelMode: 'FLIGHT', latitude: 52.3, longitude: 4.76, countryCode: 'NL' }),
    ];
    expect(tripDistanceKm(50, plan, start)).toBe(50);
  });
});
