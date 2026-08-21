import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
/** Anything wider or narrower than this is clamped, so one panorama in a day
 *  cannot flatten its whole row into a letterbox strip. */
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.6;
/** No shape recorded (an older sync, a photo still on the phone) → a square,
 *  which is what the grid used to be for everything. */
const FALLBACK_RATIO = 1;

const ratioOf = (item: PhotoGridItem): number => {
  const { width, height } = item;
  if (!width || !height || width <= 0 || height <= 0) return FALLBACK_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));
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
  const target = targetRowHeight ?? (width < 520 ? 132 : width < 900 ? 168 : 200);
  // And a ceiling on how many can share one row regardless. Justification alone
  // will happily put five or six narrow photos on a phone's width, and by then
  // each of them is a stamp.
  const perRow = width < 520 ? 4 : width < 900 ? 5 : 6;
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
        // A last row of one or two photos would be blown up to fill the width
        // on its own, dwarfing everything above it. Capped, it keeps its shape
        // and simply stops short of the right edge.
        const height = Math.round(Math.min(exact, target * 1.35));
        const stretched = height >= exact - 0.5;
        return (
          <div className="photo-grid-row" key={row[0]?.id ?? i} style={{ height }}>
            {row.map((item, j) => {
              const ratio = ratios[j]!;
              return (
                <div
                  className="photo-grid-cell"
                  key={item.id}
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
