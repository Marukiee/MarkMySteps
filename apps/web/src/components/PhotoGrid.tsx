import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { haptic } from '../lib/haptics';
import { setGridZoom, getGridZoom, useGridZoom, zoomedLayout } from '../lib/gridZoom';
import './photogrid.css';

/** The minimum a caller has to know about a photo to lay it out. */
export interface PhotoGridItem {
  id: string;
  width?: number | null;
  height?: number | null;
}

interface PhotoGridProps<T extends PhotoGridItem> {
  items: T[];
  /** Renders one photo. The element is stretched to the cell by the CSS. */
  children: (item: T) => ReactNode;
  /** How tall a row wants to be before justification stretches or squeezes it. */
  targetRowHeight?: number;
  className?: string;
}

const GAP = 6;
/** Anything wider or narrower than this is clamped, so one wide shot in a day
 *  cannot flatten its whole row into a letterbox strip. */
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.6;
/** No shape recorded (an older sync, a photo still on the phone) → a square,
 *  which is what the grid used to be for everything. */
const FALLBACK_RATIO = 1;
/** Wider than this and clamping is no longer a nudge: it is throwing half the
 *  picture away. Those get a row to themselves instead — see `isPanorama`. */
const PANO_RATIO = MAX_RATIO;
/** How short a panorama's own row is allowed to get. A 7:1 sweep across a
 *  phone works out to about fifty pixels, which is a line, not a photograph.
 *  Past this the row keeps its height and the photo is letterboxed inside it —
 *  never cropped. */
const PANO_MIN_HEIGHT = 96;

/** The photo's own shape, as it was taken. */
const rawRatioOf = (item: PhotoGridItem): number => {
  const { width, height } = item;
  if (!width || !height || width <= 0 || height <= 0) return FALLBACK_RATIO;
  return width / height;
};

/**
 * A photo too wide to share a row with anything.
 *
 * Exported because the caller wants to know as well: a panorama runs the full
 * width of the screen here, and the small grid rendition it would otherwise be
 * given is a couple of hundred pixels stretched across all of it.
 */
export function isPanorama(item: PhotoGridItem): boolean {
  return rawRatioOf(item) > PANO_RATIO;
}

const ratioOf = (item: PhotoGridItem): number => {
  // A panorama is laid out at its true shape. It is alone on its row, so there
  // is nothing for it to squash, and clamping it is what cropped it.
  if (isPanorama(item)) return rawRatioOf(item);
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, rawRatioOf(item)));
};

/**
 * The shapes a row is laid out with: each photo's own, untouched.
 *
 * Reining the widest one in to bring a mixed row closer to equal was tried and
 * taken back out. It works out to a fifth off the sides of a landscape shot
 * standing between two portraits, which is not a nudge, it is a recrop of
 * somebody's photograph.
 */
function rowRatios(row: PhotoGridItem[]): number[] {
  return row.map(ratioOf);
}

/**
 * Justified rows, the way Immich and Google Photos lay a day out: photos keep
 * their own shape, and each row is scaled until it exactly fills the width.
 *
 * The old grid cropped everything to a square, which threw away most of a
 * portrait and turned a panorama into a rock. Rows are computed from the
 * recorded pixel sizes, so the page reserves the right space before a single
 * image has arrived — no reflow as they load in.
 */
export function PhotoGrid<T extends PhotoGridItem>({
  items,
  children,
  targetRowHeight,
  className,
}: PhotoGridProps<T>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const zoom = useGridZoom();

  usePinchZoom(hostRef);

  // Measure before paint, and follow the container: a phone rotating, the map
  // panel opening next to it, or the browser window being dragged narrower all
  // change how many photos fit on a row.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setWidth(host.clientWidth);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      // One layout per frame: a drag-resize fires this dozens of times a second
      // and every one of them would re-run the row solver.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth((w) => (Math.abs(w - next) < 1 ? w : next)));
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // A sensible row height for the width we got: tall rows on a desktop, shorter
  // ones on a phone, where a row of three 250px photos would be a wall.
  const baseTarget = targetRowHeight ?? (width < 520 ? 132 : width < 900 ? 168 : 200);
  // And a ceiling on how many can share one row regardless. Justification alone
  // will happily put five or six narrow photos on a phone's width, and by then
  // each of them is a stamp.
  const basePerRow = width < 520 ? 4 : width < 900 ? 5 : 6;
  // Both shifted by however far the gallery has been pinched.
  const { target, perRow } = zoomedLayout(zoom, baseTarget, basePerRow);
  const rows = width > 0 ? packRows(items, width, target, perRow) : [];

  return (
    <div ref={hostRef} className={`photo-grid ${className ?? ''}`}>
      {rows.map((row, i) => {
        const ratios = rowRatios(row);
        const exact = heightFor(
          ratios.reduce((sum, r) => sum + r, 0),
          row.length,
          width,
        );
        const pano = row.length === 1 && isPanorama(row[0]!);
        // A last row of one or two photos would be blown up to fill the width
        // on its own, dwarfing everything above it. Capped, it keeps its shape
        // and simply stops short of the right edge.
        //
        // A panorama is the exception: its own row exists so it can have the
        // full width at its own shape, so only the floor applies to it, and at
        // the floor it is letterboxed rather than cut down.
        const height = pano
          ? Math.round(Math.max(exact, PANO_MIN_HEIGHT))
          : Math.round(Math.min(exact, target * 1.35));
        const stretched = pano || height >= exact - 0.5;
        return (
          <div
            className={`photo-grid-row ${pano ? 'pano' : ''}`}
            key={row[0]?.id ?? i}
            style={{ height }}
          >
            {row.map((item, j) => {
              const ratio = ratios[j]!;
              return (
                <div
                  className="photo-grid-cell"
                  key={item.id}
                  data-grid-id={item.id}
                  // A justified row divides its free space by shape, which lands
                  // every photo on its exact width with no rounding left over.
                  // A capped row is laid out at its own size instead.
                  style={
                    stretched
                      ? { flexGrow: ratio, flexBasis: 0 }
                      : { flexGrow: 0, flexBasis: `${Math.round(ratio * height)}px` }
                  }
                >
                  {children(item)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Greedy row packing: keep adding photos while the row, scaled to fill the
 * width, would still be taller than the target. The first photo that would
 * push it below starts the next row — unless keeping it lands closer to the
 * target than dropping it, which is what stops the last-but-one row from
 * ending up noticeably squatter than its neighbours. `maxPerRow` overrules
 * that judgement: past it the row is simply full.
 */
function packRows<T extends PhotoGridItem>(
  items: T[],
  width: number,
  target: number,
  maxPerRow: number,
): T[][] {
  const rows: T[][] = [];
  let row: T[] = [];
  let ratioSum = 0;

  for (const item of items) {
    const ratio = ratioOf(item);
    // A panorama takes a row of its own: whatever was being filled is closed
    // off before it, and the next photo starts a fresh one after it.
    if (isPanorama(item)) {
      if (row.length > 0) rows.push(row);
      rows.push([item]);
      row = [];
      ratioSum = 0;
      continue;
    }
    if (row.length >= maxPerRow) {
      rows.push(row);
      row = [];
      ratioSum = 0;
    }
    const withIt = heightFor(ratioSum + ratio, row.length + 1, width);
    if (row.length > 0 && withIt < target) {
      const without = heightFor(ratioSum, row.length, width);
      // Whichever row height sits closer to what we asked for.
      if (Math.abs(without - target) <= Math.abs(withIt - target)) {
        rows.push(row);
        row = [];
        ratioSum = 0;
      }
    }
    row.push(item);
    ratioSum += ratio;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** The height a row of these shapes takes when stretched across the width. */
function heightFor(ratioSum: number, count: number, width: number): number {
  if (ratioSum <= 0) return 0;
  return (width - GAP * Math.max(0, count - 1)) / ratioSum;
}

/** How far the fingers have to spread (or close) for one step. */
const PINCH_STEP = 1.3;

/**
 * Two fingers on the photos zoom the gallery, not the page.
 *
 * Spreading steps to fewer, bigger photos per row; pinching steps back. The
 * browser's own page zoom is kept out of it (touch-action in the CSS, and the
 * moves cancelled here for the browsers that ignore that), so the header and
 * map do not balloon along with the photos.
 *
 * The photo between the fingers stays where it was on screen: every row above
 * it changes height on a step, and without the correction the page would jump
 * to somewhere else in the trip.
 */
function usePinchZoom(hostRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let startDistance = 0;

    const distance = (t: TouchList) =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) startDistance = distance(e.touches);
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDistance === 0) return;
      e.preventDefault();
      const scale = distance(e.touches) / startDistance;
      if (scale < PINCH_STEP && scale > 1 / PINCH_STEP) return;

      const midX = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2;
      const midY = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2;
      // The photo between the fingers — or, when they land on a gap or on the
      // sticky day header over the grid, the first one below that point.
      const anchor =
        document.elementFromPoint(midX, midY)?.closest<HTMLElement>('.photo-grid-cell') ??
        [...host.querySelectorAll<HTMLElement>('.photo-grid-cell')].find(
          (cell) => cell.getBoundingClientRect().bottom > midY,
        );
      const anchorId = anchor?.dataset.gridId;
      const before = anchor?.getBoundingClientRect().top;

      // Measured from here on, so a long spread keeps stepping.
      startDistance = distance(e.touches);
      // Where every photo on screen is now, so it can travel to where it lands.
      const before_ = visibleCellRects();
      // Rendered on the spot, so the rows are already at their new size when
      // the anchor is measured again below, with no frame where the page has jumped.
      let moved = false;
      flushSync(() => {
        moved = setGridZoom(getGridZoom() + (scale > 1 ? 1 : -1));
      });
      if (!moved) return;
      haptic('light');

      // Looked up again by id: a row whose first photo changed is a new row to
      // React, and the cell that was under the fingers went with it.
      const landed = anchorId
        ? document.querySelector<HTMLElement>(`.photo-grid-cell[data-grid-id="${CSS.escape(anchorId)}"]`)
        : null;
      if (landed && before !== undefined) {
        const shift = landed.getBoundingClientRect().top - before;
        scrollParent(landed).scrollBy({ top: shift, behavior: 'instant' as ScrollBehavior });
      }
      glideFrom(before_);
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDistance = 0;
    };

    // iOS Safari zooms the page off its own gesture events, touch-action or not.
    const onGesture = (e: Event) => e.preventDefault();

    host.addEventListener('touchstart', onStart, { passive: true });
    host.addEventListener('touchmove', onMove, { passive: false });
    host.addEventListener('touchend', onEnd, { passive: true });
    host.addEventListener('touchcancel', onEnd, { passive: true });
    host.addEventListener('gesturestart', onGesture);
    host.addEventListener('gesturechange', onGesture);
    return () => {
      host.removeEventListener('touchstart', onStart);
      host.removeEventListener('touchmove', onMove);
      host.removeEventListener('touchend', onEnd);
      host.removeEventListener('touchcancel', onEnd);
      host.removeEventListener('gesturestart', onGesture);
      host.removeEventListener('gesturechange', onGesture);
    };
  }, [hostRef]);
}

/** How long a photo takes to slide into its new place after a pinch step. */
const GLIDE_MS = 280;

/**
 * Every photo cell on screen (and a screen's height around it), by photo id.
 * All grids, not one: the zoom is shared, so the day above and below the
 * fingers re-flow on the same step.
 */
function visibleCellRects(): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  const margin = window.innerHeight;
  for (const cell of document.querySelectorAll<HTMLElement>('.photo-grid-cell')) {
    const rect = cell.getBoundingClientRect();
    if (rect.bottom < -margin || rect.top > window.innerHeight + margin) continue;
    if (cell.dataset.gridId) rects.set(cell.dataset.gridId, rect);
  }
  return rects;
}

/**
 * The step, animated: each photo starts where it was and glides to where the
 * new rows put it (the FLIP technique), instead of the whole grid jumping. A
 * photo that was not on screen before fades in. The new layout is already in
 * place underneath, so a second step mid-glide simply starts from wherever
 * the photos are.
 */
function glideFrom(before: Map<string, DOMRect>): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
  for (const cell of document.querySelectorAll<HTMLElement>('.photo-grid-cell')) {
    const now = cell.getBoundingClientRect();
    if (now.bottom < 0 || now.top > window.innerHeight) continue;
    const was = cell.dataset.gridId ? before.get(cell.dataset.gridId) : undefined;
    if (!was || now.width === 0 || now.height === 0) {
      cell.animate([{ opacity: 0 }, { opacity: 1 }], { duration: GLIDE_MS, easing });
      continue;
    }
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    const sx = was.width / now.width;
    const sy = was.height / now.height;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    cell.animate(
      [
        { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: GLIDE_MS, easing },
    );
  }
}

/** The element that actually scrolls this one: a timeline panel, or the page. */
function scrollParent(el: HTMLElement): Element {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}
