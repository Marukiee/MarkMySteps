import {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { getTripSideWidth, setTripSideWidth } from '../lib/prefs';

const DEFAULT_WIDTH = 400;
const MIN_SIDE = 320;
/** The map never gets narrower than this: below it a map is a strip, not a map. */
const MIN_MAP = 360;
const KEY_STEP = 32;

const desktop = () => window.matchMedia('(min-width: 901px)').matches;

/**
 * The grip between the map and the timeline on a laptop.
 *
 * A fixed 400px column left the map taking most of a small screen, and which
 * of the two deserves the room depends on what you are doing with the trip.
 * Dragging writes `--side-width` onto the page's grid; the map follows through
 * its own ResizeObserver. The width is remembered per device, like the map
 * style. On a phone the grid is gone and so is this.
 */
export function SideResizer({ host }: { host: RefObject<HTMLElement | null> }) {
  /** What is on screen now, after clamping to this window. */
  const widthRef = useRef(DEFAULT_WIDTH);
  /** What was chosen: comes back when the window is wide enough again. */
  const wantedRef = useRef(DEFAULT_WIDTH);

  const clamp = useCallback(
    (px: number) => {
      const el = host.current;
      if (!el) return px;
      const style = getComputedStyle(el);
      const inner =
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        parseFloat(style.columnGap || '0');
      return Math.round(Math.max(MIN_SIDE, Math.min(px, inner - MIN_MAP)));
    },
    [host],
  );

  const apply = useCallback(
    (px: number) => {
      widthRef.current = clamp(px);
      host.current?.style.setProperty('--side-width', `${widthRef.current}px`);
    },
    [clamp, host],
  );

  // The remembered width, and again whenever the window changes: a width that
  // fitted a wide monitor must not squeeze the map off a smaller one.
  useEffect(() => {
    try {
      wantedRef.current = getTripSideWidth() ?? DEFAULT_WIDTH;
    } catch {
      // Storage blocked: the default width it is.
    }
    const fit = () => {
      if (desktop()) apply(wantedRef.current);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [apply]);

  const save = (px: number | null) => {
    wantedRef.current = px ?? DEFAULT_WIDTH;
    try {
      setTripSideWidth(px);
    } catch {
      // Not remembered this time; the drag itself still worked.
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = host.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('side-resizing');

    const style = getComputedStyle(el);
    const padRight = parseFloat(style.paddingRight);
    const halfGap = parseFloat(style.columnGap || '0') / 2;
    let frame = 0;

    const onMove = (ev: PointerEvent) => {
      const right = el.getBoundingClientRect().right;
      cancelAnimationFrame(frame);
      // One write per frame: the map redraws on every width it is given.
      frame = requestAnimationFrame(() => apply(right - padRight - halfGap - ev.clientX));
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('side-resizing');
      save(widthRef.current);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // The separator sits left of the column: left makes the column wider.
    const delta = e.key === 'ArrowLeft' ? KEY_STEP : e.key === 'ArrowRight' ? -KEY_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    apply(widthRef.current + delta);
    save(widthRef.current);
  };

  return (
    <div
      className="side-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breedte van kaart en tijdlijn"
      title="Sleep om de kaart breder of smaller te maken · dubbelklik voor standaard"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        apply(DEFAULT_WIDTH);
        save(null);
      }}
    />
  );
}
