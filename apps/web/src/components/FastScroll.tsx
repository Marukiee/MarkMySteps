import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useExit } from '../lib/useExit';
import { Icon } from './Icon';
import './fastscroll.css';

/** Below this the list is short enough to scroll by hand. */
const MIN_RATIO = 2.5;
/** How long the grip stays visible after the last movement. */
const IDLE_MS = 1500;
/** Diameter of the grip; its travel is the track minus its own height. */
const SIZE = 46;

/**
 * A grip you can throw down a long list with, the way a photo library does.
 *
 * A trip of three months is a very long timeline, and getting to "somewhere in
 * the middle of August" by flicking takes a dozen throws. Dragging the grip
 * moves the whole list at once, and the bubble beside it says which day you
 * are passing, so you can aim rather than scroll and check.
 *
 * Nothing about its position goes through React: the node is moved directly,
 * once per frame. A component that re-rendered on every scroll event was the
 * thing making the list stutter it was supposed to be helping with.
 */
export function FastScroll({
  page,
  side,
}: {
  /** The page itself, which scrolls on a phone. */
  page: React.RefObject<HTMLElement | null>;
  /** The side column, which scrolls on a wide window. */
  side: React.RefObject<HTMLElement | null>;
}) {
  const [awake, setAwake] = useState(false);
  const [visible, closing] = useExit(awake, 220);
  const [dragging, setDragging] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  const gripRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  /** The pinned map, if this page has one: the track starts below it. */
  const pinnedRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef({ top: 0, height: 1, right: 8 });
  const fractionRef = useRef(0);
  const draggingRef = useRef(false);
  const idleTimer = useRef(0);
  const frameRef = useRef(0);
  const pendingY = useRef<number | null>(null);
  const marksRef = useRef<{ day: string; at: number }[]>([]);
  const labelRef = useRef<string | null>(null);
  const measuredAt = useRef(0);

  /** The scroller that is doing the scrolling at this window size. */
  const pick = useCallback((): HTMLElement | null => {
    for (const ref of [side, page]) {
      const el = ref.current;
      if (el && el.scrollHeight > el.clientHeight + 40) return el;
    }
    return null;
  }, [page, side]);

  /**
   * Where the grip may travel.
   *
   * Read from the layout, so it costs a reflow: done when the window changes
   * and when the map above it has moved, never on every frame of a scroll.
   */
  const measureTrack = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    let top = Math.max(rect.top, 0);
    const pinned = pinnedRef.current;
    if (pinned) {
      const box = pinned.getBoundingClientRect();
      // Only while it is actually pinned across the top; once it has scrolled
      // away the list starts at the top of the screen.
      if (box.top <= 4 && box.bottom > top) top = box.bottom;
    }
    top += 12;
    const bottom = Math.min(rect.bottom, window.innerHeight) - 96;
    trackRef.current = {
      top,
      height: Math.max(80, bottom - top),
      right: window.innerWidth - rect.right + 8,
    };
  }, []);

  /** Moves the node itself; React is not involved in where the grip sits. */
  const paint = useCallback(() => {
    const grip = gripRef.current;
    const track = trackRef.current;
    if (!grip) return;
    grip.style.right = `${track.right}px`;
    grip.style.top = `${track.top + fractionRef.current * (track.height - SIZE)}px`;
  }, []);

  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (!draggingRef.current) setAwake(false);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    pinnedRef.current = document.querySelector<HTMLElement>('.trip-map-panel');
    const el = pick();
    scrollerRef.current = el;
    if (el) {
      measureTrack(el);
      fractionRef.current = fractionOf(el);
      paint();
    }

    const onScroll = () => {
      // While a finger is on the grip it writes its own position; the scroll
      // it causes must not fight it.
      if (draggingRef.current) return;
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const scroller = scrollerRef.current ?? pick();
        if (!scroller) return;
        scrollerRef.current = scroller;
        if (scroller.scrollHeight < scroller.clientHeight * MIN_RATIO) {
          setAwake(false);
          return;
        }
        // The map above the list shrinks as the page scrolls, so the top of
        // the track moves with it. Read a few times a second rather than every
        // frame: the same frame has just written that map's height, and asking
        // for its box straight afterwards forces the browser to lay the page
        // out again mid-scroll — which is the stutter itself.
        const now = performance.now();
        if (now - measuredAt.current > 150) {
          measuredAt.current = now;
          measureTrack(scroller);
        }
        fractionRef.current = fractionOf(scroller);
        paint();
        wake();
      });
    };

    const onResize = () => {
      const scroller = pick();
      scrollerRef.current = scroller;
      if (scroller) {
        measureTrack(scroller);
        paint();
      }
    };

    const nodes = [page.current, side.current].filter((n): n is HTMLElement => !!n);
    for (const node of nodes) node.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      for (const node of nodes) node.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.clearTimeout(idleTimer.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [measureTrack, page, paint, pick, side, wake]);

  // The grip is only in the document once it is awake, so its first position
  // has to be written the moment it appears — before the browser paints, or it
  // flashes in the corner on its way to where it belongs.
  useLayoutEffect(() => {
    if (visible) paint();
  }, [visible, paint]);

  /**
   * Where each day of the list begins, measured once when a drag starts.
   *
   * Asking the DOM for every day heading on each move — a query plus a layout
   * read per pointer event — is what made the grip feel like it was running at
   * half speed. The list does not change while you are dragging it.
   */
  const measureDays = useCallback((el: HTMLElement) => {
    const nodes = el.querySelectorAll<HTMLElement>('[data-day]');
    marksRef.current = [...nodes].map((node) => ({
      day: node.dataset.day ?? '',
      at: node.offsetTop - el.offsetTop,
    }));
  }, []);

  const dayAt = useCallback((scrollTop: number): string | null => {
    const marks = marksRef.current;
    if (marks.length === 0) return null;
    let current = marks[0]!.day;
    for (const mark of marks) {
      if (mark.at <= scrollTop + 120) current = mark.day;
      else break;
    }
    return current;
  }, []);

  /** Follows the finger: one scroll write and one style write per frame. */
  const moveTo = useCallback(
    (clientY: number) => {
      pendingY.current = clientY;
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const y = pendingY.current;
        const el = scrollerRef.current;
        if (y === null || !el) return;
        const track = trackRef.current;
        const f = Math.min(1, Math.max(0, (y - track.top) / (track.height - SIZE)));
        el.scrollTop = f * (el.scrollHeight - el.clientHeight);
        fractionRef.current = f;
        paint();
        const day = formatDay(dayAt(el.scrollTop));
        if (day !== labelRef.current) {
          labelRef.current = day;
          setLabel(day);
        }
      });
    },
    [dayAt, paint],
  );

  if (!visible) return null;

  return (
    <div
      ref={gripRef}
      className={`fast-scroll ${dragging ? 'dragging' : ''} ${closing ? 'closing' : ''}`}
    >
      {dragging && label && <span className="fast-scroll-label">{label}</span>}
      <button
        type="button"
        className="fast-scroll-grip"
        aria-label="Snel scrollen"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          setDragging(true);
          setAwake(true);
          window.clearTimeout(idleTimer.current);
          const el = scrollerRef.current ?? pick();
          if (el) {
            scrollerRef.current = el;
            measuredAt.current = performance.now();
            measureTrack(el);
            measureDays(el);
          }
          moveTo(e.clientY);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          e.preventDefault();
          moveTo(e.clientY);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          draggingRef.current = false;
          setDragging(false);
          setLabel(null);
          labelRef.current = null;
          wake();
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragging(false);
          setLabel(null);
          labelRef.current = null;
          wake();
        }}
      >
        <Icon name="chevron-up" size={15} />
        <Icon name="chevron-down" size={15} />
      </button>
    </div>
  );
}

function fractionOf(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight;
  return max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
}

/** "12 aug 2026" — enough to aim with, short enough for a bubble. */
function formatDay(day: string | null): string | null {
  if (!day) return null;
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
