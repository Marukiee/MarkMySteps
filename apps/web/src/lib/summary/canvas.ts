import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import * as topojson from 'topojson-client';
import countries110m from 'world-atlas/countries-110m.json';
import { fetchBlobUrl } from '../../api/client';

/**
 * Drawing kit for the posters.
 *
 * Everything here is plain canvas 2D on bitmaps the app makes itself: no map
 * tiles, no external images, nothing that can taint the canvas or fail to load
 * on a bad connection. The map is the world's own outlines (already bundled
 * for the globe on the home page) with the route drawn over it, which also
 * means a poster looks the same every time it is made.
 */

type Topology = Parameters<typeof topojson.feature>[0] & {
  objects: { countries: Parameters<typeof topojson.feature>[1] };
};

const topo = countries110m as unknown as Topology;
const LAND = topojson.feature(topo, topo.objects.countries) as unknown as GeoPermissibleObjects;

/**
 * What a poster is made of, in two moods.
 *
 * Dark lets the photos and the route carry all the colour; light is the app's
 * own paper, for a feed that is mostly white. Everything that draws takes its
 * colours from here rather than from a constant, so one setting changes the
 * whole picture.
 */
export interface Palette {
  ink: string;
  inkSoft: string;
  inkFaint: string;
  paper: string;
  panel: string;
  land: string;
  landLine: string;
  grid: string;
}

export const DARK: Palette = {
  ink: '#f6f3ee',
  inkSoft: 'rgba(246, 243, 238, 0.62)',
  inkFaint: 'rgba(246, 243, 238, 0.34)',
  paper: '#0f1319',
  panel: '#171d25',
  land: '#232b35',
  landLine: 'rgba(246, 243, 238, 0.12)',
  grid: 'rgba(246, 243, 238, 0.05)',
};

export const LIGHT: Palette = {
  ink: '#1c1a17',
  inkSoft: 'rgba(28, 26, 23, 0.62)',
  inkFaint: 'rgba(28, 26, 23, 0.40)',
  paper: '#faf7f2',
  panel: '#efe9e0',
  land: '#e2dbd0',
  landLine: 'rgba(28, 26, 23, 0.14)',
  grid: 'rgba(28, 26, 23, 0.06)',
};

export const PALETTES: Record<'dark' | 'light', Palette> = { dark: DARK, light: LIGHT };

export const FONT_BODY = "'Inter Variable', system-ui, sans-serif";
export const FONT_DISPLAY = "'Fraunces Variable', Georgia, serif";
export const FONT_BRAND = "'Outfit Variable', 'Inter Variable', system-ui, sans-serif";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function roundRect(ctx: CanvasRenderingContext2D, box: Box, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, radius);
}

/** Fills a rounded panel. */
export function panel(ctx: CanvasRenderingContext2D, box: Box, radius: number, fill: string): void {
  roundRect(ctx, box, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Draws an image so it covers the box, cropped from the middle and clipped to
 * a rounded rectangle. Nothing is ever squashed to fit.
 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  box: Box,
  radius = 0,
): void {
  const scale = Math.max(box.w / img.width, box.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.save();
  roundRect(ctx, box, radius);
  ctx.clip();
  ctx.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  ctx.restore();
}

/** A dark wash so white text stays readable over any photo. */
export function scrim(
  ctx: CanvasRenderingContext2D,
  box: Box,
  from = 'rgba(10, 13, 17, 0)',
  to = 'rgba(10, 13, 17, 0.88)',
): void {
  const gradient = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  ctx.fillStyle = gradient;
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

export function setFont(
  ctx: CanvasRenderingContext2D,
  size: number,
  weight: number | string = 400,
  family = FONT_BODY,
): void {
  ctx.font = `${weight} ${size}px ${family}`;
}

/**
 * Wraps text to a width and draws it, shrinking the type until it fits in the
 * lines it is allowed. Returns the bottom edge, so the next block knows where
 * it starts.
 */
export interface TextOpts {
  size: number;
  minSize?: number;
  weight?: number | string;
  family?: string;
  lines?: number;
  lineHeight?: number;
  color?: string;
}

export interface TextLayout {
  lines: string[];
  size: number;
  lineHeight: number;
  height: number;
  opts: TextOpts;
}

/**
 * Works out the lines and the type size without drawing anything.
 *
 * Blocks that hang off the bottom of a poster have to know how tall they are
 * before they know where they start; guessing at two lines is how a headline
 * ends up sitting on top of the numbers underneath it.
 */
export function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  opts: TextOpts,
): TextLayout {
  const maxLines = opts.lines ?? 2;
  const min = opts.minSize ?? opts.size * 0.6;
  let size = opts.size;
  let lines: string[] = [];
  for (;;) {
    setFont(ctx, size, opts.weight ?? 700, opts.family ?? FONT_DISPLAY);
    lines = wrap(ctx, text, maxWidth);
    // Too many lines, or one line too wide to break — "ZomerZwedenVakantie"
    // is a single word, so wrapping can never make it fit and only a smaller
    // size will. Without the second test it ran straight off the poster.
    const overflows = lines.some((line) => ctx.measureText(line).width > maxWidth);
    if ((lines.length <= maxLines && !overflows) || size <= min) break;
    size -= 2;
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/\s+\S*$/, '')}…`;
  }
  const lineHeight = size * (opts.lineHeight ?? 1.12);
  return { lines, size, lineHeight, height: lines.length * lineHeight, opts };
}

/** Paints a measured block with its top edge at `y`. Returns the bottom edge. */
export function drawLayout(
  ctx: CanvasRenderingContext2D,
  layout: TextLayout,
  x: number,
  y: number,
): number {
  setFont(ctx, layout.size, layout.opts.weight ?? 700, layout.opts.family ?? FONT_DISPLAY);
  ctx.fillStyle = layout.opts.color ?? 'currentColor';
  ctx.textBaseline = 'top';
  layout.lines.forEach((line, i) => ctx.fillText(line, x, y + i * layout.lineHeight));
  return y + layout.height;
}

/** Measure and draw in one go, for blocks that hang from the top. */
export function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  opts: TextOpts,
): number {
  return drawLayout(ctx, layoutText(ctx, text, maxWidth, opts), x, y);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A small outlined pill with a label in it. Returns its width. */
export function chip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; color?: string; border?: string; fill?: string; height?: number } = {},
): number {
  const size = opts.size ?? 26;
  const height = opts.height ?? size * 1.9;
  setFont(ctx, size, 600, FONT_BODY);
  const width = ctx.measureText(text).width + size * 1.6;
  roundRect(ctx, { x, y, w: width, h: height }, height / 2);
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.fill();
  }
  ctx.strokeStyle = opts.border ?? 'rgba(246, 243, 238, 0.28)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = opts.color ?? '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + size * 0.8, y + height / 2 + 1);
  ctx.textBaseline = 'top';
  return width;
}

/**
 * The compass, drawn from the same two shapes the app's logo uses so the
 * poster carries the real mark rather than a lookalike.
 */
export function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(12, 12, 9.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.stroke(new Path2D('m16.4 7.6-2.5 6.3-6.3 2.5 2.5-6.3Z'));
  ctx.restore();
}

/** Logo plus wordmark, the block every poster opens with. */
export function drawBrand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  ink: string,
  scale = 1,
): void {
  drawLogo(ctx, x, y, 44 * scale, accent);
  setFont(ctx, 24 * scale, 700, FONT_BRAND);
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${2.5 * scale}px`;
  ctx.fillText('MARKMYSTEPS', x + 58 * scale, y + 23 * scale);
  ctx.letterSpacing = '0px';
  ctx.textBaseline = 'top';
}

export interface MapDraw {
  /** Turns [lng, lat] into a point inside the box. */
  project: (point: [number, number]) => [number, number] | null;
}

/**
 * Paints the world inside a box, framed on the given coordinates.
 *
 * The frame is the route with a margin around it, so a walk through one valley
 * fills the panel just as a flight across a continent does. Below a certain
 * span the country outlines are meaningless (a city walk is not a shape you
 * recognise), so they fade out and the route is left to speak for itself.
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  box: Box,
  focus: [number, number][],
  opts: {
    accent: string;
    palette: Palette;
    radius?: number;
    land?: boolean;
    fill?: string | null;
    grid?: boolean;
  },
): MapDraw {
  const radius = opts.radius ?? 40;
  ctx.save();
  roundRect(ctx, box, radius);
  ctx.clip();
  // `fill: null` asks for the projection and nothing else — the signature
  // route on the stats poster is drawn straight onto the photo behind it.
  if (opts.fill !== null) {
    ctx.fillStyle = opts.fill ?? opts.palette.panel;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }

  const lngs = focus.map((p) => p[0]);
  const lats = focus.map((p) => p[1]);
  const spanLng = focus.length > 0 ? Math.max(...lngs) - Math.min(...lngs) : 30;
  const spanLat = focus.length > 0 ? Math.max(...lats) - Math.min(...lats) : 20;
  // A single point, or a walk of a few hundred metres, still needs a window
  // with something in it.
  const pad = Math.max(spanLng, spanLat, 0.02) * 0.35;
  // Two opposite corners as a MultiPoint, not a polygon: d3 reads a polygon's
  // winding on the sphere, and a ring wound the wrong way is not a small box
  // but everything except that box — which fits the whole world into the panel
  // and collapses the route to a dot.
  const bounds = {
    type: 'MultiPoint',
    coordinates:
      focus.length > 0
        ? [
            [Math.min(...lngs) - pad, Math.min(...lats) - pad],
            [Math.max(...lngs) + pad, Math.max(...lats) + pad],
          ]
        : [
            [-30, -20],
            [40, 60],
          ],
  };

  const projection = geoMercator().fitExtent(
    [
      [box.x + 8, box.y + 8],
      [box.x + box.w - 8, box.y + box.h - 8],
    ],
    bounds as unknown as GeoPermissibleObjects,
  );

  const wide = Math.max(spanLng, spanLat) > 0.6;
  if (opts.land !== false && wide) {
    const path = geoPath(projection, ctx);
    ctx.beginPath();
    path(LAND);
    ctx.fillStyle = opts.palette.land;
    ctx.fill();
    ctx.strokeStyle = opts.palette.landLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (opts.grid !== false) {
    // Close in, a faint grid gives the eye something to measure the route
    // against without pretending to be a street map.
    ctx.strokeStyle = opts.palette.grid;
    ctx.lineWidth = 2;
    for (let gx = box.x; gx < box.x + box.w; gx += 74) {
      ctx.beginPath();
      ctx.moveTo(gx, box.y);
      ctx.lineTo(gx, box.y + box.h);
      ctx.stroke();
    }
    for (let gy = box.y; gy < box.y + box.h; gy += 74) {
      ctx.beginPath();
      ctx.moveTo(box.x, gy);
      ctx.lineTo(box.x + box.w, gy);
      ctx.stroke();
    }
  }
  ctx.restore();

  return {
    project: (point) => {
      const xy = projection(point);
      return xy ? [xy[0], xy[1]] : null;
    },
  };
}

/** The route: a soft glow under a solid line, so it reads on any background. */
export function drawRoute(
  ctx: CanvasRenderingContext2D,
  map: MapDraw,
  lines: [number, number][][],
  box: Box,
  opts: { color: string; width?: number; radius?: number; dim?: boolean },
): void {
  const width = opts.width ?? 9;
  ctx.save();
  roundRect(ctx, box, opts.radius ?? 40);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const pass of opts.dim ? ['line'] : ['glow', 'line']) {
    ctx.strokeStyle = opts.color;
    ctx.globalAlpha = opts.dim ? 0.22 : pass === 'glow' ? 0.22 : 1;
    ctx.lineWidth = pass === 'glow' ? width * 3 : width;
    for (const line of lines) {
      ctx.beginPath();
      let started = false;
      for (const point of line) {
        const xy = map.project(point);
        if (!xy) continue;
        if (started) ctx.lineTo(xy[0], xy[1]);
        else {
          ctx.moveTo(xy[0], xy[1]);
          started = true;
        }
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** A stop: a filled dot with a ring, optionally numbered. */
export function drawStopDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  ring: string,
  big = false,
): void {
  const r = big ? 16 : 12;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 5;
  ctx.stroke();
}

const imageCache = new Map<string, HTMLImageElement>();

/**
 * A photo, decoded and ready to draw.
 *
 * Goes through the same authorized proxy the rest of the app uses, which hands
 * back a blob URL — same-origin, so the canvas stays exportable.
 */
export async function loadPhoto(mediaId: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(mediaId);
  if (cached) return cached;
  try {
    const url = await fetchBlobUrl(`/media/${mediaId}/thumbnail`);
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    imageCache.set(mediaId, img);
    return img;
  } catch {
    return null;
  }
}

/**
 * The fonts have to be there before the first letter is drawn.
 *
 * `document.fonts.ready` only promises that what the PAGE asked for has
 * arrived, and canvas never asks: a face the layout happens not to be using at
 * that size and weight is quietly swapped for a system one, which is how the
 * wordmark came out in the wrong type. So each face this file draws with is
 * requested by name first.
 */
export async function readyFonts(): Promise<void> {
  const faces = [
    `800 96px ${FONT_DISPLAY}`,
    `700 54px ${FONT_DISPLAY}`,
    `700 24px ${FONT_BRAND}`,
    `600 30px ${FONT_BODY}`,
    `700 26px ${FONT_BODY}`,
    `800 26px ${FONT_BODY}`,
  ];
  try {
    await Promise.all(faces.map((face) => document.fonts.load(face)));
    await document.fonts.ready;
  } catch {
    /* no font loading API: the fallbacks in the stacks above will do */
  }
}
