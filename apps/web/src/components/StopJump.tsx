import { ReactNode, useCallback, useMemo, useState } from 'react';
import { haversineKm, STOP_NEAR_KM } from '../lib/arc';
import './stopjump.css';

export interface JumpStop {
  name: string;
  countryCode: string | null;
  latitude?: number | null;
  longitude?: number | null;
  arrivalDate: string;
  departureDate: string;
  /** Set on a day trip, which hangs off a stop rather than being one. */
  parentStopId?: string | null;
  /** The photo the trip's organiser picked as this stop's face, if any. */
  coverMediaId?: string | null;
}

/** Enough of a photo to place it in time and space. */
export interface JumpPhoto {
  id: string;
  takenAt: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** Route legs are not places you were; they are the line in between. */
const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

interface Target {
  name: string;
  day: string;
  /** A photo from that place, as the face of the tile. */
  photoId: string | null;
  /**
   * The photo to land on, when one of them was actually taken there.
   *
   * A day trip shares its day with the stop it hangs off, and often with a
   * second day trip: three places, one date, one day section. Landing at the
   * top of that section puts you at the waterfalls you saw in the morning
   * when you asked for the natural bridge you saw after it.
   */
  anchorId: string | null;
}

/**
 * The photo that shows this place, out of everything taken while you were
 * there.
 *
 * Time alone was picking the wrong one. On a travel day you photograph the
 * morning in the town you are leaving and arrive somewhere else after lunch,
 * and the first photo of that day — the one the second stop's tile was
 * wearing — is a picture of the first stop. So position decides where it can:
 * of the photos taken during the stop, the earliest one taken near it. Only
 * when nothing has coordinates does the clock get the last word.
 */
function faceOf(
  stop: JumpStop,
  media: JumpPhoto[],
  from: string,
  to: string,
  day: string,
): { id: string; near: boolean } | null {
  const inRange = media.filter((m) => {
    const taken = m.takenAt.slice(0, 10);
    return taken >= from && taken <= to;
  });
  if (stop.latitude != null && stop.longitude != null) {
    const here: [number, number] = [stop.longitude, stop.latitude];
    const located = inRange
      .filter((m) => m.latitude != null && m.longitude != null)
      .map((m) => ({ item: m, km: haversineKm([m.longitude!, m.latitude!], here) }));
    // Taken there: the first one, so the tile shows the place as you found it.
    const near = located.find((m) => m.km <= STOP_NEAR_KM);
    if (near) return { id: near.item.id, near: true };
    // Nothing was taken there, but something has coordinates: the nearest of
    // those still beats the earliest, which on a travel day is a picture of
    // the town you left that morning.
    if (located.length > 0) {
      const closest = located.reduce((a, b) => (b.km < a.km ? b : a));
      return { id: closest.item.id, near: false };
    }
  }
  const any = inRange[0] ?? media.find((m) => m.takenAt.slice(0, 10) === day);
  return any ? { id: any.id, near: false } : null;
}

/**
 * The trip's places as a row of small photo tiles, each one a jump into the
 * timeline.
 *
 * A trip of three months is a hundred day sections deep, and "where are the
 * photos of Lissabon" was a question you answered by scrolling until you
 * recognised something. The stops are already known — this puts them at the
 * top of the list, each one wearing a picture taken there, and takes you to
 * the first day of the one you tap.
 *
 * Days that are not on screen (a day filter is on, or that stop has no photos)
 * have nothing to jump to, so their stop is left out rather than offered and
 * then doing nothing.
 */
export function StopJump({
  stops,
  days,
  media = [],
  renderThumb,
}: {
  stops: JumpStop[];
  days: string[];
  /** Enough of the trip's photos to pick a face for each tile. */
  media?: JumpPhoto[];
  /**
   * How this page loads a thumbnail: authenticated in the app, plain on a link.
   *
   * `onMissing` is called when that picture cannot be produced, which on this
   * rail means the chosen cover was deleted in Immich. The tile then falls
   * back to a photo taken at the place, the same one it would have picked if
   * nobody had chosen a cover at all.
   */
  renderThumb?: (mediaId: string, onMissing: () => void) => ReactNode;
}) {
  /** Chosen covers that turned out not to resolve to a picture any more. */
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const markGone = useCallback((id: string) => {
    setGone((before) => (before.has(id) ? before : new Set(before).add(id)));
  }, []);

  const targets = useMemo<Target[]>(() => {
    const sorted = [...days].sort();
    const out: Target[] = [];
    for (const stop of stops) {
      if (LEG_NAMES.has(stop.name)) continue;
      const from = stop.arrivalDate.slice(0, 10);
      const to = stop.departureDate.slice(0, 10);
      const day = sorted.find((d) => d >= from && d <= to);
      if (!day) continue;
      // The same city twice in a row (a stop split over two entries) is one
      // pill, not two that land on the spot.
      if (out.some((t) => t.day === day && t.name === stop.name)) continue;
      // The organiser's own choice first, otherwise a photo taken there. A
      // choice that no longer loads counts as no choice.
      const cover = stop.coverMediaId && !gone.has(stop.coverMediaId) ? stop.coverMediaId : null;
      const face = faceOf(stop, media, from, to, day);
      // A day trip is not a stop on the route, and putting every one of them
      // on the rail doubled its length on a trip that made a lot of them. It
      // earns its tile by having something to show: a photo actually taken
      // there, not merely one taken on the day you went.
      if (stop.parentStopId && !cover && !face?.near) continue;
      out.push({
        name: stop.name,
        day,
        photoId: cover ?? face?.id ?? null,
        // Taken there beats chosen for it: `faceOf` hands back the earliest
        // photo within reach of the stop, which is the moment you arrived.
        anchorId: face?.near ? face.id : cover,
      });
    }
    return out.sort((a, b) => a.day.localeCompare(b.day));
  }, [stops, days, media, gone]);

  // One tile is not a shortcut, it is a label for the thing you are looking at.
  if (targets.length < 2) return null;

  return (
    <nav className="stop-jump" aria-label="Naar een stop">
      {/* A row of photographs with no word over it reads as the top of the
          timeline rather than as a way into it. */}
      <h3 className="stop-jump-title">Plaatsen</h3>
      <div className="stop-jump-rail">
        {targets.map((target) => (
          <button
            key={`${target.day}-${target.name}`}
            type="button"
            className={`stop-jump-tile ${target.photoId ? 'has-photo' : ''}`}
            onClick={() => jumpToDay(target.day, target.anchorId)}
          >
            {target.photoId && renderThumb && (
              <span className="stop-jump-photo">
                {renderThumb(target.photoId, () => markGone(target.photoId!))}
              </span>
            )}
            {/* No flag in front of the name any more: on a tile this size it
                was taking the room the name needed, and the name is the thing
                you are reading. */}
            <span className="stop-jump-label">
              <span className="stop-jump-name">{target.name}</span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * Puts a day, or one photo of it, at the top of whatever is doing the
 * scrolling.
 *
 * Where that lands is CSS's business (`scroll-margin-top` on the section): on a
 * phone the map is pinned over the top of the list, and a day scrolled to the
 * literal top of the page arrives behind it. A photo is measured against its
 * own day for that, since the margin belongs to the section.
 *
 * `photoId` is for the places that share a date: two day trips off the same
 * stop are three tiles landing on one day section, and the top of it is only
 * the right answer for the first of them.
 */
export function jumpToDay(day: string, photoId?: string | null) {
  const section = document.querySelector<HTMLElement>(`.timeline-day[data-day="${day}"]`);
  // Not on screen (a day filter is on, or the grid has not laid it out yet):
  // the day it belongs to is still the right neighbourhood.
  const photo = photoId
    ? document.querySelector<HTMLElement>(`[data-media-id="${photoId}"]`)
    : null;
  const el = photo ?? section;
  if (!el) return;
  // The grip is for aiming by hand; it has no part in a jump it did not make.
  window.dispatchEvent(new Event('mms:fastscroll-hide'));
  // Where the section wants to land, in the scroller's own coordinates.
  const measured = photo?.closest<HTMLElement>('.timeline-day') ?? section ?? el;
  const margin = Number.parseFloat(getComputedStyle(measured).scrollMarginTop) || 0;
  const box = el.getBoundingClientRect();
  const scroller = scrollParent(el);
  if (scroller) {
    const top = box.top - scroller.getBoundingClientRect().top + scroller.scrollTop - margin;
    scroller.scrollTo({ top, behavior: 'smooth' });
    return;
  }
  /*
   * The page itself is the scroller. Not scrollIntoView: on a share link the
   * body is the scrolling box (`overflow-x: hidden` computes its overflow-y to
   * `auto`), the document element is not, and the jump from the "new photos"
   * notice landed nowhere at all. Both are told where to go — only one of them
   * is really scrolling, and the other is already at zero.
   */
  const top = box.top + document.body.scrollTop + (document.scrollingElement?.scrollTop ?? 0) - margin;
  document.body.scrollTo({ top, behavior: 'smooth' });
  document.scrollingElement?.scrollTo({ top, behavior: 'smooth' });
}

/** The nearest ancestor that is actually scrolling, or nothing for the page. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    const overflow = getComputedStyle(node).overflowY;
    const scrolls = overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
    if (scrolls && node.scrollHeight > node.clientHeight + 4) return node;
  }
  return null;
}
