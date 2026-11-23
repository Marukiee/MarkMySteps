import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { MediaItem } from '../api/types';
import { haptic } from '../lib/haptics';
import { SmartImage } from './SmartImage';
import './viewerstrip.css';

/** One tile and the gap after it, as on the native apps (36 + 8). */
const TILE = 36;
const GAP = 8;
const SLOT = TILE + GAP;
/** The tile in the middle is this much bigger; its neighbours step aside as far. */
const GROW = 0.26;

/**
 * The photos as a strip of small tiles under the photo, as a phone's gallery
 * has it (PhotoViewer.kt, Filmstrip).
 *
 * The strip and the photo are one movement: swiping the photo slides the
 * strip along exactly (`position` carries the swipe's fraction), and sliding
 * the strip pages the viewer, with a tick for each photo it passes. Let go and
 * it glides to the nearest tile, which is the photo. Every tile keeps its
 * slot: the one in the middle only grows on screen while its neighbours step
 * aside, so the gaps stay equal and nothing shifts.
 */
export function ViewerStrip({
  items,
  position,
  following,
  onNavigate,
  srcFor,
  lift = 0,
  hidden = false,
}: {
  items: MediaItem[];
  /** Where the viewer is: the index plus how far a swipe has taken it. */
  position: number;
  /** True while a finger drags the photo: the strip follows without easing. */
  following: boolean;
  onNavigate: (index: number) => void;
  srcFor?: (item: MediaItem, size: 'thumbnail' | 'preview' | 'original') => string;
  /** How far to stand higher, for the reaction choices opening under it. */
  lift?: number;
  /** Out of sight (the comments are open), but kept, so it fades back. */
  hidden?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 390 : window.innerWidth));
  /** While the strip leads: where the finger has scrolled it to. */
  const [scrub, setScrub] = useState<number | null>(null);
  const drag = useRef<{ x: number; start: number; last: number; moved: boolean; id: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || window.innerWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const last = items.length - 1;
  const clamp = (p: number) => Math.max(0, Math.min(last, p));
  const focus = scrub ?? clamp(position);
  const easing = scrub === null && !following;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer knows: the drag simply ends early.
    }
    drag.current = { x: e.clientX, start: focus, last: Math.round(focus), moved: false, id: e.pointerId };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    const pos = clamp(d.start - dx / SLOT);
    setScrub(pos);
    const near = Math.round(pos);
    if (near !== d.last) {
      d.last = near;
      // A light tick per photo passed, and the viewer pages along.
      haptic('light');
      onNavigate(near);
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) {
      // A tap: that tile, under the finger.
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const offset = (e.clientX - (rect.left + rect.width / 2)) / SLOT;
      const target = clamp(Math.round(focus + offset));
      if (target !== Math.round(focus)) {
        haptic('light');
        onNavigate(target);
      }
      setScrub(null);
      return;
    }
    // Let go: it glides to the nearest tile (eased from where the finger
    // left it), and that is the photo. It always comes to rest on one.
    const target = Math.round(scrub ?? focus);
    if (target !== d.last) onNavigate(target);
    setScrub(null);
  };

  if (items.length < 2) return null;

  // Only what is on screen, and a few either side: a long trip has thousands.
  const reach = Math.ceil(width / SLOT / 2) + 2;
  const from = Math.max(0, Math.floor(focus) - reach);
  const to = Math.min(last, Math.ceil(focus) + reach);
  const a = Math.floor(focus);
  const b = a + 1;
  const growth = (j: number) => (TILE * GROW * Math.max(0, 1 - Math.abs(j - focus))) / 2;
  const tiles = [];
  for (let i = from; i <= to; i++) {
    const e = Math.max(0, 1 - Math.abs(i - focus));
    let shift = 0;
    for (const j of [a, b]) if (j !== i) shift += growth(j) * Math.sign(i - j);
    const item = items[i]!;
    const style = {
      left: `${i * SLOT}px`,
      transform: `translateX(${shift}px) scale(${1 + GROW * e})`,
    } as CSSProperties;
    tiles.push(
      <span className="vstrip-tile" key={item.id} style={style}>
        <SmartImage
          candidates={
            srcFor
              ? [srcFor(item, 'thumbnail')]
              : [`/media/${item.id}/thumbnail?size=thumbnail`, `/media/${item.id}/thumbnail`]
          }
          className="vstrip-img"
          direct={Boolean(srcFor)}
          eager
          draggable={false}
        />
      </span>,
    );
  }

  return (
    <div
      className={`vstrip ${easing ? 'easing' : ''} ${hidden ? 'hidden' : ''}`}
      ref={ref}
      style={{ transform: lift ? `translateY(${-lift}px)` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div
        className="vstrip-track"
        style={{ transform: `translateX(${width / 2 - TILE / 2 - focus * SLOT}px)` }}
      >
        {tiles}
      </div>
    </div>
  );
}
