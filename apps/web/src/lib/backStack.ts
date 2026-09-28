import { useEffect, useRef } from 'react';

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

/** The history step a just-closed sheet still owes, per sheet, for one tick. */
const pendingBack = new Map<string, number>();

/**
 * A back gesture closes this sheet instead of leaving the page under it.
 *
 * The sheet pushes a history entry when it mounts and steps back over it when
 * it is closed some other way. That step waits one tick: React's StrictMode
 * mounts every effect twice in development, and a step back taken straight
 * away raced the second mount's push, won, and its pop closed the sheet a
 * moment after it opened. Mounted again within that tick, the entry already
 * there is simply kept. The Lightbox does the same for the same reason.
 */
export function useBackToClose(tag: string, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const waiting = pendingBack.get(tag);
    if (waiting !== undefined) {
      window.clearTimeout(waiting);
      pendingBack.delete(tag);
    } else {
      window.history.pushState({ [tag]: true }, '');
    }
    let popped = false;
    const onPop = () => {
      popped = true;
      onBackRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (popped) return;
      pendingBack.set(
        tag,
        window.setTimeout(() => {
          pendingBack.delete(tag);
          window.history.back();
        }, 0),
      );
    };
  }, [tag]);
}
