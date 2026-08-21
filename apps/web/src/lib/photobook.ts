import { fetchBlobUrl } from '../api/client';
import type { MediaItem, RouteCollection, Trip } from '../api/types';
import { buildLegs, haversineKm, MODE_LABEL, splitOnGaps, type PlannedStop } from './arc';
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

  const page = { w: width, h: height, margin: Math.round(width * 0.072) };
  // The plan needs to know what shape every photograph is: how many fit on a
  // page is a question about proportions, not a number decided in advance.
  const pages = await planPages(source, page);
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

  // The blobs were only ever needed while the pages were being drawn.
  forgetImages();

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
async function planPages(source: BookSource, page: PageBox): Promise<BookPage[]> {
  const byDay = groupByDay(source.media);
  const days = [...byDay.keys()].sort();
  const route = source.stops.filter(
    (s): s is PlannedStop & { latitude: number; longitude: number } =>
      !s.parentStopId && s.latitude !== null && s.longitude !== null,
  );

  const gap = Math.round(page.w * 0.018);
  const width = page.w - page.margin * 2;

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

    const title = dayTitle(source, day, photos);
    const hasNote = source.notes.some((n) => n.day.slice(0, 10) === day);
    // What the writing at the top of a page leaves for the pictures. The first
    // page of a day carries the date, the place and any note; the rest carry
    // one small line saying which page of the day they are.
    const first = page.h - page.margin - Math.round(page.h * (hasNote ? 0.3 : 0.17));
    const rest = page.h - page.margin - Math.round(page.h * 0.08);

    const shapes = await measure(photos);
    const split = paginate(shapes, width, gap, first, rest);
    for (const [part, group] of split.entries()) {
      pages.push({
        kind: 'day',
        day,
        photos: group.map((shape) => shape.item),
        part,
        parts: split.length,
        title,
      });
    }
  }

  return pages;
}

/**
 * How many photographs a page holds: as many as fill it.
 *
 * A fixed six per page is what left half of a page white - six portraits are
 * two rows, six panoramas are three, and neither happens to be the height of
 * an A4. Rows are built to a width budget and added until the next one would
 * not fit, so every page but the last of a day comes out full.
 */
function paginate(
  shapes: Shape[],
  width: number,
  gap: number,
  availFirst: number,
  availRest: number,
): Shape[][] {
  const groups: Shape[][] = [];
  let index = 0;

  while (index < shapes.length) {
    const available = groups.length === 0 ? availFirst : availRest;
    // Three rows to a page is the size photographs want to be in a book: big
    // enough to look at, small enough that a day is not thirty pages.
    const budget = Math.min(5, Math.max(1.4, width / (available / 3)));
    const group: Shape[] = [];
    let used = 0;

    while (index < shapes.length) {
      const row: Shape[] = [];
      let sum = 0;
      let next = index;
      while (next < shapes.length) {
        row.push(shapes[next]!);
        sum += shapes[next]!.ratio;
        next++;
        if (sum >= budget) break;
      }
      const height = (width - gap * (row.length - 1)) / sum;
      const needed = used === 0 ? height : used + gap + height;
      // A page always takes at least one row, or a single panorama taller than
      // the space left would never be placed anywhere.
      if (group.length > 0 && needed > available) break;
      used = needed;
      group.push(...row);
      index = next;
      if (used > available - gap * 2) break;
    }

    groups.push(group);
  }

  return groups.length > 0 ? groups : [[]];
}

/** How many pages a book comes to, near enough for a line of text. */
export function countBookPages(source: BookSource): number {
  if (source.media.length === 0) return 0;
  const byDay = groupByDay(source.media);
  // Eight is what a page of mixed proportions tends to hold; the real number
  // is known only once every photograph has been measured, which is work this
  // estimate exists to avoid.
  let pages = 2;
  for (const photos of byDay.values()) pages += Math.max(1, Math.ceil(photos.length / 8));
  const stops = source.stops.filter(
    (s) => !s.parentStopId && s.latitude !== null && s.longitude !== null,
  );
  return pages + Math.max(0, stops.length - 1);
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
  const photo = coverId ? await decode(coverId) : null;

  const box = { x: 0, y: 0, w: page.w, h: page.h };
  if (photo) {
    drawBitmapCover(ctx, photo, box);
    if ('close' in photo) photo.close();
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
  // The way you actually went, if it was tracked: the straight line between
  // two stops says nothing that the two dots did not already say.
  const tracked = flight ? null : trackedBetween(source.routes, from, to);
  const shape =
    tracked ??
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

  // The distance along the way it was actually travelled where that is known,
  // and how it was travelled according to the plan — "Trein", not "over land".
  const km = Math.round(tracked ? lineKm(tracked) : haversineKm(from, to));
  const mode = MODE_LABEL[leg.to.travelMode] ?? 'Onderweg';
  setFont(ctx, Math.round(page.w * 0.024), 600, FONT_BODY);
  ctx.fillStyle = palette.inkSoft;
  ctx.textBaseline = 'top';
  ctx.fillText(
    `${mode} · ${km.toLocaleString('nl-NL')} km · ${formatDay(leg.to.arrivalDate)}`,
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

  const shapes = await measure(photos);
  const rows = uniformRows(shapes, width, gap, available) ?? packRows(shapes, width, gap, available);

  // Three portraits fill the width but only two thirds of the height; the
  // block sits in the middle of what is left rather than hanging from the
  // text with a third of the page blank underneath it.
  const used = rows.reduce((total, row) => total + row.height, 0) + gap * (rows.length - 1);
  let y = top + Math.max(0, (available - used) / 2);
  const radius = Math.round(page.w * 0.012);
  for (const row of rows) {
    let x = page.margin + (width - row.width) / 2;
    for (const shape of row.items) {
      const box = { x, y, w: shape.ratio * row.height, h: row.height };
      panel(ctx, box, radius, palette.panel);
      // Decoded here and closed straight away: one picture in memory at a
      // time is what lets a book of nine hundred photographs finish at all.
      const image = await decode(shape.item.id);
      if (image) {
        drawBitmapCover(ctx, image, box, radius);
        if ('close' in image) image.close();
      }
      x += box.w + gap;
    }
    y += row.height + gap;
  }
}

/** How much a picture may be cropped to make a row come out even. */
const CROP_TOLERANCE = 0.1;
/** How much of the page a layout may leave empty before it is not worth it. */
const FILLS = [1, 0.97, 0.94, 0.91, 0.88, 0.85, 0.82];

/**
 * Rows that all share one height and together fill the page.
 *
 * Left to their own proportions, rows come out at three different heights and
 * a page ends either short or with a cramped little row along the bottom.
 * Giving every row the same height and letting each picture be cropped by a
 * few per cent - which is all `drawCover` does anyway - makes a page look
 * composed rather than merely filled.
 *
 * Both the number of rows and how much of the page they cover are searched
 * for. Nothing comes back when it would take more than a tenth of a picture
 * to make it work: at that point the pictures are being forced, and the honest
 * ragged version is better.
 */
function uniformRows<T extends { ratio: number }>(
  shapes: T[],
  width: number,
  gap: number,
  available: number,
): PackedRow<T>[] | null {
  if (shapes.length === 0) return null;
  let best: { rows: PackedRow<T>[]; score: number } | null = null;

  for (let count = 1; count <= Math.min(5, shapes.length); count++) {
    for (const fill of FILLS) {
      const height = (available * fill - gap * (count - 1)) / count;
      if (height <= 0) continue;

      // Photographs stay in the order they were taken; a row is closed once it
      // holds about enough width, keeping one for every row still to come.
      const groups: T[][] = [];
      let index = 0;
      let usable = true;
      for (let row = 0; row < count; row++) {
        const items: T[] = [];
        let sum = 0;
        const rowsLeft = count - row - 1;
        while (index < shapes.length) {
          items.push(shapes[index]!);
          sum += shapes[index]!.ratio;
          index++;
          if (shapes.length - index <= rowsLeft) break;
          if (sum >= ((width - gap * (items.length - 1)) / height) * 0.94) break;
        }
        if (items.length === 0) {
          usable = false;
          break;
        }
        groups.push(items);
      }
      if (!usable || index < shapes.length) continue;

      let worst = 0;
      const rows: PackedRow<T>[] = groups.map((items) => {
        const sum = items.reduce((value, item) => value + item.ratio, 0);
        // What the row's proportions would have to add up to for it to fill
        // the width at this height; the difference is the crop.
        const stretch = (width - gap * (items.length - 1)) / height / sum;
        worst = Math.max(worst, Math.abs(stretch - 1));
        return {
          items: items.map((item) => ({ ...item, ratio: item.ratio * stretch })),
          height,
          width,
        };
      });
      if (worst > CROP_TOLERANCE) continue;

      // A full page is worth a little cropping, but not much.
      const score = fill - worst * 0.5;
      if (!best || score > best.score) best = { rows, score };
    }
  }

  return best?.rows ?? null;
}

interface PackedRow<T extends { ratio: number }> {
  items: T[];
  height: number;
  /** What the row actually measures, so a short last row can be centred. */
  width: number;
}

/**
 * Rows of photographs at their own proportions, each row filling the width.
 *
 * A row is full when the proportions in it add up to a budget: three portraits
 * come to about the same as two landscapes, which is why a page can hold three
 * of one or two of the other. The budget is searched for rather than fixed,
 * because it is the thing that decides how tall the whole set comes out, and
 * the set has to fit the space left under the writing.
 *
 * Rows always fill the page width, so a page never ends up with two pictures
 * marooned in the middle of it - which is what scaling the rows down instead
 * of packing more into them used to do.
 */
function packRows<T extends { ratio: number }>(
  shapes: T[],
  width: number,
  gap: number,
  available: number,
): PackedRow<T>[] {
  const build = (budget: number, feature: boolean): PackedRow<T>[] => {
    const rows: PackedRow<T>[] = [];
    let items: T[] = [];
    let sum = 0;
    // A page that will not fill otherwise can open with one picture across the
    // whole width: three landscapes are a short page as three half-rows and a
    // handsome one as a big picture over a pair.
    const rest = feature ? shapes.slice(1) : shapes;
    if (feature && shapes[0]) rows.push(finishRow([shapes[0]], shapes[0].ratio, width, gap));

    for (const shape of rest) {
      items.push(shape);
      sum += shape.ratio;
      if (sum >= budget) {
        rows.push(finishRow(items, sum, width, gap));
        items = [];
        sum = 0;
      }
    }
    if (items.length > 0) rows.push(finishRow(items, sum, width, gap));

    // A last row with one picture in it would be as wide as the page and far
    // taller than the rows above; it keeps their height and is centred later.
    const last = rows[rows.length - 1];
    if (last && rows.length > 1) {
      const tallest = Math.max(...rows.slice(0, -1).map((row) => row.height));
      if (last.height > tallest * 1.15) {
        const rowWidth =
          last.items.reduce((total, item) => total + item.ratio * tallest, 0) +
          gap * (last.items.length - 1);
        rows[rows.length - 1] = { items: last.items, height: tallest, width: rowWidth };
      }
    }
    return rows;
  };

  const heightOf = (rows: PackedRow<T>[]) =>
    rows.reduce((total, row) => total + row.height, 0) + gap * Math.max(0, rows.length - 1);

  /**
   * How good a layout is: how much of the page it covers.
   *
   * A little over is better than a lot under — a set that comes out eight per
   * cent too tall is drawn a shade smaller and still fills the page, while the
   * tighter packing that fits exactly leaves half of it white.
   */
  const OVERFLOW = 1.12;
  let best: PackedRow<T>[] | null = null;
  let bestScore = -1;

  for (const feature of [false, true]) {
    for (let step = 0; step <= 56; step++) {
      const budget = 1.2 + (step / 56) * 5.8;
      const rows = build(budget, feature);
      const height = heightOf(rows);
      if (height <= 0 || height > available * OVERFLOW) continue;
      // Two identical layouts (the same rows from neighbouring budgets) score
      // the same; the first one wins, which is the one with bigger pictures.
      const score = Math.min(height, available) / available;
      if (score > bestScore + 0.001) {
        bestScore = score;
        best = rows;
      }
    }
  }

  // Nothing fit even with room to spare: the tightest packing, scaled down.
  let rows = best ?? build(7, false);
  const total = heightOf(rows);
  if (total > available && total > 0) {
    const scale = available / total;
    rows = rows.map((row) => ({
      ...row,
      height: row.height * scale,
      width: row.width * scale,
    }));
  }
  return rows;
}

function finishRow<T extends { ratio: number }>(
  items: T[],
  ratioSum: number,
  width: number,
  gap: number,
): PackedRow<T> {
  // The height that makes these pictures, at their own proportions, exactly
  // fill the width with the gaps between them.
  const height = (width - gap * (items.length - 1)) / Math.max(0.01, ratioSum);
  return { items, height, width };
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

/**
 * The stretch of the tracked line that runs between two stops.
 *
 * The line carries no times by the time it reaches here, so the two ends are
 * found by proximity: the vertex nearest each stop, and everything between
 * them. Nothing comes back when the line does not come near both, or when what
 * is between them is a single hop — that is not a route, it is the straight
 * line again.
 */
function trackedBetween(
  routes: RouteCollection | null,
  from: [number, number],
  to: [number, number],
): [number, number][] | null {
  let best: [number, number][] | null = null;

  for (const feature of routes?.features ?? []) {
    const coords = feature.geometry.coordinates as [number, number][];
    if (coords.length < 3) continue;

    const nearest = (point: [number, number]) => {
      let index = -1;
      let distance = Infinity;
      for (const [i, vertex] of coords.entries()) {
        const km = haversineKm(vertex, point);
        if (km < distance) {
          distance = km;
          index = i;
        }
      }
      return { index, distance };
    };

    const a = nearest(from);
    const b = nearest(to);
    // Both ends have to be somewhere near the line, or this traveller did not
    // make this leg at all.
    if (a.distance > 40 || b.distance > 40) continue;
    const slice = coords.slice(Math.min(a.index, b.index), Math.max(a.index, b.index) + 1);
    if (slice.length < 3) continue;
    const ordered = a.index <= b.index ? slice : [...slice].reverse();
    if (!best || ordered.length > best.length) best = ordered;
  }

  return best;
}

/** Length of a line in kilometres, hop by hop. */
function lineKm(line: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineKm(line[i - 1]!, line[i]!);
  return total;
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

/**
 * The photographs, as the bytes they arrived in.
 *
 * A decoded page-sized picture is several megabytes; a day of a hundred and
 * forty of them held open at once is more memory than a phone will give a web
 * view. The compressed blob is a couple of hundred kilobytes, so those are
 * what is kept, and each one is decoded twice at most: once to learn its
 * shape, once to draw it.
 */
const blobs = new Map<string, Blob | null>();
const ratios = new Map<string, number>();
const pending = new Map<string, Promise<Blob | null>>();

export interface Shape {
  item: MediaItem;
  ratio: number;
}

async function getBlob(mediaId: string): Promise<Blob | null> {
  const cached = blobs.get(mediaId);
  if (cached !== undefined) return cached;
  const existing = pending.get(mediaId);
  if (existing) return existing;

  const job = (async () => {
    try {
      const url = await fetchBlobUrl(`/media/${mediaId}/thumbnail`);
      const blob = await fetch(url).then((r) => r.blob());
      blobs.set(mediaId, blob);
      return blob;
    } catch {
      blobs.set(mediaId, null);
      return null;
    } finally {
      pending.delete(mediaId);
    }
  })();
  pending.set(mediaId, job);
  return job;
}

/** A decoded picture, to be drawn once and closed. */
async function decode(mediaId: string): Promise<ImageBitmap | HTMLImageElement | null> {
  const blob = await getBlob(mediaId);
  if (!blob) return null;
  try {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
    return await decodeElement(blob);
  } catch {
    return null;
  }
}

/** What shape each of these photographs is, fetching them a few at a time. */
async function measure(photos: MediaItem[]): Promise<Shape[]> {
  const shapes: Shape[] = photos.map((item) => ({ item, ratio: ratios.get(item.id) ?? 0 }));
  const todo = shapes.filter((shape) => shape.ratio === 0);

  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(PREFETCH, queue.length) }, async () => {
      for (;;) {
        const shape = queue.shift();
        if (!shape) return;
        const image = await decode(shape.item.id);
        // Portraits are the common case for a phone; a photo that will not
        // decode is assumed to be one rather than left at zero.
        const ratio = image ? image.width / image.height : 0.75;
        if (image && 'close' in image) image.close();
        ratios.set(shape.item.id, ratio);
        shape.ratio = ratio;
      }
    }),
  );

  for (const shape of shapes) if (shape.ratio === 0) shape.ratio = ratios.get(shape.item.id) ?? 0.75;
  return shapes;
}

/** Starts the next page's photographs on their way, a few at a time. */
async function prefetch(photos: MediaItem[]): Promise<void> {
  const queue = [...photos];
  await Promise.all(
    Array.from({ length: Math.min(PREFETCH, queue.length) }, async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        await getBlob(item.id);
      }
    }),
  );
}

/** The book is finished; none of this is worth keeping. */
function forgetImages(): void {
  blobs.clear();
  ratios.clear();
}

function decodeElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = URL.createObjectURL(blob);
  });
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
