import { useMemo } from 'react';
import { Flag } from './Flag';
import './stopjump.css';

export interface JumpStop {
  name: string;
  countryCode: string | null;
  arrivalDate: string;
  departureDate: string;
}

/** Route legs are not places you were; they are the line in between. */
const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

interface Target {
  name: string;
  countryCode: string | null;
  day: string;
}

/**
 * The trip's places as a row of pills, each one a jump into the timeline.
 *
 * A trip of three months is a hundred day sections deep, and "where are the
 * photos of Lissabon" was a question you answered by scrolling until you
 * recognised something. The stops are already known — this puts them at the
 * top of the list and takes you to the first day of the one you tap.
 *
 * Days that are not on screen (a day filter is on, or that stop has no photos)
 * have nothing to jump to, so their stop is left out rather than offered and
 * then doing nothing.
 */
export function StopJump({ stops, days }: { stops: JumpStop[]; days: string[] }) {
  const targets = useMemo<Target[]>(() => {
    const sorted = [...days].sort();
    const out: Target[] = [];
    for (const stop of stops) {
      if (LEG_NAMES.has(stop.name)) continue;
      const from = stop.arrivalDate.slice(0, 10);
      const to = stop.departureDate.slice(0, 10);
      const day = sorted.find((d) => d >= from && d <= to);
      if (!day) continue;
      // The same city twice in a row (a stop split over two entries, a day trip
      // back to where you slept) is one pill, not two that land on the spot.
      if (out.some((t) => t.day === day && t.name === stop.name)) continue;
      out.push({ name: stop.name, countryCode: stop.countryCode, day });
    }
    return out.sort((a, b) => a.day.localeCompare(b.day));
  }, [stops, days]);

  // One pill is not a shortcut, it is a label for the thing you are looking at.
  if (targets.length < 2) return null;

  return (
    <nav className="stop-jump" aria-label="Naar een stop">
      <div className="stop-jump-rail">
        {targets.map((target) => (
          <button
            key={`${target.day}-${target.name}`}
            type="button"
            className="stop-jump-pill"
            onClick={() => jumpToDay(target.day)}
          >
            <Flag code={target.countryCode} size={14} />
            <span className="stop-jump-name">{target.name}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * Puts the day section at the top of whatever is doing the scrolling.
 *
 * Where that lands is CSS's business (`scroll-margin-top` on the section): on a
 * phone the map is pinned over the top of the list, and a day scrolled to the
 * literal top of the page arrives behind it.
 */
export function jumpToDay(day: string) {
  const el = document.querySelector<HTMLElement>(`.timeline-day[data-day="${day}"]`);
  if (!el) return;
  // The grip is for aiming by hand; it has no part in a jump it did not make.
  window.dispatchEvent(new Event('mms:fastscroll-hide'));
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
