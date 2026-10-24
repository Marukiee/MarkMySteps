import { useSyncExternalStore } from 'react';

/**
 * How big the photos in a trip's gallery are drawn.
 *
 * One level for every grid on the page (each day is its own grid, and a pinch
 * on Tuesday should not leave Monday behind) and remembered on the device, the
 * way the phone's own gallery keeps whatever you last pinched it to.
 *
 * 0 is the layout as it always was. Positive is fewer, bigger photos per row;
 * -1 is one step denser.
 */

const KEY = 'mms.gridZoom';
export const GRID_ZOOM_MIN = -1;
export const GRID_ZOOM_MAX = 3;

const clamp = (level: number): number =>
  Math.min(GRID_ZOOM_MAX, Math.max(GRID_ZOOM_MIN, Math.round(level)));

function read(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) ? clamp(v) : 0;
  } catch {
    return 0;
  }
}

let level = read();
const listeners = new Set<() => void>();

export function getGridZoom(): number {
  return level;
}

/** Returns whether the level actually moved — the caller ticks a haptic on it. */
export function setGridZoom(next: number): boolean {
  const clamped = clamp(next);
  if (clamped === level) return false;
  level = clamped;
  try {
    if (level === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(level));
  } catch {
    /* storage unavailable — the level just isn't remembered */
  }
  listeners.forEach((fn) => fn());
  return true;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useGridZoom(): number {
  return useSyncExternalStore(subscribe, getGridZoom, getGridZoom);
}

/** How much taller a row wants to be at each level. */
const ROW_SCALE: Record<number, number> = { [-1]: 0.75, 0: 1, 1: 1.5, 2: 2.2, 3: 3.2 };

/**
 * The row target and per-row cap for a level, from the ones the grid would
 * use at its default. Both move: the height alone would let justification keep
 * four narrow portraits on a row, and the cap alone would only ever stretch
 * the same rows wider.
 */
export function zoomedLayout(
  level: number,
  target: number,
  perRow: number,
): { target: number; perRow: number } {
  return {
    target: target * (ROW_SCALE[level] ?? 1),
    perRow: Math.max(1, perRow - level),
  };
}

/**
 * From this level on a photo is wide enough on a phone that the small grid
 * rendition (about 250px) shows as a blur, so the grid asks for the preview.
 */
export const GRID_ZOOM_PREVIEW = 2;
