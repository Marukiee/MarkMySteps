/** Current weather via open-meteo (open, keyless, no Google). */

export interface Weather {
  temperature: number;
  code: number;
  emoji: string;
}

// WMO weather codes → emoji.
function codeToEmoji(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

/** Snow and thunder are worth keeping even when barely any water fell. */
function isSnow(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

/**
 * The daily `weather_code` is the most SIGNIFICANT condition of the day, not
 * the typical one: five minutes of drizzle labels a sunny day as rain, and a
 * single heavy shower labels it as a downpour. Combining it with how much rain
 * actually fell (and for how long) gives a summary that matches the day you
 * remember.
 */
function dayCondition(
  code: number,
  precipitationMm: number | null,
  precipitationHours: number | null,
): { code: number; emoji: string } {
  if (isSnow(code) || code >= 95) return { code, emoji: codeToEmoji(code) };
  const mm = precipitationMm ?? 0;
  const hours = precipitationHours ?? 0;
  const wet = code >= 51 && code <= 86;
  if (!wet) return { code, emoji: codeToEmoji(code) };
  // Under half a millimetre nothing meaningful fell — the day was simply
  // clouded over.
  if (mm < 0.5 || hours < 1) return { code: 3, emoji: '☁️' };
  // A brief shower on an otherwise dry day: showers, not steady rain.
  if (mm < 3 || hours <= 2) return { code: 80, emoji: '🌦️' };
  return { code, emoji: codeToEmoji(code) };
}

const cache = new Map<string, Weather | null>();

/**
 * Disk cache, so a trip you have opened before still shows its weather with no
 * connection at all. A past day's weather never changes, so it is kept
 * indefinitely; "now" goes stale after half an hour.
 */
const STORE_KEY = 'mms.weather';
const NOW_TTL_MS = 30 * 60_000;

interface StoredWeather {
  w: Weather | null;
  /** When it was fetched — only checked for "current conditions". */
  at: number;
}

function readStore(): Record<string, StoredWeather> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, StoredWeather>;
  } catch {
    return {};
  }
}

function storeGet(key: string, isNow: boolean): StoredWeather | null {
  const entry = readStore()[key];
  if (!entry) return null;
  if (isNow && Date.now() - entry.at > NOW_TTL_MS) return null;
  return entry;
}

function storePut(key: string, weather: Weather | null): void {
  try {
    const all = readStore();
    all[key] = { w: weather, at: Date.now() };
    // A trip is a few dozen days; a cap keeps a long history from growing
    // without bound. Oldest entries go first.
    const keys = Object.keys(all);
    if (keys.length > 600) {
      const oldest = keys.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, keys.length - 600);
      for (const k of oldest) delete all[k];
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* storage full — the cache is best-effort */
  }
}

const DAY_MS = 86_400_000;
/** How far back the (high-resolution) forecast API still serves real data. */
const PAST_DAYS_LIMIT = 90;

/**
 * Weather for a specific day at a location. `day` is yyyy-mm-dd; omit for
 * current conditions.
 *
 * Recent days come from the forecast API's `past_days` window, which is the
 * same high-resolution model that produced the forecast (a few km grid).
 * Anything older falls back to the ERA5 archive, which is reanalysis on a ~25 km
 * grid and therefore noticeably coarser — hence the preference order.
 */
export async function fetchWeather(
  lat: number,
  lon: number,
  day?: string,
): Promise<Weather | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${day ?? 'now'}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const stored = storeGet(key, !day);
  if (stored) {
    cache.set(key, stored.w);
    return stored.w;
  }

  try {
    let weather: Weather | null = null;
    if (day) {
      const ageDays = Math.floor((Date.now() - new Date(`${day}T12:00:00Z`).getTime()) / DAY_MS);
      const useArchive = ageDays > PAST_DAYS_LIMIT;
      const host = useArchive
        ? 'archive-api.open-meteo.com/v1/archive'
        : 'api.open-meteo.com/v1/forecast';
      const url = new URL(`https://${host}`);
      url.searchParams.set('latitude', String(lat));
      url.searchParams.set('longitude', String(lon));
      url.searchParams.set(
        'daily',
        'weather_code,temperature_2m_max,precipitation_sum,precipitation_hours',
      );
      url.searchParams.set('start_date', day);
      url.searchParams.set('end_date', day);
      url.searchParams.set('timezone', 'auto');
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          daily?: {
            temperature_2m_max: (number | null)[];
            weather_code: (number | null)[];
            precipitation_sum?: (number | null)[];
            precipitation_hours?: (number | null)[];
          };
        };
        const t = data.daily?.temperature_2m_max?.[0];
        const c = data.daily?.weather_code?.[0];
        if (t != null && c != null) {
          const { code, emoji } = dayCondition(
            c,
            data.daily?.precipitation_sum?.[0] ?? null,
            data.daily?.precipitation_hours?.[0] ?? null,
          );
          weather = { temperature: Math.round(t), code, emoji };
        }
      }
    } else {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(lat));
      url.searchParams.set('longitude', String(lon));
      url.searchParams.set('current', 'temperature_2m,weather_code');
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          current?: { temperature_2m: number; weather_code: number };
        };
        if (data.current) {
          weather = {
            temperature: Math.round(data.current.temperature_2m),
            code: data.current.weather_code,
            emoji: codeToEmoji(data.current.weather_code),
          };
        }
      }
    }
    // A miss is not remembered at all: with no connection every lookup fails,
    // and caching that would keep the weather hidden once you are back online.
    if (weather) {
      cache.set(key, weather);
      storePut(key, weather);
    }
    return weather;
  } catch {
    return null;
  }
}
