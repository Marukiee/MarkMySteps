import {
  Box,
  FONT_BODY,
  FONT_DISPLAY,
  Palette,
  chip,
  drawBrand,
  drawCover,
  drawLayout,
  drawMap,
  drawRoute,
  drawStopDot,
  layoutText,
  loadPhoto,
  panel,
  roundRect,
  scrim,
  setFont,
} from './canvas';
import type { PageData } from './types';

/**
 * The four layouts.
 *
 * They share a grid and a voice: the mark at the top left, the period at the
 * top right, the trip's name as the headline, the numbers straight underneath
 * it, and whatever the page is actually about filling everything below. What
 * differs is who gets that space — the map, the photos, or the figures
 * themselves.
 *
 * Nothing here is measured in fixed pixels down the page. A square poster has
 * barely half the height of a story at the same width, and a layout built out
 * of constants turns its map into a letterbox slot; every vertical measure is
 * a share of what there is.
 */

export interface TemplateOpts {
  showLogo: boolean;
  palette: Palette;
}

export type TemplateRenderer = (
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  page: PageData,
  opts: TemplateOpts,
) => Promise<void>;

interface Metrics {
  m: number;
  /** Vertical rhythm, relative to a story. Gaps close up on a short poster. */
  v: number;
  title: number;
  fact: number;
  label: number;
}

function metrics(size: { w: number; h: number }): Metrics {
  return {
    m: Math.round((68 * size.w) / 1080),
    v: Math.min(1, size.h / 1920),
    // Bounded by the height as well as the width, or a square poster is all
    // headline and no picture.
    title: Math.round(Math.min(size.w * 0.082, size.h * 0.058)),
    fact: Math.round(54 * Math.min(1, size.h / 1500)),
    label: Math.round(24 * Math.min(1, size.h / 1500)),
  };
}

/** The mark and the period, on one line. Returns the y under it. */
function brandLine(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  page: PageData,
  opts: TemplateOpts,
  mt: Metrics,
  ink: string,
): number {
  if (opts.showLogo) drawBrand(ctx, mt.m, mt.m, page.accent, ink);
  setFont(ctx, 26, 600, FONT_BODY);
  ctx.fillStyle = ink;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(page.dateLabel.toUpperCase(), size.w - mt.m, mt.m + 22);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  return mt.m + (opts.showLogo ? 62 : 50);
}

/**
 * Name, where it was, and the numbers — the whole top block.
 *
 * The figures used to sit along the bottom edge, under the pictures. They are
 * the first thing you say about a trip, so they now read directly under its
 * name.
 */
function head(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  page: PageData,
  opts: TemplateOpts,
  mt: Metrics,
): number {
  const p = opts.palette;
  let y = brandLine(ctx, size, page, opts, mt, p.inkSoft);
  y += 18 * mt.v;

  const title = layoutText(ctx, page.title, size.w - mt.m * 2, {
    size: mt.title,
    minSize: Math.round(mt.title * 0.5),
    weight: 800,
    family: FONT_DISPLAY,
    lines: 2,
    color: p.ink,
  });
  y = drawLayout(ctx, title, mt.m, y);

  const bits: string[] = [];
  if (page.place) bits.push(page.place);
  if (page.weather) bits.push(`${page.weather.emoji} ${page.weather.temperature}°`);
  if (bits.length > 0) {
    y += 14 * mt.v;
    const sub = layoutText(ctx, bits.join('   ·   '), size.w - mt.m * 2, {
      size: 30,
      minSize: 22,
      weight: 600,
      family: FONT_BODY,
      lines: 2,
      color: p.inkSoft,
    });
    y = drawLayout(ctx, sub, mt.m, y);
  }

  if (page.facts.length > 0) {
    y += 26 * mt.v;
    const cell = (size.w - mt.m * 2) / page.facts.length;
    page.facts.forEach((fact, i) => {
      const x = mt.m + cell * i;
      setFont(ctx, mt.fact, 800, FONT_DISPLAY);
      ctx.fillStyle = p.ink;
      ctx.fillText(fact.value, x, y);
      setFont(ctx, mt.label, 600, FONT_BODY);
      ctx.fillStyle = p.inkFaint;
      ctx.fillText(fact.label.toUpperCase(), x, y + mt.fact * 1.16);
    });
    y += mt.fact * 1.16 + mt.label * 1.3;
  }
  return y + 26 * mt.v;
}

function pageBadge(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  page: PageData,
  mt: Metrics,
  ink: string,
): void {
  if (!page.pageLabel) return;
  setFont(ctx, 24, 700, FONT_BODY);
  ctx.fillStyle = ink;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(page.pageLabel.toUpperCase(), size.w - mt.m, size.h - mt.m + 8);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

/** A row of photos, cropped, evenly spread, with the place under each. */
async function photoRow(
  ctx: CanvasRenderingContext2D,
  ids: string[],
  box: Box,
  gap: number,
  palette: Palette,
  labels?: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const cell = (box.w - gap * (ids.length - 1)) / ids.length;
  for (let i = 0; i < ids.length; i++) {
    const slot: Box = { x: box.x + (cell + gap) * i, y: box.y, w: cell, h: box.h };
    panel(ctx, slot, 24, palette.panel);
    const img = await loadPhoto(ids[i]!);
    if (img) drawCover(ctx, img, slot, 24);
    const label = labels?.[i];
    if (label) {
      // A name is as wide as the photo above it and no wider.
      const fitted = layoutText(ctx, label, cell, {
        size: 24,
        minSize: 15,
        weight: 700,
        family: FONT_BODY,
        lines: 1,
        color: palette.inkSoft,
      });
      drawLayout(ctx, fitted, slot.x, slot.y + slot.h + 12);
    }
  }
}

/** How the space under the head is split between a map and a row of photos. */
function bodySplit(
  size: { w: number; h: number },
  mt: Metrics,
  top: number,
  photos: number,
  labelled: boolean,
): { map: Box; photos: Box | null } {
  const height = size.h - mt.m - top;
  const labelH = labelled ? 40 : 0;
  let gap = photos > 0 ? 32 * mt.v : 0;
  let photoH = photos > 0 ? Math.min(size.w * 0.22, height * 0.3) : 0;
  // A map squeezed under two fifths of the body is a letterbox slot, not a
  // map. Below that the photos give their space back.
  if (photoH > 0 && height - photoH - labelH - gap < height * 0.45) {
    photoH = Math.max(0, height * 0.55 - labelH - gap);
  }
  if (photoH < 90) {
    photoH = 0;
    gap = 0;
  }
  const mapH = height - (photoH > 0 ? photoH + labelH + gap : 0);
  return {
    map: { x: mt.m, y: top, w: size.w - mt.m * 2, h: mapH },
    photos: photoH > 0 ? { x: mt.m, y: top + mapH + gap, w: size.w - mt.m * 2, h: photoH } : null,
  };
}

/**
 * Routekaart: the map is the picture.
 *
 * The route of the period, the places on it, and a few photos underneath. For
 * a hike, a long day of driving, anything where the line itself is what
 * happened.
 */
const renderRoute: TemplateRenderer = async (ctx, size, page, opts) => {
  const p = opts.palette;
  const mt = metrics(size);
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, size.w, size.h);
  const top = head(ctx, size, page, opts, mt);
  const split = bodySplit(size, mt, top, Math.min(page.photos.length, 3), false);

  const focus: [number, number][] = page.lines.flat();
  for (const stop of page.stops) focus.push([stop.lng, stop.lat]);
  const map = drawMap(ctx, split.map, focus, { accent: page.accent, palette: p });
  drawRoute(ctx, map, page.lines, split.map, { color: page.accent, width: 10 });

  ctx.save();
  roundRect(ctx, split.map, 40);
  ctx.clip();
  for (const stop of page.stops) {
    const xy = map.project([stop.lng, stop.lat]);
    if (xy) drawStopDot(ctx, xy[0], xy[1], page.accent, p.paper);
  }
  // Where the day began and where it ended, which is the story of a route.
  const line = page.lines[0];
  const last = page.lines[page.lines.length - 1];
  if (line && last && line.length > 1) {
    const start = map.project(line[0]!);
    const end = map.project(last[last.length - 1]!);
    if (start) drawStopDot(ctx, start[0], start[1], p.ink, p.paper, true);
    if (end) drawStopDot(ctx, end[0], end[1], page.accent, p.paper, true);
  }
  ctx.restore();

  // The places, written down the top-left corner of the map. Dots alone say
  // where, not what: the name beside them is what turns a line into a route
  // you can read, and a label per dot would collide the moment two of them
  // are a day trip apart.
  if (page.stops.length > 0) {
    const lineH = 36;
    const room = Math.max(1, Math.floor((split.map.h - 44) / lineH));
    const names = page.stops.map((s) => s.name);
    const shown = names.length > room ? names.slice(0, room - 1) : names.slice();
    if (names.length > room) shown.push(`+${names.length - shown.length} meer`);
    ctx.save();
    roundRect(ctx, split.map, 40);
    ctx.clip();
    // A soft shadow, so a name stays readable wherever the route runs under it.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    shown.forEach((name, i) => {
      const fitted = layoutText(ctx, name, split.map.w * 0.6, {
        size: 27,
        minSize: 18,
        weight: 700,
        family: FONT_BODY,
        lines: 1,
        color: names.length > room && i === shown.length - 1 ? p.inkFaint : p.ink,
      });
      drawLayout(ctx, fitted, split.map.x + 26, split.map.y + 24 + i * lineH);
    });
    ctx.restore();
  }

  if (split.photos) await photoRow(ctx, page.photos.slice(0, 3), split.photos, 20, p);
  pageBadge(ctx, size, page, mt, p.inkFaint);
};

/**
 * Fotodag: no map at all.
 *
 * A day in a city is not a shape on a map, it is what you saw. So the photos
 * fill the frame and only the place, the date and the weather sit on top of
 * them.
 */
const renderPhotos: TemplateRenderer = async (ctx, size, page, opts) => {
  const p = opts.palette;
  const mt = metrics(size);
  const m = mt.m;
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, size.w, size.h);
  const ids = page.photos.slice(0, 6);
  const gap = 12;
  const grid: Box = { x: 0, y: 0, w: size.w, h: size.h };

  // The mosaic shape follows how many photos there are, so two photos are two
  // halves rather than two thirds of an empty grid.
  const slots: Box[] = [];
  const cols = (n: number, box: Box, rows: number) => ({
    cw: (box.w - gap * (n - 1)) / n,
    ch: (box.h - gap * (rows - 1)) / rows,
  });
  if (ids.length <= 1) {
    slots.push(grid);
  } else if (ids.length === 2) {
    const { ch } = cols(1, grid, 2);
    slots.push({ ...grid, h: ch }, { ...grid, y: ch + gap, h: ch });
  } else if (ids.length === 3) {
    const big = { ...grid, h: grid.h * 0.62 };
    const restY = big.h + gap;
    const restH = grid.h - restY;
    const { cw } = cols(2, grid, 1);
    slots.push(big, { x: 0, y: restY, w: cw, h: restH }, { x: cw + gap, y: restY, w: cw, h: restH });
  } else if (ids.length === 4) {
    const { cw, ch } = cols(2, grid, 2);
    slots.push(
      { x: 0, y: 0, w: cw, h: ch },
      { x: cw + gap, y: 0, w: cw, h: ch },
      { x: 0, y: ch + gap, w: cw, h: ch },
      { x: cw + gap, y: ch + gap, w: cw, h: ch },
    );
  } else {
    // Only a story is tall enough for three rows of pairs — on anything
    // shorter the bottom row ends up behind the wash the place name sits on.
    const rows = size.h / size.w >= 1.5 ? 3 : 2;
    const { cw, ch } = cols(2, grid, rows);
    for (let i = 0; i < rows * 2; i++) {
      slots.push({ x: (i % 2) * (cw + gap), y: Math.floor(i / 2) * (ch + gap), w: cw, h: ch });
    }
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    panel(ctx, slot, 0, p.panel);
    const id = ids[i];
    if (!id) continue;
    const img = await loadPhoto(id);
    if (img) drawCover(ctx, img, slot, 0);
  }

  // Text over photographs is white on a wash whichever mood the poster is in:
  // the picture underneath decides what is legible, not the theme.
  const ink = 'rgba(255, 255, 255, 0.8)';
  scrim(ctx, { x: 0, y: 0, w: size.w, h: 260 }, 'rgba(10, 13, 17, 0.72)', 'rgba(10, 13, 17, 0)');
  scrim(ctx, { x: 0, y: size.h - size.h * 0.44, w: size.w, h: size.h * 0.44 });

  if (opts.showLogo) drawBrand(ctx, m, m, page.accent, ink);
  setFont(ctx, 26, 600, FONT_BODY);
  ctx.fillStyle = ink;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(page.dateLabel.toUpperCase(), size.w - m, m + 22);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Built from the bottom up, so the weather chip is always on the poster and
  // the place name sits directly above whatever follows it.
  const headline = layoutText(ctx, page.place ?? page.title, size.w - m * 2, {
    size: Math.round(Math.min(size.w * 0.095, size.h * 0.075)),
    minSize: Math.round(size.w * 0.05),
    weight: 800,
    family: FONT_DISPLAY,
    lines: 2,
    color: '#fff',
  });
  const chipH = 54;
  let y = size.h - m - (page.pageLabel ? 34 : 0);
  if (page.weather) {
    y -= chipH;
    chip(ctx, `${page.weather.emoji}  ${page.weather.temperature}°`, m, y, {
      size: 28,
      height: chipH,
      color: '#fff',
      fill: 'rgba(10, 13, 17, 0.55)',
    });
    y -= 16;
  }
  y -= 40;
  setFont(ctx, 30, 600, FONT_BODY);
  ctx.fillStyle = ink;
  ctx.fillText(page.place ? page.title : page.dateLabel, m, y);
  drawLayout(ctx, headline, m, y - 16 - headline.height);
  pageBadge(ctx, size, page, mt, 'rgba(255, 255, 255, 0.5)');
};

/**
 * Stoppenlint: the whole route, with a photo per place.
 *
 * This is the one for a trip rather than a day: the shape of where you went,
 * and a face for each place you stayed.
 */
const renderRibbon: TemplateRenderer = async (ctx, size, page, opts) => {
  const p = opts.palette;
  const mt = metrics(size);
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, size.w, size.h);
  const top = head(ctx, size, page, opts, mt);
  const shown = page.stops.slice(0, 4);
  const split = bodySplit(size, mt, top, Math.min(page.photos.length, 4), shown.length > 0);

  const focus: [number, number][] = page.lines.flat();
  for (const stop of page.stops) focus.push([stop.lng, stop.lat]);
  const map = drawMap(ctx, split.map, focus, { accent: page.accent, palette: p });
  drawRoute(ctx, map, page.lines, split.map, { color: page.accent, width: 8 });

  // No numbers on the dots. Two places a day trip apart sat on top of each
  // other and the figures were unreadable anyway; a place is a dot.
  ctx.save();
  roundRect(ctx, split.map, 40);
  ctx.clip();
  for (const stop of page.stops) {
    const xy = map.project([stop.lng, stop.lat]);
    if (xy) drawStopDot(ctx, xy[0], xy[1], page.accent, p.paper);
  }
  ctx.restore();

  if (split.photos) {
    await photoRow(
      ctx,
      page.photos.slice(0, 4),
      split.photos,
      16,
      p,
      shown.length > 0 ? shown.map((s) => s.name) : undefined,
    );
  }
  pageBadge(ctx, size, page, mt, p.inkFaint);
};

/**
 * Cijferposter: one photo, and what the trip added up to.
 *
 * The closing page of a series, and the whole poster for a trip whose story is
 * the size of it.
 */
const renderStats: TemplateRenderer = async (ctx, size, page, opts) => {
  const p = opts.palette;
  const mt = metrics(size);
  const m = mt.m;
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, size.w, size.h);

  const hero = page.photos[0] ? await loadPhoto(page.photos[0]) : null;
  const heroBox: Box = { x: 0, y: 0, w: size.w, h: size.h };
  if (hero) drawCover(ctx, hero, heroBox, 0);
  scrim(ctx, heroBox, 'rgba(10, 13, 17, 0.35)', 'rgba(10, 13, 17, 0.95)');

  const ink = '#fff';
  const inkSoft = 'rgba(255, 255, 255, 0.78)';
  const inkFaint = 'rgba(255, 255, 255, 0.55)';
  if (opts.showLogo) drawBrand(ctx, m, m, page.accent, inkSoft);
  setFont(ctx, 26, 600, FONT_BODY);
  ctx.fillStyle = inkSoft;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(page.dateLabel.toUpperCase(), size.w - m, m + 22);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // The route, small and unlabelled: a signature rather than a map.
  if (page.allLines.length > 0) {
    const sigBox: Box = { x: m, y: m + 90, w: size.w - m * 2, h: Math.round(size.h * 0.18) };
    const sig = drawMap(ctx, sigBox, page.allLines.flat(), {
      accent: page.accent,
      palette: p,
      land: false,
      grid: false,
      fill: null,
      radius: 0,
    });
    drawRoute(ctx, sig, page.allLines, sigBox, { color: page.accent, width: 7, radius: 0 });
  }

  // Bottom-up: flags, then the numbers, then the name above them, so a long
  // trip title never lands on top of its own statistics.
  const rowH = Math.round(150 * Math.min(1, size.h / 1500));
  const factRows = Math.ceil(page.facts.length / 2);
  const blockTop = size.h - m - factRows * rowH - (page.flags.length > 0 ? 80 : 0) - 20;

  const heading = layoutText(ctx, page.title, size.w - m * 2, {
    size: Math.round(Math.min(size.w * 0.09, size.h * 0.062)),
    minSize: Math.round(size.w * 0.045),
    weight: 800,
    family: FONT_DISPLAY,
    lines: 2,
    color: ink,
  });
  drawLayout(ctx, heading, m, blockTop - 34 - heading.height);

  page.facts.forEach((fact, i) => {
    const x = m + (i % 2) * ((size.w - m * 2) / 2);
    const y = blockTop + Math.floor(i / 2) * rowH;
    setFont(ctx, Math.round(rowH * 0.59), 800, FONT_DISPLAY);
    ctx.fillStyle = ink;
    ctx.fillText(fact.value, x, y);
    setFont(ctx, 26, 600, FONT_BODY);
    ctx.fillStyle = inkFaint;
    ctx.fillText(fact.label.toUpperCase(), x, y + rowH * 0.67);
  });

  if (page.flags.length > 0) {
    setFont(ctx, 46, 400, FONT_BODY);
    ctx.fillStyle = ink;
    ctx.fillText(page.flags.slice(0, 12).join(' '), m, size.h - m - 60);
  }
  pageBadge(ctx, size, page, mt, inkFaint);
};

export const TEMPLATES: Record<string, TemplateRenderer> = {
  route: renderRoute,
  photos: renderPhotos,
  ribbon: renderRibbon,
  stats: renderStats,
};
