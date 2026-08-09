/**
 * Who owns the next `popstate`.
 *
 * Sheets that trap the back gesture each push an entry and, when they are
 * closed some other way, call `history.back()` to consume it again. The
 * trouble is that the pop this produces looks exactly like a real back gesture
 * to every OTHER sheet still listening — so closing the summary maker with its
 * own cross also collapsed the mensen & delen sheet underneath it, and you
 * landed back on the trip.
 *
 * Anything tidying up after itself says so here first, and the layers beneath
 * let that one pop go by.
 */
let pending = 0;

/** About to consume our own history entry: the next pop is not a gesture. */
export function skipNextPop(): void {
  pending += 1;
}

/** True when this pop belongs to a layer above, which has already handled it. */
export function popWasOurs(): boolean {
  if (pending === 0) return false;
  pending -= 1;
  return true;
}
