import { TouchEvent as ReactTouchEvent, useEffect, useRef } from 'react';

/** How far down it has to come before letting go closes it. */
const CLOSE_PX = 120;
/** Or how fast, for a deliberate flick that never travelled that far. */
const FLICK_PX_PER_MS = 0.7;
/** Below this, a finger is still deciding whether it meant to scroll. */
const START_PX = 10;
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
 */
export function useSheetDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const dragging = useRef(false);
  const offset = useRef(0);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const move = (dy: number) => {
    const el = ref.current;
    if (!el) return;
    // A spring-back from a previous drag may still be waiting to hand the
    // sheet back to the stylesheet; this one owns it now.
    window.clearTimeout(timer.current);
    offset.current = dy;
    el.classList.add('sheet-swiping');
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  };

  const springBack = () => {
    const el = ref.current;
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
    const el = ref.current;
    const touch = e.touches[0];
    if (!el || !touch || e.touches.length > 1) return;
    // Halfway down a long list, a downward drag is a scroll.
    if (el.scrollTop > 0) return;
    // Fields and sliders inside the sheet get their own gestures.
    if ((e.target as Element | null)?.closest?.('input, textarea, select')) return;
    start.current = { x: touch.clientX, y: touch.clientY, at: performance.now() };
    dragging.current = false;
  };

  const onTouchMove = (e: ReactTouchEvent) => {
    const from = start.current;
    const touch = e.touches[0];
    if (!from || !touch) return;
    const dy = touch.clientY - from.y;
    const dx = touch.clientX - from.x;
    if (!dragging.current) {
      // Downwards, and more down than sideways, or this is somebody else's
      // gesture and we should stay out of it.
      if (dy < START_PX || Math.abs(dx) > Math.abs(dy)) return;
      dragging.current = true;
    }
    // Upwards past the top does not lift the sheet off the screen.
    move(Math.max(0, dy));
  };

  const onTouchEnd = () => {
    const from = start.current;
    start.current = null;
    if (!dragging.current || !from) return;
    dragging.current = false;
    const travelled = offset.current;
    const speed = travelled / Math.max(1, performance.now() - from.at);
    if (travelled > CLOSE_PX || speed > FLICK_PX_PER_MS) {
      const el = ref.current;
      if (el) {
        // Carries on the way it was going: from where your thumb let go, out
        // through the bottom of the screen.
        const away = Math.max(el.offsetHeight, window.innerHeight - el.getBoundingClientRect().top);
        el.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.32, 0, 0.67, 0), opacity ${EXIT_MS}ms linear`;
        el.style.transform = `translateY(${away}px)`;
        el.style.opacity = '0';
      }
      offset.current = 0;
      onClose();
      return;
    }
    springBack();
  };

  return {
    ref,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
