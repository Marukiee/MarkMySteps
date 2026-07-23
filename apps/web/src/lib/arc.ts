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

/** Great-circle distance in km between two [lng,lat] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export type TravelMode = 'GROUND' | 'TRAIN' | 'BUS' | 'BOAT' | 'FLIGHT';

/** Ordered cycle for the leg toggle (car → train → bus → boat → flight → car). */
export const TRAVEL_MODES: TravelMode[] = ['GROUND', 'TRAIN', 'BUS', 'BOAT', 'FLIGHT'];

export const MODE_LABEL: Record<TravelMode, string> = {
  GROUND: 'Over land',
  TRAIN: 'Trein',
  BUS: 'Bus',
  BOAT: 'Boot',
  FLIGHT: 'Vlucht',
};

// Rough average speeds (km/h) + a fixed overhead (min) for terminals/check-in.
const SPEED: Record<TravelMode, { kmh: number; overhead: number }> = {
  GROUND: { kmh: 75, overhead: 0 },
  TRAIN: { kmh: 110, overhead: 15 },
  BUS: { kmh: 65, overhead: 15 },
  BOAT: { kmh: 35, overhead: 30 },
  FLIGHT: { kmh: 750, overhead: 90 },
};

/** Rough travel duration for a distance by mode, as "3u 41m". */
export function estimateDuration(km: number, mode: TravelMode): string {
  const { kmh, overhead } = SPEED[mode] ?? SPEED.GROUND;
  const totalMin = Math.round((km / kmh) * 60) + overhead;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}u ${m}m` : `${m}m`;
}

export interface StopPoint {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  travelMode: TravelMode;
  flightNumber: string | null;
  fromAirport: string | null;
  toAirport: string | null;
  orderIndex: number;
  arrivalDate: string;
  departureDate: string;
}
