/**
 * Distances on the globe, with nothing else attached.
 *
 * These used to live in `arc`, which imports the whole airport table at the
 * top. The row of places above a timeline only needs a distance, and pulling
 * it from `arc` made the public share page download every airport in the
 * world before it could draw a photo. `arc` re-exports both, so nothing that
 * imported them from there has to change.
 */

/**
 * How close a photo has to have been taken to count as a photo OF a place.
 *
 * Wide enough to cover a city and a day of walking around it, narrow enough
 * that the next town along the road is somewhere else. Used wherever a photo
 * has to be matched to the stop it belongs to: the tiles above the timeline,
 * and the "make this the stop's face" action in the viewer.
 */
export const STOP_NEAR_KM = 30;

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
