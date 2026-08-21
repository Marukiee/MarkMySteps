import { fetchBlobUrl } from '../api/client';
import type { MediaItem, RouteCollection, Trip } from '../api/types';
import { buildLegs, haversineKm, splitOnGaps, type PlannedStop } from './arc';
import { buildPdf, type PdfPage } from './pdf';
import {
  DARK,
  LIGHT,
  drawCover,
  drawLayout,
  drawMap,
  drawRoute,
  drawStopDot,
  drawWrapped,
  layoutText,
  panel,
  readyFonts,
  roundRect,
  scrim,
  setFont,
  FONT_BODY,
  FONT_DISPLAY,
  type Palette,
} from './summary/canvas';

export interface BookNote {
  day: string;
  body: string;
}

export interface BookSource {
  trip: Trip;
  stops: PlannedStop[];
  media: MediaItem[];
  routes: RouteCollection | null;
  notes: BookNote[];
}

/** A4, in inches. The pixel size follows from the resolution asked for. */
const A4_W_IN = 8.27;
const A4_H_IN = 11.69;
/** Photographs per page. Rows are justified, so this is a target, not a grid. */
const PER_PAGE = 6;
/** A jump longer than this in the tracked line was flown, not driven. */
const FLIGHT_KM = 500;
/** How many photos are fetched at once while a page is being drawn. */
const PREFETCH = 6;

interface DayPage {
  kind: 'day';
  day: string;
  photos: MediaItem[];
  part: number;
  parts: number;
  title: string | null;
}

interface LegPage {
  kind: 'leg';
  from: PlannedStop & { latitude: number; longitude: number };
  to: PlannedStop & { latitude: number; longitude: number };
}

type BookPage = DayPage | LegPage;

/**
 * The whole trip as a book: a cover, its map, a page per day with that day's
 * note and photographs, and a small map wherever the trip moved on.
 *
 * The posters answer "one picture of this trip"; this answers "the trip, all
 * of it, on paper". Same drawing kit, same fonts, same route - so a printed
 * book and a shared poster are recognisably the same trip.
 *
 * Everything is drawn here, on this device: the photographs are already in the
 * app's own cache, the fonts are loaded, and a server would have to fetch all
 * of it again to produce the same pages.
 */
export async function renderPhotoBook(
  source: BookSource,
  options: { dpi?: number; theme?: 'light' | 'dark' } = {},
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  await readyFonts();
  const dpi = options.dpi ?? 150;
  const width = Math.round(A4_W_IN * dpi);
  const height = Math.round(A4_H_IN * dpi);
  const quality = dpi >= 150 ? 0.9 : 0.85;
  const palette = options.theme === 'dark' ? DARK : LIGHT;
  const accent =
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8613c';

  const pages = planPages(source);
  const total = pages.length + 2;

  // One canvas for the whole book. Ninety of them is ninety allocations of a
  // dozen megabytes each, which is what made a long book crawl.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Deze browser kan geen afbeeldingen tekenen');

  const out: PdfPage[] = [];
  let done = 0;

  const finish = async () => {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) throw new Error('Renderen mislukt');
    out.push({ jpeg: await blob.arrayBuffer(), width, height });
    onProgress?.(++done, total);
  };

  const page = { w: width, h: height, margin: Math.round(width * 0.072) };

  await drawCoverPage(ctx, page, source, palette, accent);
  await finish();
  await drawRoutePage(ctx, page, source, palette, accent);
  await finish();

  for (let i = 0; i < pages.length; i++) {
    const current = pages[i]!;
    // The next page's photographs are fetched while this one is being drawn,
    // so the decoder is never the thing everybody is waiting for.
    const next = pages[i + 1];
    if (next?.kind === 'day') void prefetch(next.photos);

    if (current.kind === 'leg') drawLegPage(ctx, page, current, source, palette, accent);
    else await drawDayPage(ctx, page, current, source, palette);
    await finish();
  }

  return buildPdf(out, source.trip.title, dpi);
}

/* ---- what goes in the book, in order ------------------------------------ */

/**
 * Days grouped under the stop they happened at, with a map wherever the trip
 * moved on to the next one.
 *
 * A book of nothing but photographs loses the thread halfway through: forty
 * pages in, "where is this?" has no answer on the page. The little maps are
 * the answer, and they cost one page per move.
 */
function planPages(source: BookSource): BookPage[] {
  const byDay = groupByDay(source.media);
  const days = [...byDay.keys()].sort();
  const route = source.stops.filter(
    (s): s is PlannedStop & { latitude: number; longitude: number } =>
      !s.parentStopId && s.latitude !== null && s.longitude !== null,
  );

  const pages: BookPage[] = [];
  let placed = 0; // how far through the stop list the days have got

  for (const day of days) {
    const photos = byDay.get(day)!;

    // Every stop the trip passed through before this day gets its map, in
    // order, so the moves stay in step with the photographs.
    while (placed < route.length - 1 && route[placed]!.departureDate < day) {
      pages.push({ kind: 'leg', from: route[placed]!, to: route[placed + 1]! });
      placed++;
    }

    const parts = Math.max(1, Math.ceil(photos.length / PER_PAGE));
    const title = dayTitle(source, day, photos);
    for (let part = 0; part < parts; part++) {
      pages.push({
        kind: 'day',
        day,
        photos: photos.slice(part * PER_PAGE, (part + 1) * PER_PAGE),
        part,
        parts,
        title,
      });
    }
  }

  return pages;
}

/** How many pages a book would have, for the estimate on screen. */
export function countBookPages(source: BookSource): number {
  if (source.media.length === 0) return 0;
  return planPages(source).length + 2;
}

/**
 * What to call a day.
 *
 * A travel day is covered by two stops at once: the leg you were on and the
 * place it delivered you to. The leg is the honest answer - you spent the day
 * getting there - unless the photographs say otherwise, because a plane that
 * lands at ten in the morning leaves a whole day of pictures at the far end.
 */
function dayTitle(source: BookSource, day: string, photos: MediaItem[]): string | null {
  const covering = source.stops.filter(
    (s) => !s.parentStopId && s.arrivalDate <= day && day <= s.departureDate,
  );
  if (covering.length === 0) return null;
  if (covering.length === 1) return covering[0]!.name;

  const leg = covering.find((s) => s.nights === 0);
  const destination = covering.find((s) => s !== leg && s.nights > 0) ?? covering[covering.length - 1]!;
  if (!leg) return destination.name;

  // Where the day's pictures were actually taken decides it.
  if (destination.latitude !== null && destination.longitude !== null) {
    const located = photos.filter((p) => p.latitude !== null && p.longitude !== null);
    if (located.length > 0) {
      const atDestination = located.filter(
        (p) =>
          haversineKm(
            [p.longitude!, p.latitude!],
            [destination.longitude!, destination.latitude!],
          ) <= 60,
      ).length;
      if (atDestination / located.length >= 0.6) return destination.name;
    }
  }
  return leg.name;
}

/* ---- the pages ---------------------------------------------------------- */

interface PageBox {
  w: number;
  h: number;
  margin: number;
}

function clear(ctx: CanvasRenderingContext2D, page: PageBox, palette: Palette): void {
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, page.w, page.h);
}

async function drawCoverPage(
  ctx: CanvasRenderingContext2D,
  page: PageBox,
  source: BookSource,
  palette: Palette,
  accent: string,
): Promise<void> {
  clear(ctx, page, palette);
  const coverId = source.trip.resolvedCoverId ?? source.media[0]?.id ?? null;
  const photo = coverId ? await loadImage(coverId) : null;

  const box = { x: 0, y: 0, w: page.w, h: page.h };
  if (photo) {
    drawBitmapCover(ctx, photo, box);
    scrim(ctx, box, 'rgba(10, 13, 17, 0.15)', 'rgba(10, 13, 17, 0.92)');
  } else {
    ctx.fillStyle = palette.panel;
    ctx.fillRect(0, 0, page.w, page.h);
  }

  const ink = photo ? '#ffffff' : palette.ink;
  const title = layoutText(ctx, source.trip.title, page.w - page.margin * 2, {
    size: Math.round(page.w * 0.09),
    weight: 700,
    family: FONT_DISPLAY,
    lines: 3,
    color: ink,
  });
  const bottom = drawLayout(
    ctx,
    title,
    page.margin,
    page.h - page.margin - title.height - page.margin,
  );

  setFont(ctx, Math.round(page.w * 0.027), 600, FONT_BODY);
  ctx.fillStyle = photo ? 'rgba(255,255,255,0.82)' : palette.inkSoft;
  ctx.textBaseline = 'top';
  ctx.fillText(dateRange(source.trip.startDate, source.trip.endDate), page.margin, bottom + 24);

  ctx.fillStyle = accent;
  ctx.fillRect(page.margin, page.h - page.margin - 6, Math.round(page.w * 0.14), 6);
}

async function drawRoutePage(
  ctx: CanvasRenderingContext2D,
  page: PageBox,
  source: BookSource,
  palette: Palette,
  accent: string,
): Promise<void> {
  clear(ctx, page, palette);
  const stops = source.stops.filter(
    (s): s is PlannedStop & { latitude: number; longitude: number } =>
      !s.parentStopId && s.latitude !== null && s.longitude !== null,
  );
  const { ground, flights } = splitTrack(source.routes, source.stops);
  const focus: [number, number][] = [
    ...ground.flat(),
    ...flights.flat(),
    ...stops.map((s) => [s.longitude, s.latitude] as [number, number]),
  ];

  drawWrapped(ctx, 'De route', page.margin, page.margin, page.w - page.margin * 2, {
    size: Math.round(page.w * 0.052),
    weight: 700,
    family: FONT_DISPLAY,
    color: palette.ink,
    lines: 1,
  });

  const mapBox = {
    x: page.margin,
    y: page.margin + Math.round(page.w * 0.1),
    w: page.w - page.margin * 2,
    h: Math.round(page.h * 0.5),
  };
  drawTrackMap(ctx, mapBox, focus, ground, flights, stops, palette, accent);

  // The itinerary in words underneath, which is what somebody reads when the
  // map has told them the shape of it.
  let y = mapBox.y + mapBox.h + Math.round(page.h * 0.035);
  const line = Math.round(page.w * 0.038);
  setFont(ctx, Math.round(page.w * 0.024), 600, FONT_BODY);
  ctx.textBaseline = 'top';
  for (const [index, stop] of stops.entries()) {
    if (y > page.h - page.margin - line) break;
    ctx.fillStyle = palette.inkFaint;
    ctx.fillText(String(index + 1).padStart(2, '0'), page.margin, y);
    ctx.fillStyle = palette.ink;
    ctx.fillText(stop.name, page.margin + line * 1.5, y);
    if (stop.nights > 0) {
      ctx.fillStyle = palette.inkSoft;
      const nights = `${stop.nights} ${stop.nights === 1 ? 'nacht' : 'nachten'}`;
      ctx.fillText(nights, page.w - page.margin - ctx.measureText(nights).width, y);
    }
    y += line;
  }
}

/** One move: where the trip went next, and how far it was. */
function drawLegPage(
  ctx: CanvasRenderingContext2D,
  page: PageBox,
  leg: LegPage,
  source: BookSource,
  palette: Palette,
  accent: string,
): void {
  clear(ctx, page, palette);

  const from: [number, number] = [leg.from.longitude, leg.from.latitude];
  const to: [number, number] = [leg.to.longitude, leg.to.latitude];
  const flight = leg.to.travelMode === 'FLIGHT';
  const legs = buildLegs([leg.from, leg.to]);
  const shape =
    (legs[legs.length - 1]?.feature.geometry.coordinates as [number, number][] | undefined) ?? [
      from,
      to,
    ];

  drawWrapped(ctx, 'Verder', page.margin, page.margin, page.w - page.margin * 2, {
    size: Math.round(page.w * 0.04),
    weight: 700,
    family: FONT_DISPLAY,
    color: palette.inkFaint,
    lines: 1,
  });

  const heading = `${leg.from.name} → ${leg.to.name}`;
  const title = layoutText(ctx, heading, page.w - page.margin * 2, {
    size: Math.round(page.w * 0.062),
    weight: 700,
    family: FONT_DISPLAY,
    color: palette.ink,
    lines: 2,
  });
  const bottom = drawLayout(ctx, title, page.margin, page.margin + Math.round(page.w * 0.075));

  const km = Math.round(haversineKm(from, to));
  setFont(ctx, Math.round(page.w * 0.024), 600, FONT_BODY);
  ctx.fillStyle = palette.inkSoft;
  ctx.textBaseline = 'top';
  ctx.fillText(
    `${flight ? 'Gevlogen' : 'Over land'} · ${km.toLocaleString('nl-NL')} km · ${formatDay(
      leg.to.arrivalDate,
    )}`,
    page.margin,
    bottom + Math.round(page.w * 0.02),
  );

  const mapBox = {
    x: page.margin,
    y: bottom + Math.round(page.w * 0.09),
    w: page.w - page.margin * 2,
    h: Math.round(page.h * 0.42),
  };
  drawTrackMap(
    ctx,
    mapBox,
    shape,
    flight ? [] : [shape],
    flight ? [shape] : [],
    [leg.from, leg.to],
    palette,
    accent,
  );
}

async function drawDayPage(
  ctx: CanvasRenderingContext2D,
  page: PageBox,
  day: DayPage,
  source: BookSource,
  palette: Palette,
): Promise<void> {
  clear(ctx, page, palette);
  let y = page.margin;

  // Only the first page of a day introduces it. Repeating the date over three
  // pages of the same afternoon says nothing the first one did not.
  if (day.part === 0) {
    y = drawWrapped(
      ctx,
      capitalise(formatDay(day.day, true)),
      page.margin,
      y,
      page.w - page.margin * 2,
      {
        size: Math.round(page.w * 0.047),
        weight: 700,
        family: FONT_DISPLAY,
        color: palette.ink,
        lines: 2,
      },
    );

    if (day.title) {
      setFont(ctx, Math.round(page.w * 0.023), 600, FONT_BODY);
      ctx.fillStyle = palette.inkSoft;
      ctx.textBaseline = 'top';
      ctx.fillText(day.title, page.margin, y + Math.round(page.w * 0.012));
      y += Math.round(page.w * 0.05);
    } else {
      y += Math.round(page.w * 0.022);
    }

    const note = source.notes.find((n) => n.day.slice(0, 10) === day.day)?.body;
    if (note) {
      y =
        drawWrapped(ctx, note, page.margin, y, page.w - page.margin * 2, {
          size: Math.round(page.w * 0.024),
          weight: 400,
          family: FONT_BODY,
          color: palette.ink,
          lines: 6,
          lineHeight: 1.45,
        }) + Math.round(page.w * 0.025);
    }
  } else {
    // A continuation page says only that it is one.
    setFont(ctx, Math.round(page.w * 0.022), 600, FONT_BODY);
    ctx.fillStyle = palette.inkFaint;
    ctx.textBaseline = 'top';
    ctx.fillText(`${day.part + 1}/${day.parts}`, page.margin, y);
    y += Math.round(page.w * 0.045);
  }

  await drawJustified(ctx, page, day.photos, y, palette);
}

/* ---- photographs, in their own shape ------------------------------------ */

/**
 * Rows of photographs at their own proportions, each row filling the width.
 *
 * Square cells cropped every picture to the middle: a portrait lost its head
 * and its feet, and a panorama became a postage stamp. Here a row is given a
 * height that makes its pictures add up to the page width, exactly as a photo
 * library lays out a grid.
 */
async function drawJustified(
  ctx: CanvasRenderingContext2D,
  page: PageBox,
  photos: MediaItem[],
  top: number,
  palette: Palette,
): Promise<void> {
  if (photos.length === 0) return;
  const gap = Math.round(page.w * 0.018);
  const width = page.w - page.margin * 2;
  const available = page.h - page.margin - top;

  const images = await Promise.all(photos.map((item) => loadImage(item.id)));
  const shapes = images.map((img, i) => ({
    img,
    ratio: img ? img.width / img.height : 1.5,
    id: photos[i]!.id,
  }));

  // How many fit across, chosen so the rows together come out about as tall as
  // the space that is left. With n pictures of average proportion r, k per row
  // gives a total height of n·width / (k²·r) — solve that for the height we
  // have, and round to something a page can hold.
  const avgRatio =
    shapes.reduce((total, s) => total + s.ratio, 0) / Math.max(1, shapes.length);
  const ideal = Math.sqrt((shapes.length * width) / Math.max(1, available * avgRatio));
  const perRow = Math.min(4, Math.max(1, Math.round(ideal)));

  const rows: (typeof shapes)[] = [];
  let row: typeof shapes = [];
  let ratioSum = 0;
  for (const shape of shapes) {
    row.push(shape);
    ratioSum += shape.ratio;
    // A panorama counts for more than one picture: a row holding one is full
    // sooner than a row of portraits.
    if (row.length >= perRow || ratioSum > perRow * avgRatio * 1.6) {
      rows.push(row);
      row = [];
      ratioSum = 0;
    }
  }
  if (row.length > 0) rows.push(row);

  // Each row's height is whatever makes its own pictures fill the width at
  // their own proportions; if the set is then too tall, everything shrinks by
  // the same factor and the rows are centred rather than stretched.
  const heights = rows.map((r) => {
    const sum = r.reduce((total, s) => total + s.ratio, 0);
    return (width - gap * (r.length - 1)) / sum;
  });
  const needed = heights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
  const scale = needed > available ? available / needed : 1;

  let y = top;
  for (const [index, r] of rows.entries()) {
    const h = heights[index]! * scale;
    const rowWidth = r.reduce((total, s) => total + s.ratio * h, 0) + gap * (r.length - 1);
    let x = page.margin + (width - rowWidth) / 2;
    for (const shape of r) {
      const box = { x, y, w: shape.ratio * h, h };
      panel(ctx, box, Math.round(page.w * 0.012), palette.panel);
      if (shape.img) drawBitmapCover(ctx, shape.img, box, Math.round(page.w * 0.012));
      x += box.w + gap;
    }
    y += h + gap;
  }
}

/* ---- maps --------------------------------------------------------------- */

/**
 * The tracked line, with the bits that were flown drawn as bows.
 *
 * A straight line from the Netherlands to Morocco is what a flight looks like
 * in the raw data, and drawn as a route it reads as a very long drive. Runs
 * separated by a jump are split apart, and the jump between them is drawn as
 * the arc it was.
 */
function drawTrackMap(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  focus: [number, number][],
  ground: [number, number][][],
  flights: [number, number][][],
  stops: { latitude: number | null; longitude: number | null }[],
  palette: Palette,
  accent: string,
): void {
  const radius = Math.round(box.w * 0.03);
  const map = drawMap(ctx, box, focus.length > 0 ? focus : [[0, 20]], {
    accent,
    palette,
    radius,
  });

  // Flights first, so the ground line is never buried under a bow.
  if (flights.length > 0) {
    ctx.save();
    roundRect(ctx, box, radius);
    ctx.clip();
    ctx.setLineDash([Math.round(box.w * 0.012), Math.round(box.w * 0.014)]);
    ctx.lineWidth = Math.max(2, Math.round(box.w * 0.005));
    ctx.strokeStyle = palette.inkFaint;
    ctx.lineCap = 'round';
    for (const line of flights) {
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
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawRoute(ctx, map, ground, box, {
    color: accent,
    width: Math.max(3, Math.round(box.w * 0.008)),
    radius,
  });

  for (const stop of stops) {
    if (stop.latitude === null || stop.longitude === null) continue;
    const xy = map.project([stop.longitude, stop.latitude]);
    if (xy) drawStopDot(ctx, xy[0], xy[1], accent, palette.paper, false, box.w / 1000);
  }
}

/** Ground runs and the flown jumps between them, from the tracked route. */
function splitTrack(
  routes: RouteCollection | null,
  stops: PlannedStop[],
): { ground: [number, number][][]; flights: [number, number][][] } {
  const ground: [number, number][][] = [];
  const flights: [number, number][][] = [];

  for (const feature of routes?.features ?? []) {
    const coords = feature.geometry.coordinates as [number, number][];
    const runs = splitOnGaps(coords, FLIGHT_KM);
    for (const run of runs) if (run.length >= 2) ground.push(run);
    // The gap between two runs is the flight that made it.
    for (let i = 1; i < runs.length; i++) {
      const a = runs[i - 1]![runs[i - 1]!.length - 1]!;
      const b = runs[i]![0]!;
      flights.push(bow(a, b));
    }
  }

  // Planned flights count too, even where nothing was tracked over them.
  for (const leg of buildLegs(stops)) {
    if (!leg.isFlight) continue;
    flights.push(leg.feature.geometry.coordinates as [number, number][]);
  }

  return { ground, flights };
}

/** A gentle bow between two points, so a flight is never a straight line. */
function bow(from: [number, number], to: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  const lift = Math.min(0.22, haversineKm(from, to) / 20000);
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    // A sine gives the highest point in the middle and none at the ends.
    const rise = Math.sin(Math.PI * t) * lift * Math.hypot(to[0] - from[0], to[1] - from[1]);
    out.push([x, y + rise]);
  }
  return out;
}

/* ---- images ------------------------------------------------------------- */

const bitmaps = new Map<string, ImageBitmap | HTMLImageElement | null>();
const pending = new Map<string, Promise<ImageBitmap | HTMLImageElement | null>>();

/**
 * A photo, decoded and ready to draw.
 *
 * `createImageBitmap` decodes off the main thread, which for a book of several
 * hundred photographs is the difference between a minute and several.
 */
async function loadImage(mediaId: string): Promise<ImageBitmap | HTMLImageElement | null> {
  const cached = bitmaps.get(mediaId);
  if (cached !== undefined) return cached;
  const existing = pending.get(mediaId);
  if (existing) return existing;

  const job = (async () => {
    try {
      const url = await fetchBlobUrl(`/media/${mediaId}/thumbnail`);
      const blob = await fetch(url).then((r) => r.blob());
      const image =
        typeof createImageBitmap === 'function'
          ? await createImageBitmap(blob)
          : await decodeElement(blob);
      bitmaps.set(mediaId, image);
      return image;
    } catch {
      bitmaps.set(mediaId, null);
      return null;
    } finally {
      pending.delete(mediaId);
    }
  })();
  pending.set(mediaId, job);
  return job;
}

function decodeElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = URL.createObjectURL(blob);
  });
}

/** Starts the next page's photographs on their way, a few at a time. */
async function prefetch(photos: MediaItem[]): Promise<void> {
  const queue = [...photos];
  await Promise.all(
    Array.from({ length: Math.min(PREFETCH, queue.length) }, async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        await loadImage(item.id);
      }
    }),
  );
}

/** drawCover, but for a bitmap as well as an element. */
function drawBitmapCover(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap | HTMLImageElement,
  box: { x: number; y: number; w: number; h: number },
  radius = 0,
): void {
  if (image instanceof HTMLImageElement) {
    drawCover(ctx, image, box, radius);
    return;
  }
  const scale = Math.max(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.save();
  roundRect(ctx, box, radius);
  ctx.clip();
  ctx.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  ctx.restore();
}

/* ---- helpers ------------------------------------------------------------ */

function groupByDay(media: MediaItem[]): Map<string, MediaItem[]> {
  const byDay = new Map<string, MediaItem[]>();
  for (const item of [...media].sort((a, b) => a.takenAt.localeCompare(b.takenAt))) {
    const day = item.takenAt.slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(item);
    else byDay.set(day, [item]);
  }
  return byDay;
}

function formatDay(day: string, long = false): string {
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString('nl-NL', {
    ...(long ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: long ? 'long' : 'short',
    timeZone: 'UTC',
  });
}

function dateRange(from: string, to: string): string {
  const start = new Date(from);
  const end = new Date(to);
  const fmt = (d: Date, month: boolean) =>
    d.toLocaleDateString('nl-NL', {
      day: 'numeric',
      ...(month ? { month: 'long' } : {}),
      year: 'numeric',
    });
  return `${fmt(start, start.getMonth() !== end.getMonth())} – ${fmt(end, true)}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
