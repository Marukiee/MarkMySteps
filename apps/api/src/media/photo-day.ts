/**
 * The day a photo was taken, where it was taken.
 *
 * takenAt is the moment in UTC, and its date is the wrong day for a good part
 * of the world: 05:30 in Bangkok is 22:30 UTC the day before, 20:00 in New
 * York is 01:00 UTC the day after. Immich also knows the clock where the
 * photo was taken (localDateTime); that is kept as takenAtLocal, written as if
 * it were UTC, so its date is the day you would call it there.
 */

/** The furthest any clock is from UTC (UTC+14, Kiribati); UTC-12 is closer. */
export const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' where the photo was taken; the UTC date of takenAt when that is not known. */
export function photoDay(takenAt: Date, takenAtLocal?: Date | null): string {
  return (takenAtLocal ?? takenAt).toISOString().slice(0, 10);
}

/**
 * Immich's localDateTime as a Date whose UTC fields are the wall clock where
 * the photo was taken. Immich writes it with a Z; a value without any offset
 * is read the same way, never in the server's own time zone. Null when it is
 * missing or not a date.
 */
export function parseLocalDateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const zoned = /(Z|[+-]\d\d:?\d\d)$/i.test(raw) ? raw : `${raw}Z`;
  // Any offset written on it is dropped: the clock reading is what counts.
  const wall = zoned.replace(/([+-]\d\d:?\d\d)$/, 'Z');
  const date = new Date(wall);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whether a photo's own day falls inside a trip's days (both 'YYYY-MM-DD', inclusive). */
export function onTripDays(day: string, firstDay: string, lastDay: string): boolean {
  return day >= firstDay && day <= lastDay;
}

/**
 * Of the photos Immich found in the widened search window, the ones that
 * belong to a trip: those whose own day falls on one of its days (DATE
 * columns, midnight UTC). The sync drops every ref not in this list, so a
 * photo whose local day lies outside the trip leaves it.
 */
export function photosOnTrip<T extends { takenAt: Date; takenAtLocal: Date | null }>(
  photos: T[],
  startDate: Date,
  endDate: Date,
): T[] {
  const firstDay = startDate.toISOString().slice(0, 10);
  const lastDay = endDate.toISOString().slice(0, 10);
  return photos.filter((p) => onTripDays(photoDay(p.takenAt, p.takenAtLocal), firstDay, lastDay));
}
