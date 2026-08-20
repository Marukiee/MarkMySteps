import type { MediaItem, RouteCollection, Trip } from '../api/types';
import type { PlannedStop } from './arc';
import { buildPdf, type PdfPage } from './pdf';
import {
  DARK,
  LIGHT,
  chip,
  drawCover,
  drawLayout,
  drawMap,
  drawRoute,
  drawStopDot,
  drawWrapped,
  layoutText,
  loadPhoto,
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

/** A4 at 150 dpi. Print-ready without being a file nobody can email. */
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 90;
/** Photographs per day page; more than this and each one is a stamp. */
const PER_PAGE = 6;

/**
 * The whole trip as a book: a cover, its map, then a spread per day.
 *
 * The posters answer "one picture of this trip"; this answers "the trip, all
 * of it, on paper". Same drawing kit, same fonts, same route - so a printed
 * book and a shared poster are recognisably the same trip.
 */
export async function renderPhotoBook(
  source: BookSource,
  theme: 'light' | 'dark' = 'light',
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  await readyFonts();
  const palette = theme === 'dark' ? DARK : LIGHT;
  const accent =
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8613c';

  const byDay = groupByDay(source.media);
  const days = [...byDay.keys()].sort();
  const noteFor = new Map(source.notes.map((n) => [n.day.slice(0, 10), n.body]));

  // A day with many photos runs onto a second and third page rather than
  // shrinking twenty pictures into one grid.
  const dayPages: { day: string; photos: MediaItem[]; part: number; parts: number }[] = [];
  for (const day of days) {
    const photos = byDay.get(day)!;
    const parts = Math.max(1, Math.ceil(photos.length / PER_PAGE));
    for (let part = 0; part < parts; part++) {
      dayPages.push({
        day,
        photos: photos.slice(part * PER_PAGE, (part + 1) * PER_PAGE),
        part,
        parts,
      });
    }
  }

  const total = dayPages.length + 2;
  const pages: PdfPage[] = [];
  let done = 0;

  const finish = async (canvas: HTMLCanvasElement) => {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) throw new Error('Renderen mislukt');
    pages.push({ jpeg: await blob.arrayBuffer(), width: canvas.width, height: canvas.height });
    onProgress?.(++done, total);
  };

  await finish(await renderCover(source, palette, accent));
  await finish(await renderMapPage(source, palette, accent));
  for (const page of dayPages) {
    await finish(
      await renderDayPage(source, page, noteFor.get(page.day) ?? null, palette, accent),
    );
  }

  return buildPdf(pages, source.trip.title);
}

/* ---- pages -------------------------------------------------------------- */

function newPage(palette: Palette): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Deze browser kan geen afbeeldingen tekenen');
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  return { canvas, ctx };
}

async function renderCover(
  source: BookSource,
  palette: Palette,
  accent: string,
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = newPage(palette);
  const coverId = source.trip.resolvedCoverId ?? source.media[0]?.id ?? null;
  const photo = coverId ? await loadPhoto(coverId) : null;

  const box = { x: 0, y: 0, w: PAGE_W, h: PAGE_H };
  if (photo) {
    drawCover(ctx, photo, box);
    scrim(ctx, box, 'rgba(10, 13, 17, 0.15)', 'rgba(10, 13, 17, 0.92)');
  } else {
    ctx.fillStyle = palette.panel;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  }

  const ink = photo ? '#ffffff' : palette.ink;
  const title = layoutText(ctx, source.trip.title, PAGE_W - MARGIN * 2, {
    size: 112,
    weight: 700,
    family: FONT_DISPLAY,
    lines: 3,
    color: ink,
  });
  const bottom = drawLayout(ctx, title, MARGIN, PAGE_H - MARGIN - title.height - 90);

  setFont(ctx, 34, 600, FONT_BODY);
  ctx.fillStyle = photo ? 'rgba(255,255,255,0.82)' : palette.inkSoft;
  ctx.textBaseline = 'top';
  ctx.fillText(dateRange(source.trip.startDate, source.trip.endDate), MARGIN, bottom + 26);

  // A hairline in the trip's accent, so the cover belongs to this trip and not
  // to the template it came from.
  ctx.fillStyle = accent;
  ctx.fillRect(MARGIN, PAGE_H - MARGIN - 6, 180, 6);
  return canvas;
}

async function renderMapPage(
  source: BookSource,
  palette: Palette,
  accent: string,
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = newPage(palette);
  const lines = (source.routes?.features ?? []).map(
    (f) => f.geometry.coordinates as [number, number][],
  );
  const stops = source.stops.filter(
    (s): s is PlannedStop & { latitude: number; longitude: number } =>
      s.latitude !== null && s.longitude !== null && !s.parentStopId,
  );
  const focus: [number, number][] = [
    ...lines.flat(),
    ...stops.map((s) => [s.longitude, s.latitude] as [number, number]),
  ];

  drawWrapped(ctx, 'De route', MARGIN, MARGIN, PAGE_W - MARGIN * 2, {
    size: 64,
    weight: 700,
    family: FONT_DISPLAY,
    color: palette.ink,
    lines: 1,
  });

  const mapBox = { x: MARGIN, y: MARGIN + 120, w: PAGE_W - MARGIN * 2, h: 900 };
  const map = drawMap(ctx, mapBox, focus, { accent, palette, radius: 28 });
  drawRoute(ctx, map, lines, mapBox, { color: accent, width: 7, radius: 28 });
  for (const stop of stops) {
    const xy = map.project([stop.longitude, stop.latitude]);
    if (xy) drawStopDot(ctx, xy[0], xy[1], accent, palette.paper, false, 0.8);
  }

  // The itinerary in words underneath, which is what somebody reads when the
  // map has told them the shape of it.
  let y = mapBox.y + mapBox.h + 60;
  setFont(ctx, 30, 600, FONT_BODY);
  ctx.textBaseline = 'top';
  for (const [index, stop] of stops.entries()) {
    if (y > PAGE_H - MARGIN - 40) break;
    ctx.fillStyle = palette.inkFaint;
    ctx.fillText(String(index + 1).padStart(2, '0'), MARGIN, y);
    ctx.fillStyle = palette.ink;
    ctx.fillText(stop.name, MARGIN + 70, y);
    ctx.fillStyle = palette.inkSoft;
    const nights = `${stop.nights} ${stop.nights === 1 ? 'nacht' : 'nachten'}`;
    ctx.fillText(nights, PAGE_W - MARGIN - ctx.measureText(nights).width, y);
    y += 48;
  }
  return canvas;
}

async function renderDayPage(
  source: BookSource,
  page: { day: string; photos: MediaItem[]; part: number; parts: number },
  note: string | null,
  palette: Palette,
  accent: string,
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = newPage(palette);

  const heading = new Date(`${page.day}T12:00:00Z`).toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const bottom = drawWrapped(ctx, capitalise(heading), MARGIN, MARGIN, PAGE_W - MARGIN * 2, {
    size: 58,
    weight: 700,
    family: FONT_DISPLAY,
    color: palette.ink,
    lines: 2,
  });

  // Which stop this day belongs to, so a page says where it happened.
  const place = stopOn(source, page.day);
  let y = bottom + 16;
  if (place || page.parts > 1) {
    setFont(ctx, 28, 600, FONT_BODY);
    ctx.fillStyle = palette.inkSoft;
    ctx.textBaseline = 'top';
    const label = [place, page.parts > 1 ? `${page.part + 1} van ${page.parts}` : null]
      .filter(Boolean)
      .join('  ·  ');
    ctx.fillText(label, MARGIN, y);
    y += 52;
  }

  if (note && page.part === 0) {
    y =
      drawWrapped(ctx, note, MARGIN, y + 10, PAGE_W - MARGIN * 2, {
        size: 30,
        weight: 400,
        family: FONT_BODY,
        color: palette.ink,
        lines: 6,
        lineHeight: 1.45,
      }) + 30;
  }

  // Two columns of photographs, filling whatever is left of the page.
  const gap = 26;
  const columns = 2;
  const cellW = (PAGE_W - MARGIN * 2 - gap * (columns - 1)) / columns;
  const rows = Math.ceil(page.photos.length / columns);
  const available = PAGE_H - MARGIN - y;
  const cellH = Math.min(cellW * 1.15, (available - gap * (rows - 1)) / Math.max(1, rows));

  for (const [index, item] of page.photos.entries()) {
    const box = {
      x: MARGIN + (index % columns) * (cellW + gap),
      y: y + Math.floor(index / columns) * (cellH + gap),
      w: cellW,
      h: cellH,
    };
    panel(ctx, box, 18, palette.panel);
    const photo = await loadPhoto(item.id);
    if (photo) drawCover(ctx, photo, box, 18);
    else {
      ctx.save();
      roundRect(ctx, box, 18);
      ctx.clip();
      ctx.fillStyle = palette.inkFaint;
      setFont(ctx, 24, 600, FONT_BODY);
      ctx.fillText('foto niet geladen', box.x + 20, box.y + box.h / 2);
      ctx.restore();
    }
  }

  // Page furniture: the trip's name, small, in its accent.
  chip(ctx, source.trip.title, MARGIN, PAGE_H - MARGIN + 8, {
    size: 20,
    color: accent,
    border: palette.inkFaint,
  });
  return canvas;
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

/** The stop whose stay covers this day, by walking the planned nights. */
function stopOn(source: BookSource, day: string): string | null {
  for (const stop of source.stops) {
    if (stop.parentStopId) continue;
    if (stop.arrivalDate <= day && day <= stop.departureDate) return stop.name;
  }
  return null;
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
