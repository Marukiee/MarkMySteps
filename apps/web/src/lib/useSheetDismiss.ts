import { TouchEvent as ReactTouchEvent, useCallback, useEffect, useRef } from 'react';

/** How far down it has to come before letting go closes it. */
const CLOSE_PX = 120;
/** Or how fast, for a deliberate flick that never travelled that far. */
const FLICK_PX_PER_MS = 0.7;
/** Below this, a finger is still deciding which way it is going. */
const START_PX = 3;
/** How long the sheet takes to fall away once you have let go of it. Kept just
 *  inside the page's own unmount delay, or the last frames are cut off. */
const EXIT_MS = 230;

/**
 * A sheet you can push back down.
 *
 * A panel that comes up from the bottom of the screen looks like something you
 * can throw back where it came from, and this one could not be — the only way
 * out was the cross in its corner. Now the sheet follows your thumb and drops
 * away if you send it far or fast enough.
 *
 * Deliberately not a hair trigger: a sheet with a list in it is scrolled far
 * more often than it is dismissed, so the drag only starts when the list is
 * already at its top, only once the finger has clearly committed downwards,
 * and only lets go after a real distance or a real flick. Anything shorter
 * springs back.
 *
 * The exit is driven from here rather than handed back to the stylesheet. The
 * page's own closing animation starts from the sheet's resting place, so a
 * sheet dragged halfway down the screen snapped back up to the top before
 * playing it — you let go and it jumped away from your thumb. It now carries
 * on from wherever your thumb left it, straight off the bottom edge, and the
 * `sheet-swiping` class keeps the stylesheet from overruling that.
 *
 * Once the sheet has the gesture, it has all of it. The list inside used to
 * keep scrolling and bouncing under the same finger, so pulling the sheet down
 * and then back up made the two fight and the sheet stutter. Now the browser's
 * own scroll is held off for the rest of that touch, the sheet follows the
 * finger alone, and once it is back at the top a finger that keeps going up
 * scrolls the list from there.
 */
export function useSheetDismiss(onClose: () => void) {
  const node = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  /** What scrolls under the finger, if anything: the sheet or a list in it. */
  const scroller = useRef<Element | null>(null);
  const dragging = useRef(false);
  const offset = useRef(0);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const move = (dy: number) => {
    const el = node.current;
    if (!el) return;
    // A spring-back from a previous drag may still be waiting to hand the
    // sheet back to the stylesheet; this one owns it now.
    window.clearTimeout(timer.current);
    offset.current = dy;
    el.classList.add('sheet-swiping');
    el.style.transition = 'none';
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };

  const springBack = () => {
    const el = node.current;
    if (!el) return;
    el.style.transition = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = '';
    offset.current = 0;
    // Handed back to the stylesheet once it has settled, so closing it with
    // the cross afterwards still plays the page's own exit.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      el.classList.remove('sheet-swiping');
      el.style.transition = '';
    }, 260);
  };

  const onTouchStart = (e: ReactTouchEvent) => {
    const el = node.current;
    const touch = e.touches[0];
    start.current = null;
    if (!el || !touch || e.touches.length > 1) return;
    // Halfway down a long list, a downward drag is a scroll. The list may be
    // the sheet itself or a part of it under a fixed head; a thumb on that
    // head always takes the sheet, wherever the list below it stands.
    scroller.current = null;
    for (let n = e.target as Element | null; n; n = n.parentElement) {
      if (n.scrollTop > 0) return;
      if (!scroller.current && n.scrollHeight > n.clientHeight + 1) {
        const overflow = getComputedStyle(n).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') scroller.current = n;
      }
      if (n === el) break;
    }
    // Fields and sliders inside the sheet get their own gestures.
    if ((e.target as Element | null)?.closest?.('input, textarea, select')) return;
    start.current = { x: touch.clientX, y: touch.clientY, at: performance.now() };
    dragging.current = false;
  };

  // Not a React handler: React listens passively, and only a listener that
  // may cancel the move can keep the list from scrolling along with the sheet.
  const onTouchMove = (e: TouchEvent) => {
    const from = start.current;
    const touch = e.touches[0];
    if (!from || !touch) return;
    const dy = touch.clientY - from.y;
    const dx = touch.clientX - from.x;
    if (!dragging.current) {
      if (Math.abs(dy) < START_PX && Math.abs(dx) < START_PX) return;
      // Upwards or sideways first: a scroll or somebody else's gesture, and
      // this touch is left alone from here on.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        start.current = null;
        return;
      }
      dragging.current = true;
    }
    if (e.cancelable) e.preventDefault();
    if (dy >= 0) {
      move(dy);
    } else {
      // Back at the top and still going up: from here it is the list's turn.
      move(0);
      if (scroller.current) scroller.current.scrollTop = -dy;
    }
  };
  const moveHandler = useRef(onTouchMove);
  moveHandler.current = onTouchMove;
  const listener = useRef((e: TouchEvent) => moveHandler.current(e));

  const ref = useCallback((el: HTMLDivElement | null) => {
    node.current?.removeEventListener('touchmove', listener.current);
    node.current = el;
    el?.addEventListener('touchmove', listener.current, { passive: false });
  }, []);

  const onTouchEnd = () => {
    const from = start.current;
    start.current = null;
    if (!dragging.current || !from) return;
    dragging.current = false;
    const travelled = offset.current;
    const speed = travelled / Math.max(1, performance.now() - from.at);
    if (travelled > CLOSE_PX || speed > FLICK_PX_PER_MS) {
      const el = node.current;
      if (el) {
        // Carries on the way it was going: from where your thumb let go, out
        // through the bottom of the screen.
        const away = Math.max(el.offsetHeight, window.innerHeight - el.getBoundingClientRect().top + offset.current) + 24;
        // No fade on the way: it is thrown, so it stays solid until it has
        // left the screen, at the speed it was already going.
        el.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.3, 0.55, 0.5, 1)`;
        el.style.transform = `translateY(${away}px)`;
      }
      offset.current = 0;
      onClose();
      return;
    }
    springBack();
  };

  return {
    ref,
    handlers: { onTouchStart, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
