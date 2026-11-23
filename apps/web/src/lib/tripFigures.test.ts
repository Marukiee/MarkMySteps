import { describe, expect, it, vi } from 'vitest';

// The words do not matter here, and the real dictionary needs a browser.
vi.mock('../i18n', () => ({
  t: (key: string) => key,
  intlLocale: () => 'nl-NL',
}));

const { countStopPlaces } = await import('./arc');
const { countTravellers, resolveFacts } = await import('./tripFacts');

const at = (name: string, latitude: number | null, longitude: number | null, parentStopId: string | null = null) => ({
  name,
  latitude,
  longitude,
  parentStopId,
});

describe('countStopPlaces', () => {
  it('counts every route stop, even a city slept in twice', () => {
    expect(countStopPlaces([at('Granada', 37.18, -3.6), at('Sevilla', 37.39, -5.98), at('Granada', 37.18, -3.6)])).toBe(3);
  });

  it('counts a day trip once per place, however often it is made', () => {
    const trip = () => at('Stockholm', 59.329, 18.068, 'base');
    expect(countStopPlaces([at('Saltsjöbaden', 59.28, 18.31), trip(), trip(), trip()])).toBe(2);
  });

  it('counts two nearby places as two (Granada and Monachil, 8 km apart)', () => {
    expect(countStopPlaces([at('Granada', 37.18, -3.6), at('Monachil', 37.133, -3.537, 'granada')])).toBe(2);
  });

  it('leaves out the way there and back, even when they carry a coordinate', () => {
    expect(
      countStopPlaces([
        at('Heenreis', 52.09, 5.12),
        at('Granada', 37.18, -3.6),
        at('Sevilla', 37.39, -5.98),
        at('Terugvlucht', 52.3, 4.76),
      ]),
    ).toBe(2);
  });

  it('keeps a real place whose name only starts like a leg', () => {
    expect(countStopPlaces([at('Heenvliet', 51.86, 4.25), at('Granada', 37.18, -3.6)])).toBe(2);
  });

  it('skips stops without a position', () => {
    expect(countStopPlaces([at('Granada', 37.18, -3.6), at('Nowhere', null, null)])).toBe(1);
  });
});

describe('resolveFacts', () => {
  const src = { distanceKm: 1240, days: 12, stops: 5, photoCount: 380, travellers: 2, countries: 1 };

  it('takes the first four that say something, in the fixed order', () => {
    expect(resolveFacts(src, null).map((f) => f.id)).toEqual(['km', 'days', 'stops', 'photos']);
  });

  it('skips what has nothing to say: no distance, one stop, travelling alone', () => {
    const quiet = { ...src, distanceKm: 0, stops: 1, travellers: 1 };
    expect(resolveFacts(quiet, null).map((f) => f.id)).toEqual(['days', 'photos', 'countries']);
  });

  it('puts the trip\'s own choice first, in its own order', () => {
    expect(resolveFacts(src, ['countries', 'travellers']).map((f) => f.id)).toEqual([
      'countries',
      'travellers',
      'km',
      'days',
    ]);
  });

  it('tops up a choice that has nothing to say from the fixed order', () => {
    expect(resolveFacts({ ...src, distanceKm: 0 }, ['km', 'photos']).map((f) => f.id)).toEqual([
      'photos',
      'days',
      'stops',
      'travellers',
    ]);
  });
});

describe('countTravellers', () => {
  it('counts the owner and companions, not the guests', () => {
    expect(countTravellers([{ role: 'OWNER' }, { role: 'MEMBER' }, { role: 'GUEST' }])).toBe(2);
  });
});
