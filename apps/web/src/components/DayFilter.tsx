import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { t, intlLocale } from '../i18n';
import { useExit } from '../lib/useExit';
import { nativeMenusAvailable, showNativeMenu } from '../lib/nativeMenu';
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
  placeOf,
  tripStart,
}: {
  days: TripDay[];
  value: string | null;
  onChange: (day: string | null) => void;
  /** Where the trip was that day, for the title of its row. */
  placeOf?: (day: string) => string | null;
  /** The first day of the trip, so a row can say which day of it this was. */
  tripStart?: string;
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

    // Half the screen at most: a list as tall as the map hides the very thing
    // you are choosing a day of. The rest is reached by scrolling it.
    const ceiling = Math.round(window.innerHeight * 0.44);
    if (above >= below) {
      setAnchor({
        left: Math.max(12, left),
        bottom: window.innerHeight - rect.top + 8,
        width: rect.width,
        maxHeight: Math.min(ceiling, above - 8),
      });
    } else {
      setAnchor({
        left: Math.max(12, left),
        top: rect.bottom + 8,
        width: rect.width,
        maxHeight: Math.min(ceiling, below - 8),
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
    // Scrolling the page puts the menu away. The pill is pinned to a map that
    // moves as the page scrolls, and a list chasing it down the screen is
    // worse than a list that simply closes. Scrolling inside the list itself
    // is how you reach the far end of a long trip, so that is left alone.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('click', away);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  if (days.length < 2) return null;

  function pick(day: string | null) {
    setOpen(false);
    onChange(day);
  }

  /** On the iPhone the list is the system's own menu, the whole trip above a
   *  line and the days under it. */
  function toggle() {
    if (open || !nativeMenusAvailable() || !btnRef.current) {
      setOpen((o) => !o);
      return;
    }
    void showNativeMenu(btnRef.current, [
      [
        {
          id: '',
          title: t('trip.dayFilter.wholeTrip'),
          subtitle: t('common.days', { count: days.length }),
          checked: value === null,
        },
      ],
      days.map((day) => ({
        id: day.day,
        title: longDay(day.day),
        subtitle: t('common.photosCount', { count: day.photos }),
        checked: value === day.day,
      })),
    ])
      .then((id) => {
        if (id !== null) onChange(id || null);
      })
      // This iOS cannot open one itself: the page's menu can.
      .catch(() => setOpen(true));
  }

  return (
    <div className="day-filter">
      <button
        ref={btnRef}
        type="button"
        className={`day-filter-btn ${value ? 'on' : ''} ${open ? 'open' : ''}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="calendar" size={14} />
        <span className="day-filter-label">{value ? longDay(value) : t('trip.dayFilter.wholeTrip')}</span>
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
            {/* As the native day sheet: a tile on the left (the calendar for
                the whole trip, the date for a day), the place as the title
                with "Dag N" under it, and a check on the chosen one. The
                date is on the tile, so it is never written twice. */}
            <DayRow
              chosen={value === null}
              tile={<Icon name="calendar" size={20} />}
              title={t('trip.dayFilter.wholeTrip')}
              subtitle={t('common.days', { count: days.length })}
              onClick={() => pick(null)}
            />
            <div className="day-filter-rule" />
            {days.map((day, index) => {
              const place = placeOf?.(day.day) ?? null;
              const first = tripStart ?? days[0]!.day;
              const nth = Math.round((Date.parse(`${day.day}T12:00:00Z`) - Date.parse(`${first.slice(0, 10)}T12:00:00Z`)) / 86_400_000) + 1;
              const dayN = t('trip.dayFilter.dayN', { n: nth });
              return (
                <DayRow
                  key={day.day}
                  delay={Math.min(index, 12) * 16}
                  chosen={value === day.day}
                  tile={
                    <span className="day-tile-date">
                      <strong>{Number(day.day.slice(8, 10))}</strong>
                      <small>{weekday(day.day)}</small>
                    </span>
                  }
                  title={place ?? dayN}
                  subtitle={place ? dayN : monthName(day.day)}
                  photos={day.photos}
                  onClick={() => pick(day.day)}
                />
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** One row of the list: tile, title and subtitle, and a check or the photo count. */
function DayRow({
  chosen,
  tile,
  title,
  subtitle,
  photos,
  delay = 0,
  onClick,
}: {
  chosen: boolean;
  tile: React.ReactNode;
  title: string;
  subtitle: string;
  photos?: number;
  delay?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`day-filter-item ${chosen ? 'active' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
      onClick={onClick}
      aria-pressed={chosen}
    >
      <span className="day-tile">{tile}</span>
      <span className="day-filter-text">
        <span className="day-filter-item-name">{title}</span>
        <span className="day-filter-sub">{subtitle}</span>
      </span>
      <span className="day-filter-end">
        {chosen ? (
          <span className="day-filter-check" key="check">
            <Icon name="check" size={18} />
          </span>
        ) : photos !== undefined ? (
          // A day that was tracked but not photographed says 0, not nothing.
          <span className="day-filter-count" key="count">
            <Icon name="camera" size={12} /> {photos}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function weekday(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: 'short', timeZone: 'UTC' });
}

function monthName(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(), { month: 'long', timeZone: 'UTC' });
}

/** "di 12 aug" — short enough for the pill, unambiguous in a list. */
function longDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString(intlLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
