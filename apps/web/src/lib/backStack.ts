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
let skipping = false;

/**
 * About to consume our own history entry: the pop this produces is not a
 * gesture, for anybody.
 *
 * A counter was wrong here. Every layer still listening hears the SAME pop, so
 * the first one to ask used the token up and the next one down — the mensen &
 * delen sheet under the maker under the photo chooser — took it for a real
 * back and closed. The flag stands for the whole of that one event and clears
 * itself on the next turn of the loop.
 */
export function skipNextPop(): void {
  skipping = true;
  window.setTimeout(() => {
    skipping = false;
  }, 0);
}

/** True when this pop belongs to a layer above, which has already handled it. */
export function popWasOurs(): boolean {
  return skipping;
}
