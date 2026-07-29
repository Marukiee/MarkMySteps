import { useEffect, useState } from 'react';
import { fetchWeather, Weather } from '../lib/weather';

/**
 * Small weather chip for a located stop on a given day.
 *
 * `separator` puts the dot INSIDE the badge on purpose: the caller cannot know
 * whether there will be a reading — a place may simply have none — and a dot
 * rendered next to the badge then sat there on its own with nothing after it.
 */
export function WeatherBadge({
  lat,
  lon,
  day,
  separator,
}: {
  lat: number;
  lon: number;
  day?: string;
  separator?: boolean;
}) {
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
    <>
      {separator && <span className="weather-sep"> · </span>}
      <span className="weather-badge" title="Huidig weer">
        {weather.emoji} {weather.temperature}°
      </span>
    </>
  );
}
