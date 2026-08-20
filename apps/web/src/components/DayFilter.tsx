import { useEffect, useRef, useState } from 'react';
import { useExit } from '../lib/useExit';
import { Icon } from './Icon';
import './dayfilter.css';

export interface TripDay {
  day: string; // YYYY-MM-DD
  points: number;
  photos: number;
}

/**
 * "Whole trip" or one of its days, as a second line under the live pill.
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
  const wrapRef = useRef<HTMLDivElement>(null);

  // Same dismissal as the traveller picker: a tap outside, or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (days.length < 2) return null;

  function pick(day: string | null) {
    setOpen(false);
    onChange(day);
  }

  return (
    <div className="day-filter" ref={wrapRef}>
      <button
        type="button"
        className={`day-filter-btn ${value ? 'on' : ''} ${open ? 'open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" size={13} />
        <span className="day-filter-label">{value ? longDay(value) : 'Hele reis'}</span>
        <Icon name="chevron-down" size={14} className="day-filter-caret" />
      </button>

      {mounted && (
        <div className={`day-filter-menu card ${closing ? 'closing' : ''}`}>
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
        </div>
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
