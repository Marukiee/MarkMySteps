import { PlaceLookupService } from './place-lookup.service';

describe('PlaceLookupService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function answer(rows: unknown[]) {
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => rows });
    global.fetch = fetch as unknown as typeof global.fetch;
    return fetch;
  }

  it('finds a town by its old name, and asks only once', async () => {
    const fetch = answer([
      {
        name: 'Volgograd',
        lat: '48.708',
        lon: '44.513',
        importance: 0.65,
        address: { state: 'Volgograd Oblast', country: 'Russia', country_code: 'ru' },
      },
      // Too small to be what anybody typing "Stalingrad" meant.
      { name: 'Nové Město', lat: '49.8', lon: '18.5', importance: 0.27, address: { country_code: 'cz' } },
    ]);
    const lookup = new PlaceLookupService();
    const hits = await lookup.search('Stalingrad');
    expect(hits).toEqual([
      {
        name: 'Volgograd',
        region: 'Volgograd Oblast, Russia',
        countryCode: 'RU',
        latitude: 48.708,
        longitude: 44.513,
      },
    ]);
    await lookup.search('  stalingrad ');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('answers nothing when Nominatim does not, without keeping that', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    global.fetch = fetch as unknown as typeof global.fetch;
    const lookup = new PlaceLookupService();
    expect(await lookup.search('Bombay')).toEqual([]);
    answer([]);
    expect(await lookup.search('Bombay')).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
