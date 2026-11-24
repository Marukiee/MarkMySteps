/**
 * The day a photo was taken, where it was taken.
 *
 * takenAt is the moment in UTC, and its date is the wrong day for a good part
 * of the world: 05:30 in Bangkok is 22:30 UTC the day before. The server also
 * sends takenAtLocal, the clock where the photo was taken written as if it
 * were UTC (Immich's localDateTime), so its date is the day you would call it
 * there. Photos synced before the server kept it have none until their next
 * sync; their UTC date stands in, as it always did.
 */
export function photoDay(photo: { takenAt: string; takenAtLocal?: string | null }): string {
  return (photo.takenAtLocal || photo.takenAt).slice(0, 10);
}

/**
 * The clock on this device at a moment, written as if it were UTC: the
 * takenAtLocal of a photo from the phone's own gallery, taken in the time zone
 * the phone is in.
 */
export function localClock(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString();
}
