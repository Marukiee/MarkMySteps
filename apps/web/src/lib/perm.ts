import type { Trip, TripMember, TripRole } from '../api/types';

/**
 * What you are allowed to do on somebody else's trip.
 *
 * Three roles, and the difference that matters is guest versus not: a guest was
 * invited to look. They see the whole trip — the route everybody walked, the
 * photos, the notes, the plan — and change none of it, contribute no photos of
 * their own, and never record a track on it. The server enforces exactly this;
 * these helpers are so the app doesn't offer buttons that come back 403.
 */

type TripLike = Pick<Trip, 'ownerId'> & { members: TripMember[] };

export function roleOn(trip: TripLike | null | undefined, userId?: string | null): TripRole | null {
  if (!trip || !userId) return null;
  return trip.members.find((m) => m.userId === userId)?.role ?? null;
}

/** Owner or reisgenoot: may edit the trip's content. */
export function canEditTrip(trip: TripLike | null | undefined, userId?: string | null): boolean {
  const role = roleOn(trip, userId);
  return role === 'OWNER' || role === 'MEMBER';
}

/** Invited to look, nothing else. */
export function isGuestOn(trip: TripLike | null | undefined, userId?: string | null): boolean {
  return roleOn(trip, userId) === 'GUEST';
}

/**
 * May record their own track on this trip. The owner always may; a reisgenoot
 * needs the permission the owner gives them; a guest never does.
 */
export function canTrackTrip(trip: TripLike | null | undefined, userId?: string | null): boolean {
  if (!trip || !userId) return false;
  const me = trip.members.find((m) => m.userId === userId);
  if (!me) return false;
  return me.role === 'OWNER' || (me.role === 'MEMBER' && me.canTrack);
}
