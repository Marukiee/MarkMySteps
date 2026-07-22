import { useEffect, useState } from 'react';
import { fetchWeather, Weather } from '../lib/weather';

/** Small current-weather chip for a located stop. */
export function WeatherBadge({ lat, lon }: { lat: number; lon: number }) {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWeather(lat, lon).then((w) => {
      if (!cancelled) setWeather(w);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  if (!weather) return null;
  return (
    <span className="weather-badge" title="Huidig weer">
      {weather.emoji} {weather.temperature}°
    </span>
  );
}
