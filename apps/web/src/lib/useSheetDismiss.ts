import { TouchEvent as ReactTouchEvent, useRef } from 'react';

/** How far down it has to come before letting go closes it. */
const CLOSE_PX = 120;
/** Or how fast, for a deliberate flick that never travelled that far. */
const FLICK_PX_PER_MS = 0.7;
/** Below this, a finger is still deciding whether it meant to scroll. */
const START_PX = 10;

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
 */
export function useSheetDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const dragging = useRef(false);
  const offset = useRef(0);

  const move = (dy: number) => {
    const el = ref.current;
    if (!el) return;
    offset.current = dy;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  };

  const springBack = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = '';
    offset.current = 0;
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
      // The sheet's own exit animation takes it from here; the inline
      // transform would otherwise fight it.
      const el = ref.current;
      if (el) {
        el.style.transition = '';
        el.style.transform = '';
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
