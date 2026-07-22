import { geoInterpolate } from 'd3-geo';

/** Great-circle arc between two [lng,lat] points as a GeoJSON LineString. */
export function greatCircleArc(
  from: [number, number],
  to: [number, number],
  steps = 48,
): GeoJSON.Feature<GeoJSON.LineString> {
  const interpolate = geoInterpolate(from, to);
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    coordinates.push(interpolate(i / steps) as [number, number]);
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} };
}

export interface StopPoint {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  travelMode: 'GROUND' | 'FLIGHT';
  orderIndex: number;
}
