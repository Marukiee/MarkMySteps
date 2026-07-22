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

const cache = new Map<string, Weather>();

export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('current', 'temperature_2m,weather_code');
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: { temperature_2m: number; weather_code: number };
    };
    if (!data.current) return null;
    const weather: Weather = {
      temperature: Math.round(data.current.temperature_2m),
      code: data.current.weather_code,
      emoji: codeToEmoji(data.current.weather_code),
    };
    cache.set(key, weather);
    return weather;
  } catch {
    return null;
  }
}
