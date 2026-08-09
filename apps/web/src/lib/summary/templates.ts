import {
  Box,
  drawLayout,
  layoutText,
  FONT_BODY,
  FONT_DISPLAY,
  INK,
  INK_FAINT,
  INK_SOFT,
  PANEL,
  PAPER,
  chip,
  drawBrand,
  drawCover,
  drawMap,
  drawRoute,
  drawStopDot,
  drawWrapped,
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
 * They share a grid and a voice: brand at the top left, the period at the top
 * right, the trip's name as the headline, and whatever the page is actually
 * about filling the middle. What differs is who gets the space — the map, the
 * photos, or the numbers.
 */

export type TemplateRenderer = (
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  page: PageData,
  opts: { showLogo: boolean },
) => Promise<void>;

const M = 68;

function margin(w: number): number {
  return Math.round((M * w) / 1080);
}

/** Brand, period, and the trip's name. Returns the y the body starts at. */
function header(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  page: PageData,
  opts: { showLogo: boolean },
): number {
  const m = margin(size.w);
  let y = m;
  if (opts.showLogo) {
    drawBrand(ctx, m, y, page.accent);
    y += 74;
  }

  setFont(ctx, 26, 600, FONT_BODY);
  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(page.dateLabel.toUpperCase(), size.w - m, m + 23);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const bottom = drawWrapped(ctx, page.title, m, y + 10, size.w - m * 2, {
    size: Math.round(size.w * 0.082),
    minSize: Math.round(size.w * 0.05),
    weight: 800,
    family: FONT_DISPLAY,
    lines: 2,
  });

  // Where you were, and what it was doing there.
  const bits: string[] = [];
  if (page.place) bits.push(page.place);
  if (page.weather) bits.push(`${page.weather.emoji} ${page.weather.temperature}°`);
  if (bits.length > 0) {
    setFont(ctx, 30, 600, FONT_BODY);
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(bits.join('   ·   '), m, bottom + 14);
    return bottom + 62;
  }
  return bottom + 20;
}

/** The numbers, in a row along the bottom. Returns the y it starts at. */
function factsRow(ctx: CanvasRenderingContext2D, size: { w: number; h: number }, page: PageData): number {
  const m = margin(size.w);
  const y = size.h - m - 92;
  if (page.facts.length === 0) return y;
  const cell = (size.w - m * 2) / page.facts.length;
  page.facts.forEach((fact, i) => {
    const x = m + cell * i;
    setFont(ctx, 54, 800, FONT_DISPLAY);
    ctx.fillStyle = INK;
    ctx.fillText(fact.value, x, y);
    setFont(ctx, 24, 600, FONT_BODY);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText(fact.label.toUpperCase(), x, y + 62);
  });
  return y;
}

function pageBadge(ctx: CanvasRenderingContext2D, size: { w: number; h: number }, page: PageData): void {
  if (!page.pageLabel) return;
  const m = margin(size.w);
  setFont(ctx, 24, 700, FONT_BODY);
  ctx.fillStyle = INK_FAINT;
  ctx.textAlign = 'right';
  ctx.fillText(page.pageLabel.toUpperCase(), size.w - m, size.h - m - 4);
  ctx.textAlign = 'left';
}

/** A row of photos, cropped square-ish, evenly spread across a width. */
async function photoRow(
  ctx: CanvasRenderingContext2D,
  ids: string[],
  box: Box,
  gap: number,
  labels?: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const cell = (box.w - gap * (ids.length - 1)) / ids.length;
  for (let i = 0; i < ids.length; i++) {
    const slot: Box = { x: box.x + (cell + gap) * i, y: box.y, w: cell, h: box.h };
    panel(ctx, slot, 24, PANEL);
    const img = await loadPhoto(ids[i]!);
    if (img) drawCover(ctx, img, slot, 24);
    const label = labels?.[i];
    if (label) {
      setFont(ctx, 24, 700, FONT_BODY);
      ctx.fillStyle = INK_SOFT;
      ctx.fillText(label, slot.x, slot.y + slot.h + 12);
    }
  }
}

/**
 * Routekaart: the map is the picture.
 *
 * The whole route of the period, its stops, and up to three photos underneath.
 * For a hike, a long day of driving, anything where the line itself is what
 * happened.
 */
const renderRoute: TemplateRenderer = async (ctx, size, page, opts) => {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size.w, size.h);
  const m = margin(size.w);
  const top = header(ctx, size, page, opts);
  const factsTop = factsRow(ctx, size, page);

  const hasPhotos = page.photos.length > 0;
  const photoH = hasPhotos ? Math.round(size.w * 0.24) : 0;
  const mapBox: Box = {
    x: m,
    y: top,
    w: size.w - m * 2,
    h: factsTop - top - (hasPhotos ? photoH + 56 : 24),
  };

  const focus: [number, number][] = page.lines.flat();
  for (const stop of page.stops) focus.push([stop.lng, stop.lat]);
  const map = drawMap(ctx, mapBox, focus, { accent: page.accent });
  drawRoute(ctx, map, page.lines, mapBox, { color: page.accent, width: 10 });

  for (const stop of page.stops.slice(0, 8)) {
    const xy = map.project([stop.lng, stop.lat]);
    if (xy) drawStopDot(ctx, xy[0], xy[1], page.accent);
  }
  // Where the day began and where it ended, which is the story of a route.
  const line = page.lines[0];
  const last = page.lines[page.lines.length - 1];
  if (line && last && line.length > 1) {
    const start = map.project(line[0]!);
    const end = map.project(last[last.length - 1]!);
    if (start) drawStopDot(ctx, start[0], start[1], INK);
    if (end) drawStopDot(ctx, end[0], end[1], page.accent);
  }

  if (hasPhotos) {
    await photoRow(
      ctx,
      page.photos.slice(0, 3),
      { x: m, y: mapBox.y + mapBox.h + 32, w: size.w - m * 2, h: photoH },
      20,
    );
  }
  pageBadge(ctx, size, page);
};

/**
 * Fotodag: no map at all.
 *
 * A day in a city is not a shape on a map, it is what you saw. So the photos
 * fill the frame and only the place, the date and the weather sit on top of
 * them.
 */
const renderPhotos: TemplateRenderer = async (ctx, size, page, opts) => {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size.w, size.h);
  const m = margin(size.w);
  const ids = page.photos.slice(0, 6);
  const gap = 12;
  const grid: Box = { x: 0, y: 0, w: size.w, h: size.h };

  // The mosaic shape follows how many photos there are, so two photos are two
  // halves rather than two thirds of an empty grid.
  const slots: Box[] = [];
  const cols = (n: number, box: Box, rows: number) => {
    const cw = (box.w - gap * (n - 1)) / n;
    const ch = (box.h - gap * (rows - 1)) / rows;
    return { cw, ch };
  };
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
    const rows = 3;
    const { cw, ch } = cols(2, grid, rows);
    for (let i = 0; i < 6; i++) {
      slots.push({ x: (i % 2) * (cw + gap), y: Math.floor(i / 2) * (ch + gap), w: cw, h: ch });
    }
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    panel(ctx, slot, 0, PANEL);
    const id = ids[i];
    if (!id) continue;
    const img = await loadPhoto(id);
    if (img) drawCover(ctx, img, slot, 0);
  }

  // Enough wash at the top for the mark, and a deeper one at the foot for the
  // place name, whatever the photo under it happens to be doing.
  scrim(ctx, { x: 0, y: 0, w: size.w, h: 260 }, 'rgba(10, 13, 17, 0.72)', 'rgba(10, 13, 17, 0)');
  scrim(ctx, { x: 0, y: size.h - size.h * 0.42, w: size.w, h: size.h * 0.42 });

  if (opts.showLogo) drawBrand(ctx, m, m, page.accent);
  setFont(ctx, 26, 600, FONT_BODY);
  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(page.dateLabel.toUpperCase(), size.w - m, m + 23);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Built from the bottom up, so the weather chip is always on the poster and
  // the place name sits directly above whatever follows it.
  const headline = layoutText(ctx, page.place ?? page.title, size.w - m * 2, {
    size: Math.round(size.w * 0.095),
    minSize: Math.round(size.w * 0.055),
    weight: 800,
    family: FONT_DISPLAY,
    lines: 2,
  });
  const chipH = 54;
  let y = size.h - m - (page.pageLabel ? 34 : 0);
  if (page.weather) {
    y -= chipH;
    chip(ctx, `${page.weather.emoji}  ${page.weather.temperature}°`, m, y, {
      size: 28,
      height: chipH,
      fill: 'rgba(10, 13, 17, 0.55)',
    });
    y -= 16;
  }
  y -= 40;
  setFont(ctx, 30, 600, FONT_BODY);
  ctx.fillStyle = INK_SOFT;
  ctx.fillText(page.place ? page.title : page.dateLabel, m, y);
  drawLayout(ctx, headline, m, y - 16 - headline.height);
  pageBadge(ctx, size, page);
};

/**
 * Stoppenlint: the whole route, numbered, with a photo per stop.
 *
 * This is the one for a trip rather than a day: the shape of where you went,
 * and a face for each place you stopped.
 */
const renderRibbon: TemplateRenderer = async (ctx, size, page, opts) => {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size.w, size.h);
  const m = margin(size.w);
  const top = header(ctx, size, page, opts);
  const factsTop = factsRow(ctx, size, page);

  const hasPhotos = page.photos.length > 0;
  const photoH = hasPhotos ? Math.round(size.w * 0.2) : 0;
  const mapBox: Box = {
    x: m,
    y: top,
    w: size.w - m * 2,
    // Room for the photos, the stop name under each of them, and air before
    // the numbers start.
    h: factsTop - top - (hasPhotos ? photoH + 108 : 24),
  };

  const focus: [number, number][] = page.lines.flat();
  for (const stop of page.stops) focus.push([stop.lng, stop.lat]);
  const map = drawMap(ctx, mapBox, focus, { accent: page.accent });
  drawRoute(ctx, map, page.lines, mapBox, { color: page.accent, width: 8 });

  // Numbered in travel order, and only as many as stay legible.
  const shown = page.stops.slice(0, 9);
  ctx.save();
  roundRect(ctx, mapBox, 40);
  ctx.clip();
  for (const stop of shown) {
    const xy = map.project([stop.lng, stop.lat]);
    if (xy) drawStopDot(ctx, xy[0], xy[1], page.accent, String(stop.number));
  }
  ctx.restore();

  if (hasPhotos) {
    await photoRow(
      ctx,
      page.photos.slice(0, 4),
      { x: m, y: mapBox.y + mapBox.h + 34, w: size.w - m * 2, h: photoH },
      16,
      shown.slice(0, 4).map((s) => `${s.number}. ${s.name}`),
    );
  }
  pageBadge(ctx, size, page);
};

/**
 * Cijferposter: one photo, and what the trip added up to.
 *
 * The closing page of a series, and the whole poster for a trip whose story is
 * the size of it.
 */
const renderStats: TemplateRenderer = async (ctx, size, page, opts) => {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size.w, size.h);
  const m = margin(size.w);

  const hero = page.photos[0] ? await loadPhoto(page.photos[0]) : null;
  const heroBox: Box = { x: 0, y: 0, w: size.w, h: size.h };
  if (hero) drawCover(ctx, hero, heroBox, 0);
  scrim(ctx, heroBox, 'rgba(10, 13, 17, 0.35)', 'rgba(10, 13, 17, 0.95)');

  if (opts.showLogo) drawBrand(ctx, m, m, page.accent);
  setFont(ctx, 26, 600, FONT_BODY);
  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(page.dateLabel.toUpperCase(), size.w - m, m + 23);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // The route, small and unlabelled: a signature rather than a map.
  if (page.allLines.length > 0) {
    const sigBox: Box = { x: m, y: m + 96, w: size.w - m * 2, h: Math.round(size.h * 0.2) };
    const map = drawMap(ctx, sigBox, page.allLines.flat(), {
      accent: page.accent,
      land: false,
      grid: false,
      fill: null,
      radius: 0,
    });
    drawRoute(ctx, map, page.allLines, sigBox, { color: page.accent, width: 7, radius: 0 });
  }

  // Also bottom-up: flags, then the numbers, then the name above them, so a
  // long trip title never lands on top of its own statistics.
  const factRows = Math.ceil(page.facts.length / 2);
  const blockTop = size.h - m - factRows * 150 - (page.flags.length > 0 ? 80 : 0) - 20;

  const heading = layoutText(ctx, page.title, size.w - m * 2, {
    size: Math.round(size.w * 0.09),
    minSize: Math.round(size.w * 0.055),
    weight: 800,
    family: FONT_DISPLAY,
    lines: 2,
  });
  drawLayout(ctx, heading, m, blockTop - 34 - heading.height);

  page.facts.forEach((fact, i) => {
    const x = m + (i % 2) * ((size.w - m * 2) / 2);
    const y = blockTop + Math.floor(i / 2) * 150;
    setFont(ctx, 88, 800, FONT_DISPLAY);
    ctx.fillStyle = INK;
    ctx.fillText(fact.value, x, y);
    setFont(ctx, 26, 600, FONT_BODY);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText(fact.label.toUpperCase(), x, y + 100);
  });

  if (page.flags.length > 0) {
    setFont(ctx, 46, 400, FONT_BODY);
    ctx.fillStyle = INK;
    ctx.fillText(page.flags.slice(0, 12).join(' '), m, size.h - m - 60);
  }
  pageBadge(ctx, size, page);
};

export const TEMPLATES: Record<string, TemplateRenderer> = {
  route: renderRoute,
  photos: renderPhotos,
  ribbon: renderRibbon,
  stats: renderStats,
};
