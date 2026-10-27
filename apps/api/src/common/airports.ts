// Airport coordinates (IATA → [lat, lon]) for building flight arcs on the
// globe. The same list the app searches, made by
// apps/web/scripts/build-airports.mjs from OurAirports.
import { AIRPORT_COORDS_DATA } from './airportData';

const AIRPORT_COORDS = new Map<string, [number, number]>(
  AIRPORT_COORDS_DATA.split('\n').map((line) => {
    const [iata, lat, lon] = line.split(' ') as [string, string, string];
    return [iata, [Number(lat), Number(lon)]];
  }),
);

export function airportCoord(code: string | null | undefined): [number, number] | null {
  if (!code) return null;
  return AIRPORT_COORDS.get(code.trim().toUpperCase()) ?? null;
}
