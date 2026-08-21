import { useCallback, useEffect, useRef, useState } from 'react';
import { useExit } from '../lib/useExit';
import { Icon } from './Icon';
import './fastscroll.css';

/** Below this the list is short enough to scroll by hand. */
const MIN_RATIO = 2.5;
/** How long the grip stays visible after the last movement. */
const IDLE_MS = 1500;

/**
 * A grip you can throw down a long list with, the way a photo library does.
 *
 * A trip of three months is a very long timeline, and getting to "somewhere in
 * the middle of August" by flicking takes a dozen throws. Dragging the grip
 * moves the whole list at once, and the bubble beside it says which day you
 * are passing, so you can aim rather than scroll and check.
 *
 * Its track starts under whatever is pinned across the top — on a trip that is
 * the map, and a grip sitting over the map points at nothing.
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
  const [fraction, setFraction] = useState(0);
  const [label, setLabel] = useState<string | null>(null);
  const [track, setTrack] = useState<{ top: number; height: number; right: number } | null>(null);
  const idleTimer = useRef(0);
  const activeRef = useRef<HTMLElement | null>(null);
  /** Scroll fires many times a frame; React must not hear all of them. */
  const frameRef = useRef(0);
  const fractionRef = useRef(0);
  const draggingRef = useRef(false);
  draggingRef.current = dragging;
  /** The grip itself, moved directly while a finger is on it. */
  const gripRef = useRef<HTMLDivElement>(null);
  /** Where every day of the list starts, measured once when the drag begins. */
  const marksRef = useRef<{ day: string; at: number }[]>([]);
  const pendingY = useRef<number | null>(null);
  const dragFrame = useRef(0);
  const labelRef = useRef<string | null>(null);

  /** The scroller that is doing the scrolling at this window size. */
  const pick = useCallback((): HTMLElement | null => {
    for (const ref of [side, page]) {
      const el = ref.current;
      if (el && el.scrollHeight > el.clientHeight + 40) return el;
    }
    return null;
  }, [page, side]);

  const measure = useCallback(() => {
    const el = pick();
    activeRef.current = el;
    if (!el) {
      setTrack(null);
      return null;
    }
    const rect = el.getBoundingClientRect();
    // The map is pinned across the top of the page and the list scrolls under
    // it; the grip belongs to the list, so its track starts where the list
    // becomes visible.
    let top = Math.max(rect.top, 0);
    for (const node of document.querySelectorAll<HTMLElement>('.trip-map-panel')) {
      const position = getComputedStyle(node).position;
      if (position !== 'sticky' && position !== 'fixed') continue;
      const box = node.getBoundingClientRect();
      if (box.top <= 4) top = Math.max(top, box.bottom);
    }
    top += 12;
    const bottom = Math.min(rect.bottom, window.innerHeight) - 96;
    setTrack({ top, height: Math.max(80, bottom - top), right: window.innerWidth - rect.right + 8 });
    return el;
  }, [pick]);

  // Follow the list: position, and whether the grip is worth showing at all.
  useEffect(() => {
    const wake = () => {
      setAwake(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        if (!draggingRef.current) setAwake(false);
      }, IDLE_MS);
    };

    const onScroll = () => {
      // One update per frame, and only when the grip would actually move: a
      // long timeline fires scroll events faster than the page can paint, and
      // re-rendering on each of them is felt as the list stuttering.
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const el = activeRef.current ?? measure();
        if (!el) return;
        if (el.scrollHeight < el.clientHeight * MIN_RATIO) {
          setAwake(false);
          return;
        }
        measure();
        const max = el.scrollHeight - el.clientHeight;
        const next = max > 0 ? el.scrollTop / max : 0;
        if (!draggingRef.current && Math.abs(next - fractionRef.current) > 0.002) {
          fractionRef.current = next;
          setFraction(next);
        }
        wake();
      });
    };

    measure();
    const nodes = [page.current, side.current].filter((n): n is HTMLElement => !!n);
    for (const node of nodes) node.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      for (const node of nodes) node.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      window.clearTimeout(idleTimer.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // Refs are stable; re-subscribing on every render is what stopped the
    // idle timer from ever reaching the end of its wait.
  }, [measure, page, side]);

  /**
   * Where each day of the list begins, measured once.
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

  /**
   * Follows the finger.
   *
   * The scroll and the grip's position are written straight to the DOM, once
   * per frame; React only hears about the date on the bubble, and only when it
   * changes. Going through state for the position meant a re-render for every
   * pointer event, which is exactly as smooth as it sounds.
   */
  const moveTo = useCallback(
    (clientY: number) => {
      pendingY.current = clientY;
      if (dragFrame.current) return;
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = 0;
        const y = pendingY.current;
        const el = activeRef.current;
        if (y === null || !el || !track) return;
        const f = Math.min(1, Math.max(0, (y - track.top) / track.height));
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = f * max;
        fractionRef.current = f;
        if (gripRef.current) {
          gripRef.current.style.top = `${track.top + f * (track.height - 46)}px`;
        }
        const day = formatDay(dayAt(f * max));
        if (day !== labelRef.current) {
          labelRef.current = day;
          setLabel(day);
        }
      });
    },
    [dayAt, track],
  );

  if (!track || !visible) return null;

  const size = 46;
  // While a finger is on it the position is written straight to the node; a
  // re-render for the date bubble must not put the old one back.
  const top = track.top + (dragging ? fractionRef.current : fraction) * (track.height - size);

  return (
    <div
      ref={gripRef}
      className={`fast-scroll ${dragging ? 'dragging' : ''} ${closing ? 'closing' : ''}`}
      style={{ top: `${top}px`, right: `${track.right}px` }}
    >
      {dragging && label && <span className="fast-scroll-label">{label}</span>}
      <button
        type="button"
        className="fast-scroll-grip"
        aria-label="Snel scrollen"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          setAwake(true);
          const el = measure();
          if (el) measureDays(el);
          moveTo(e.clientY);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          e.preventDefault();
          moveTo(e.clientY);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
          setLabel(null);
          labelRef.current = null;
          // React owns the position again; it must start from where the finger
          // left it rather than from the last value it happened to hear about.
          setFraction(fractionRef.current);
          window.clearTimeout(idleTimer.current);
          idleTimer.current = window.setTimeout(() => setAwake(false), IDLE_MS);
        }}
        onPointerCancel={() => {
          setDragging(false);
          setLabel(null);
          labelRef.current = null;
          setFraction(fractionRef.current);
        }}
      >
        <Icon name="chevron-up" size={15} />
        <Icon name="chevron-down" size={15} />
      </button>
    </div>
  );
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
