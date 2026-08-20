import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './fastscroll.css';

/** Below this the list is short enough to scroll by hand. */
const MIN_RATIO = 2.5;
/** How long the grip stays visible after the last movement. */
const IDLE_MS = 1600;

/**
 * A grip you can throw down a long list with, the way a photo library does.
 *
 * A trip of three months is a very long timeline, and getting to "somewhere in
 * the middle of August" by flicking takes a dozen throws. Dragging the grip
 * moves the whole list at once, and the bubble beside it says which day you
 * are passing, so you can aim rather than scroll and check.
 *
 * It only appears on lists long enough to be worth it, and only while you are
 * actually moving; a permanent bar down the side of a photo grid is one more
 * thing sitting on top of the photographs.
 */
export function FastScroll({
  scrollers,
}: {
  /** Candidates; the one that actually scrolls at this width is used. */
  scrollers: React.RefObject<HTMLElement | null>[];
}) {
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fraction, setFraction] = useState(0);
  const [label, setLabel] = useState<string | null>(null);
  const [track, setTrack] = useState<{ top: number; height: number; right: number } | null>(null);
  const idleTimer = useRef(0);
  const activeRef = useRef<HTMLElement | null>(null);
  /** Scroll fires many times a frame; React must not hear all of them. */
  const frameRef = useRef(0);
  const fractionRef = useRef(0);

  /** The scroller that is doing the scrolling at this window size. */
  const pick = useCallback((): HTMLElement | null => {
    for (const ref of scrollers) {
      const el = ref.current;
      if (el && el.scrollHeight > el.clientHeight + 40) return el;
    }
    return null;
  }, [scrollers]);

  const measure = useCallback(() => {
    const el = pick();
    activeRef.current = el;
    if (!el) {
      setTrack(null);
      return null;
    }
    const rect = el.getBoundingClientRect();
    // The grip lives inside the visible part of the scroller, kept clear of
    // the notch at the top and the tab bar at the bottom.
    const top = Math.max(rect.top, 0) + 12;
    const bottom = Math.min(rect.bottom, window.innerHeight) - 96;
    setTrack({ top, height: Math.max(80, bottom - top), right: window.innerWidth - rect.right + 8 });
    return el;
  }, [pick]);

  // Follow the list: position, and whether the grip is worth showing at all.
  useEffect(() => {
    const onScroll = () => {
      // One update per frame, and only when the grip would actually move: a
      // long timeline fires scroll events faster than the page can paint, and
      // re-rendering on each of them is felt as the list stuttering.
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const el = activeRef.current ?? measure();
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        if (el.scrollHeight < el.clientHeight * MIN_RATIO) {
          setVisible(false);
          return;
        }
        const next = max > 0 ? el.scrollTop / max : 0;
        if (!dragging && Math.abs(next - fractionRef.current) > 0.002) {
          fractionRef.current = next;
          setFraction(next);
        }
        setVisible(true);
        window.clearTimeout(idleTimer.current);
        idleTimer.current = window.setTimeout(
          () => setVisible((v) => (dragging ? v : false)),
          IDLE_MS,
        );
      });
    };

    measure();
    // Both candidates are listened to: which one scrolls changes with the
    // window, and a resize is not the only way that happens.
    const nodes = scrollers.map((ref) => ref.current).filter((n): n is HTMLElement => !!n);
    for (const node of nodes) node.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      for (const node of nodes) node.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      window.clearTimeout(idleTimer.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [dragging, measure, scrollers]);

  /** The day the list is showing at this scroll position, if it says. */
  const dayAt = useCallback((el: HTMLElement, scrollTop: number): string | null => {
    const days = el.querySelectorAll<HTMLElement>('[data-day]');
    if (days.length === 0) return null;
    let current: string | null = null;
    for (const node of days) {
      // offsetTop is relative to the offset parent; the difference between two
      // of them is what matters, so a shared parent is enough.
      if (node.offsetTop - el.offsetTop <= scrollTop + 80) current = node.dataset.day ?? null;
      else break;
    }
    return current ?? days[0]?.dataset.day ?? null;
  }, []);

  const moveTo = useCallback(
    (clientY: number) => {
      const el = activeRef.current;
      if (!el || !track) return;
      const f = Math.min(1, Math.max(0, (clientY - track.top) / track.height));
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = f * max;
      fractionRef.current = f;
      setFraction(f);
      setLabel(formatDay(dayAt(el, f * max)));
    },
    [dayAt, track],
  );

  if (!track || (!visible && !dragging)) return null;

  const size = 46;
  const top = track.top + fraction * (track.height - size);

  return (
    <div
      className={`fast-scroll ${dragging ? 'dragging' : ''}`}
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
          measure();
          moveTo(e.clientY);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          e.preventDefault();
          moveTo(e.clientY);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
          setLabel(null);
          window.clearTimeout(idleTimer.current);
          idleTimer.current = window.setTimeout(() => setVisible(false), IDLE_MS);
        }}
        onPointerCancel={() => {
          setDragging(false);
          setLabel(null);
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
