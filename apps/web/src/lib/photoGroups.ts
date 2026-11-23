import maplibregl, { Map as MapLibreMap } from './mapgl';
import { fetchBlobUrl } from '../api/client';
import type { MediaItem } from '../api/types';
import { colorForUser } from './colors';

/**
 * Your photos on the map, as the native apps draw them (TripMap.kt,
 * PhotoLevels and PhotoMarkers).
 *
 * Groups are worked out per half zoom step, from close up downwards, each step
 * from the one above it: zooming out only ever joins groups and zooming in
 * only splits them, and the photo in front of a group stays in front of the
 * bigger group it joins. Passing a step, the photos of a group that splits
 * glide out of it to their own spots, and a group that joins another glides
 * into it and fades there (320 ms, emphasized). A small pan never regroups:
 * the step only changes with the zoom.
 */

type Located = MediaItem & { latitude: number; longitude: number };

export interface PhotoGroup {
  front: Located;
  members: Located[];
}

/** Where a spot lies at a zoom, in map points (Web Mercator, 512 wide at zoom 0, as MapLibre). */
function mapPoint(lat: number, lon: number, zoom: number): [number, number] {
  const size = 512 * 2 ** zoom;
  const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [((lon + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

/**
 * Joins groups whose front photos lie closer than `reach` points at `zoom`, in
 * their order (the first one keeps its front). A grid of cells as wide as
 * `reach` keeps it quick for hundreds of photos.
 */
function joinGroups(groups: PhotoGroup[], zoom: number, reach: number): PhotoGroup[] {
  const fronts: Located[] = [];
  const members: Located[][] = [];
  const spots: [number, number][] = [];
  const cells = new Map<string, number[]>();
  for (const g of groups) {
    const at = mapPoint(g.front.latitude, g.front.longitude, zoom);
    const cx = Math.floor(at[0] / reach);
    const cy = Math.floor(at[1] / reach);
    let near = -1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if ((near < 0 || i < near) && Math.hypot(spots[i]![0] - at[0], spots[i]![1] - at[1]) < reach) near = i;
        }
      }
    }
    if (near >= 0) members[near]!.push(...g.members);
    else {
      fronts.push(g.front);
      members.push([...g.members]);
      spots.push(at);
      const key = `${cx}:${cy}`;
      cells.set(key, [...(cells.get(key) ?? []), fronts.length - 1]);
    }
  }
  return fronts.map((front, i) => ({ front, members: members[i]! }));
}

const TOP = 17;

/** The groups at every half zoom step, each worked out once and then kept. */
export class PhotoLevels {
  private byStep = new Map<number, PhotoGroup[]>();
  private lowest = TOP;

  constructor(photos: MediaItem[]) {
    const located = photos.filter(
      (m): m is Located => m.latitude !== null && m.longitude !== null && m.assetType !== 'VIDEO',
    );
    this.byStep.set(TOP, joinGroups(located.map((p) => ({ front: p, members: [p] })), TOP, 2));
  }

  static step(zoom: number): number {
    return Math.max(0, Math.min(TOP, Math.floor(zoom * 2) / 2));
  }

  at(zoom: number): PhotoGroup[] {
    const step = PhotoLevels.step(zoom);
    // A marker and the count on its corner: groups closer than that join.
    while (this.lowest > step) {
      const next = this.lowest - 0.5;
      this.byStep.set(next, joinGroups(this.byStep.get(this.lowest)!, next, 50));
      this.lowest = next;
    }
    return this.byStep.get(step)!;
  }
}

/* ---- Drawing ---- */

const GLIDE_MS = 320;

/** cubic-bezier(0.2, 0, 0, 1), the emphasized easing. */
function emphasized(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const x1 = 0.2;
  const y1 = 0;
  const x2 = 0;
  const y2 = 1;
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t ** 2 * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t ** 2 * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 24; i++) {
    t = (lo + hi) / 2;
    if (bx(t) < x) lo = t;
    else hi = t;
  }
  return by(t);
}

type LngLat = [number, number];

interface Shown {
  group: PhotoGroup;
  marker: maplibregl.Marker;
  face: HTMLDivElement;
  count: maplibregl.Marker | null;
  countEl: HTMLSpanElement | null;
  from: LngLat;
  to: LngLat;
  leaving: boolean;
  /** 'glide' moves between spots; 'appear' comes up where it stands. */
  mode: 'glide' | 'appear' | 'still';
  start: number;
}

const spot = (m: Located): LngLat => [m.longitude, m.latitude];
const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

export interface PhotoLayerHandlers {
  /** A tap on a group (or a single photo): its photos, the one in front first. */
  onOpen: (group: PhotoGroup) => void;
}

/**
 * The photo markers on one map. `setPhotos` hands it a new set (a day picked,
 * someone's photos switched on), `regroup` runs when the zoom has settled.
 */
export class PhotoLayer {
  private shown = new Map<string, Shown>();
  private levels: PhotoLevels | null = null;
  private groups: PhotoGroup[] | null = null;
  private frame = 0;
  private thumbs = new Map<string, string>();
  /** When the photos were last handed over. */
  private setAt = 0;

  constructor(
    private map: MapLibreMap,
    private handlers: PhotoLayerHandlers,
  ) {}

  setPhotos(photos: MediaItem[], hidden: boolean): void {
    this.levels = hidden ? null : new PhotoLevels(photos);
    this.setAt = performance.now();
    // A new set of photos is not a regrouping: what is gone fades where it
    // stood, what is new comes up where it stands.
    this.apply(this.levels?.at(this.map.getZoom()) ?? [], 'set');
  }

  regroup(): void {
    if (!this.levels) return;
    const next = this.levels.at(this.map.getZoom());
    if (next === this.groups) return;
    // The camera framing the trip right after the photos arrived is not you
    // zooming: they simply come up where they belong, rather than all
    // gliding out of one spot at once.
    this.apply(next, performance.now() - this.setAt < 900 ? 'set' : 'zoom');
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    for (const s of this.shown.values()) this.removeShown(s);
    this.shown.clear();
  }

  private apply(groups: PhotoGroup[], why: 'set' | 'zoom'): void {
    const before = this.groups;
    this.groups = groups;
    const now = performance.now();
    const byFront = new Map(groups.map((g) => [g.front.id, g]));
    const holder = (list: PhotoGroup[] | null, id: string) =>
      list?.find((g) => g.members.some((m) => m.id === id)) ?? null;

    for (const g of groups) {
      const old = this.shown.get(g.front.id);
      if (old && !old.leaving) {
        if (old.group !== g) {
          old.group = g;
          this.updateCount(old);
        }
        continue;
      }
      if (old) this.removeShown(old);
      // New on the map: out of the group it was part of a moment ago, or
      // simply there at the first draw.
      const parent = why === 'zoom' ? holder(before, g.front.id) : null;
      const from = parent ? spot(parent.front) : spot(g.front);
      const mode: Shown['mode'] =
        why === 'set' ? 'appear' : same(from, spot(g.front)) ? 'still' : 'glide';
      this.shown.set(g.front.id, this.create(g, from, spot(g.front), mode, now));
    }

    for (const [key, s] of this.shown) {
      if (byFront.has(key) || s.leaving) continue;
      // Joined another group: into that group's spot, fading there, then gone.
      // Taken away instead (a day picked): fades where it stands.
      const into = why === 'zoom' ? holder(groups, key) : null;
      s.from = s.to;
      s.to = into ? spot(into.front) : s.to;
      s.leaving = true;
      s.mode = 'glide';
      s.start = now;
      s.marker.getElement().classList.add('leaving');
      if (s.count) {
        s.count.remove();
        s.count = null;
      }
    }
    this.tick();
  }

  private create(g: PhotoGroup, from: LngLat, to: LngLat, mode: Shown['mode'], start: number): Shown {
    const root = document.createElement('div');
    root.className = 'pm-root';
    const face = document.createElement('div');
    face.className = 'pm-face';
    face.style.borderColor = colorForUser(g.front.userId);
    root.appendChild(face);
    const thumb = this.thumbs.get(g.front.id);
    if (thumb) face.style.backgroundImage = `url("${thumb}")`;
    else {
      const id = g.front.id;
      void fetchBlobUrl(`/media/${id}/thumbnail?size=thumbnail`)
        .then((url) => {
          this.thumbs.set(id, url);
          face.style.backgroundImage = `url("${url}")`;
        })
        .catch(() => face.classList.add('pm-missing'));
    }
    const marker = new maplibregl.Marker({ element: root }).setLngLat(from).addTo(this.map);
    const shown: Shown = { group: g, marker, face, count: null, countEl: null, from, to, leaving: false, mode, start };
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      if (shown.leaving) return;
      this.handlers.onOpen(shown.group);
    });
    this.updateCount(shown);
    this.paint(shown, mode === 'still' ? 1 : 0);
    return shown;
  }

  /** The count on a group's corner, a marker of its own so it lies over every photo. */
  private updateCount(s: Shown): void {
    const n = s.group.members.length;
    if (n <= 1 || s.leaving) {
      s.count?.remove();
      s.count = null;
      s.countEl = null;
      return;
    }
    if (!s.countEl) {
      const el = document.createElement('span');
      el.className = 'pm-count';
      el.style.background = colorForUser(s.group.front.userId);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onOpen(s.group);
      });
      s.countEl = el;
      // Its corner: right of the centre and above the top edge, as native.
      s.count = new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [10, -9] })
        .setLngLat(s.marker.getLngLat())
        .addTo(this.map);
    }
    s.countEl.textContent = n > 99 ? '99+' : String(n);
  }

  private paint(s: Shown, k: number): void {
    // Leaving runs from 1 to 0: it moves towards the group it joins as it fades.
    const t = s.leaving ? 1 - k : k;
    const at: LngLat =
      s.mode === 'glide'
        ? [s.from[0] + (s.to[0] - s.from[0]) * t, s.from[1] + (s.to[1] - s.from[1]) * t]
        : s.to;
    if (s.mode === 'glide' || s.leaving) s.marker.setLngLat(at);
    s.count?.setLngLat(at);
    const alpha = s.leaving ? k : s.mode === 'appear' ? k : 0.4 + 0.6 * k;
    const scale = s.leaving ? 0.8 + 0.2 * k : 0.85 + 0.15 * k;
    s.face.style.opacity = String(alpha);
    s.face.style.transform = scale === 1 ? '' : `scale(${scale})`;
    if (s.countEl) s.countEl.style.opacity = String(s.leaving ? 0 : k);
  }

  private tick = () => {
    cancelAnimationFrame(this.frame);
    const now = performance.now();
    let running = false;
    for (const [key, s] of this.shown) {
      if (s.mode === 'still' && !s.leaving) continue;
      const p = Math.min(1, (now - s.start) / GLIDE_MS);
      const k = emphasized(p);
      this.paint(s, s.leaving ? 1 - k : k);
      if (p < 1) running = true;
      else if (s.leaving) {
        this.removeShown(s);
        this.shown.delete(key);
      } else {
        s.mode = 'still';
        s.from = s.to;
      }
    }
    if (running) this.frame = requestAnimationFrame(this.tick);
  };

  private removeShown(s: Shown): void {
    s.marker.remove();
    s.count?.remove();
  }
}
