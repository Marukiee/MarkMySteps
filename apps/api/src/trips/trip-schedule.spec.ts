import { planTrip, type PlanStop } from './trip-schedule';

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
    latitude: 40,
    longitude: -8,
    countryCode: 'PT',
    ...extra,
  };
}

describe('planTrip', () => {
  beforeEach(() => (order = 0));
  const start = new Date('2026-04-01T00:00:00Z');

  it('dates each stop from the nights before it', () => {
    const plan = planTrip([stop('Lisbon'), stop('Porto', { nights: 3 })], start);
    expect(plan.visits.map((v) => [v.stop.name, v.from, v.to])).toEqual([
      ['Lisbon', '2026-04-01', '2026-04-03'],
      ['Porto', '2026-04-03', '2026-04-06'],
    ]);
  });

  it('counts a flight only where the map draws one', () => {
    const plan = planTrip(
      [
        // Marked as a flight, but nothing comes before it: no arc, no flight.
        stop('Rabat', { travelMode: 'FLIGHT', latitude: 34, longitude: -6.8, countryCode: 'MA' }),
        stop('Marrakesh', { travelMode: 'FLIGHT', latitude: 31.6, longitude: -8, countryCode: 'MA' }),
        stop('Tangier', { travelMode: 'BOAT', latitude: 35.8, longitude: -5.8, countryCode: 'MA' }),
        stop('Tarifa', { travelMode: 'BOAT', latitude: 36, longitude: -5.6, countryCode: 'ES' }),
      ],
      start,
    );
    expect(plan.flights).toEqual(['2026-04-03']);
  });

  it('counts an outbound flight between two airports', () => {
    const plan = planTrip(
      [
        stop('Heenvlucht', { travelMode: 'FLIGHT', fromAirport: 'AMS', toAirport: 'RAK', nights: 0 }),
        stop('Marrakesh', { latitude: 31.6, longitude: -8 }),
      ],
      start,
    );
    expect(plan.flights).toEqual(['2026-04-01']);
  });

  it('puts a day trip on its own day and adds the way there and back', () => {
    const plan = planTrip(
      [
        stop('Lisbon', { latitude: 38.72, longitude: -9.14 }),
        stop('Sintra', {
          parentStopId: 'Lisbon',
          dayTripDate: new Date('2026-04-02T00:00:00Z'),
          latitude: 38.8,
          longitude: -9.39,
        }),
      ],
      start,
    );
    expect(plan.visits.find((v) => v.stop.name === 'Sintra')).toMatchObject({
      from: '2026-04-02',
      to: '2026-04-02',
    });
    expect(plan.extras).toHaveLength(1);
    expect(plan.extras[0]!.day).toBe('2026-04-02');
    expect(plan.extras[0]!.km).toBeGreaterThan(40);
  });
});
