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

const cache = new Map<string, Weather | null>();

/**
 * Weather for a specific day at a location. Uses the daily forecast for
 * dates within range, and the archive API for past dates — both keyless
 * (open-meteo). `day` is yyyy-mm-dd; omit for current conditions.
 */
export async function fetchWeather(
  lat: number,
  lon: number,
  day?: string,
): Promise<Weather | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${day ?? 'now'}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    let weather: Weather | null = null;
    if (day) {
      const isPast = new Date(day) < new Date(Date.now() - 5 * 86_400_000);
      const host = isPast ? 'archive-api.open-meteo.com/v1/archive' : 'api.open-meteo.com/v1/forecast';
      const url = new URL(`https://${host}`);
      url.searchParams.set('latitude', String(lat));
      url.searchParams.set('longitude', String(lon));
      url.searchParams.set('daily', 'temperature_2m_max,weather_code');
      url.searchParams.set('start_date', day);
      url.searchParams.set('end_date', day);
      url.searchParams.set('timezone', 'auto');
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          daily?: { temperature_2m_max: number[]; weather_code: number[] };
        };
        const t = data.daily?.temperature_2m_max?.[0];
        const c = data.daily?.weather_code?.[0];
        if (t != null && c != null) {
          weather = { temperature: Math.round(t), code: c, emoji: codeToEmoji(c) };
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
    cache.set(key, weather);
    return weather;
  } catch {
    return null;
  }
}
