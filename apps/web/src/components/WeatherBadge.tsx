import { useEffect, useState } from 'react';
import { fetchWeather, Weather } from '../lib/weather';

/** Small weather chip for a located stop on a given day. */
export function WeatherBadge({ lat, lon, day }: { lat: number; lon: number; day?: string }) {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWeather(lat, lon, day).then((w) => {
      if (!cancelled) setWeather(w);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, day]);

  if (!weather) return null;
  return (
    <span className="weather-badge" title="Huidig weer">
      {weather.emoji} {weather.temperature}°
    </span>
  );
}
