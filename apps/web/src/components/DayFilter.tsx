import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useExit } from '../lib/useExit';
import { Icon } from './Icon';
import './dayfilter.css';

export interface TripDay {
  day: string; // YYYY-MM-DD
  points: number;
  photos: number;
}

/**
 * "Whole trip" or one of its days, as a pill above the traveller picker.
 *
 * A trip's map is every day at once: months of line, and photos three
 * countries apart on the same screen. Picking a day is the only way to see
 * what one day looked like, and it is the question you ask most often about
 * a trip you have already made.
 *
 * Not a slider. A slider makes you hunt for the day you meant and moves the
 * map while you do it; this asks once and then stays where you put it.
 */
export function DayFilter({
  days,
  value,
  onChange,
}: {
  days: TripDay[];
  value: string | null;
  onChange: (day: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, closing] = useExit(open, 160);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Where the menu hangs. The map panel clips anything drawn inside it, so the
  // menu is drawn on the page itself and told where the pill is.
  const [anchor, setAnchor] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  /**
   * Hangs the menu off the pill, on whichever side it fits.
   *
   * The pill sits near the bottom of the map, so the list normally drops
   * upwards — but a trip of three months has more days than there is screen
   * above it, and the list was running off the top with its first days
   * unreachable. Whichever side has more room gets the menu, and the menu is
   * never taller than that room.
   */
  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const above = rect.top - 12;
    const below = window.innerHeight - rect.bottom - 12;
    const width = Math.max(rect.width, 224);
    // Keep it on screen sideways as well: the pill is at the left edge, but a
    // long day name makes the menu wider than the pill.
    const left = Math.min(rect.left, window.innerWidth - width - 12);

    if (above >= below) {
      setAnchor({
        left: Math.max(12, left),
        bottom: window.innerHeight - rect.top + 8,
        width: rect.width,
        maxHeight: above - 8,
      });
    } else {
      setAnchor({
        left: Math.max(12, left),
        top: rect.bottom + 8,
        width: rect.width,
        maxHeight: below - 8,
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    place();
    // Click, not pointerdown: a finger going down to scroll is not a tap
    // elsewhere, and closing on it made the menu vanish under your thumb.
    const away = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('click', away);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', place);
    // The map panel is sticky and the page scrolls under it, so the pill moves.
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  if (days.length < 2) return null;

  function pick(day: string | null) {
    setOpen(false);
    onChange(day);
  }

  return (
    <div className="day-filter">
      <button
        ref={btnRef}
        type="button"
        className={`day-filter-btn ${value ? 'on' : ''} ${open ? 'open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" size={13} />
        <span className="day-filter-label">{value ? longDay(value) : 'Hele reis'}</span>
        <Icon name="chevron-down" size={14} className="day-filter-caret" />
      </button>

      {mounted &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            className={`day-filter-menu card ${closing ? 'closing' : ''} ${
              anchor.top !== undefined ? 'below' : ''
            }`}
            style={{
              left: anchor.left,
              top: anchor.top,
              bottom: anchor.bottom,
              minWidth: anchor.width,
              maxHeight: anchor.maxHeight,
            }}
          >
            <button
              type="button"
              className={`day-filter-item ${value === null ? 'active' : ''}`}
              onClick={() => pick(null)}
            >
              <span className="day-filter-item-name">Hele reis</span>
              <span className="day-filter-count">{days.length} dagen</span>
              <span className={`day-filter-check ${value === null ? 'on' : ''}`}>
                <Icon name="check" size={14} />
              </span>
            </button>
            <div className="day-filter-rule" />
            {days.map((day, index) => (
              <button
                key={day.day}
                type="button"
                className={`day-filter-item ${value === day.day ? 'active' : ''}`}
                // Staggered so the list unrolls instead of appearing whole. Capped,
                // because on a three-month trip the last row would arrive next week.
                style={{ animationDelay: `${Math.min(index, 12) * 16}ms` }}
                onClick={() => pick(day.day)}
              >
                <span className="day-filter-item-name">{longDay(day.day)}</span>
                <span className="day-filter-count">
                  {day.photos > 0 && (
                    <>
                      <Icon name="camera" size={12} /> {day.photos}
                    </>
                  )}
                </span>
                <span className={`day-filter-check ${value === day.day ? 'on' : ''}`}>
                  <Icon name="check" size={14} />
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** "di 12 aug" — short enough for the pill, unambiguous in a list. */
function longDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString('nl-NL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
