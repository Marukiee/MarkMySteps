import { api } from '../../api/client';
import type { MediaItem } from '../../api/types';
import { haversineKm } from '../arc';
import { flagEmoji, formatDate, formatDateRange } from '../colors';
import { reversePlaceName } from '../geocode';
import { fetchWeather, type Weather } from '../weather';
import type { Fact, PageData, Scope, SummarySource, SummarySpec } from './types';

/**
 * A trip without a colour of its own still gets a consistent one: the same hue
 * its cover gradient starts from, so the poster looks like the trip card.
 */
function accentFromId(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 62% 58%)`;
}

/** yyyy-mm-dd in the viewer's own timezone: the day you would call it. */
export function dayKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end && out.length < 400) {
    out.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Where a summary starts from when you open the maker.
 *
 * A trip that is over is a story you tell whole. One that is running is about
 * today, or about the last day you actually took photos, because "today" on a
 * travel day where the camera stayed in the bag is an empty poster.
 */
export function defaultScope(
  trip: { startDate: string; endDate: string },
  media: MediaItem[],
): Scope {
  const today = dayKey(new Date());
  const start = dayKey(trip.startDate);
  const end = dayKey(trip.endDate);
  if (today > end) return { kind: 'trip', from: start, to: end };
  if (today < start) return { kind: 'trip', from: start, to: end };
  const withPhotos = new Set(media.map((m) => dayKey(m.takenAt)));
  if (withPhotos.has(today)) return { kind: 'day', from: today, to: today };
  const last = [...withPhotos].filter((d) => d <= today).sort().pop();
  return last ? { kind: 'day', from: last, to: last } : { kind: 'day', from: today, to: today };
}

/**
 * Which layout suits this slice of trip.
 *
 * Reading the data rather than asking: a day you barely moved is about the
 * photos, a day with a long line on the map is about the line, and a whole
 * trip is about where it went.
 */
export function suggestTemplate(
  scope: Scope,
  km: number,
  photoCount: number,
  stopCount: number,
): 'route' | 'photos' | 'ribbon' | 'stats' {
  if (scope.kind === 'trip' || stopCount >= 3) {
    return photoCount >= 20 && stopCount < 3 ? 'stats' : 'ribbon';
  }
  if (km < 2) return 'photos';
  if (km >= 8) return 'route';
  return photoCount >= 4 ? 'photos' : 'route';
}

/** Metres of line, in kilometres, for a set of polylines. */
export function lineKm(lines: [number, number][][]): number {
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) total += haversineKm(line[i - 1]!, line[i]!);
  }
  return total;
}

/**
 * The track for one day, from the point log.
 *
 * The trip's route endpoint hands back one line per traveller with no times on
 * it, so it cannot be cut into days; the day endpoint can. A day with no
 * tracked points simply has no line, and the layouts fall back to the photos.
 */
const dayCache = new Map<string, [number, number][]>();

async function dayLine(tripId: string, day: string): Promise<[number, number][]> {
  const key = `${tripId}:${day}`;
  const cached = dayCache.get(key);
  if (cached) return cached;
  try {
    const points = await api<{ latitude: number; longitude: number }[]>(
      `/trips/${tripId}/points/day?day=${day}`,
    );
    const line = points.map((p) => [p.longitude, p.latitude] as [number, number]);
    // Kept for the session: the maker redraws on every toggle, and asking the
    // server for the same day a dozen times is the slow way to the same line.
    dayCache.set(key, line);
    return line;
  } catch {
    return [];
  }
}

/**
 * The track for a period: the trip's own route when it is the whole trip,
 * otherwise the tracked days stitched together.
 */
export async function scopeLines(
  source: SummarySource,
  scope: Scope,
): Promise<[number, number][][]> {
  if (scope.kind === 'trip') return tripLines(source);
  const perDay = await Promise.all(
    daysBetween(scope.from, scope.to).map((d) => dayLine(source.trip.id, d)),
  );
  return perDay.filter((line) => line.length > 1);
}

function tripLines(source: SummarySource): [number, number][][] {
  const fromRoutes = (source.routes?.features ?? [])
    .map((f) => f.geometry.coordinates)
    .filter((c) => c.length > 1);
  if (fromRoutes.length > 0) return fromRoutes;
  // No tracked route: the planned journey is the shape of the trip.
  const journey = (source.trip.journey ?? []).map((leg) => leg.points).filter((p) => p.length > 1);
  if (journey.length > 0) return journey;
  const stops = source.stops
    .filter((s) => s.latitude !== null && s.longitude !== null && !s.parentStopId)
    .map((s) => [s.longitude!, s.latitude!] as [number, number]);
  return stops.length > 1 ? [stops] : [];
}

/** Middle of everything on this page, for the weather and the place name. */
function centroid(lines: [number, number][][], photos: MediaItem[]): [number, number] | null {
  const points: [number, number][] = [];
  for (const line of lines) points.push(...line);
  for (const p of photos) {
    if (p.latitude !== null && p.longitude !== null) points.push([p.longitude, p.latitude]);
  }
  if (points.length === 0) return null;
  const lng = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return [lng, lat];
}

/**
 * Which photos go on the poster, when you have not picked them yourself.
 *
 * Spread over the period rather than the best-looking ones, because a poster
 * made of five frames from the same quarter of an hour is not a day. Videos
 * are skipped: a still frame from one is not something this can render.
 */
function pickPhotos(media: MediaItem[], count: number): string[] {
  const usable = media
    .filter((m) => m.assetType === 'IMAGE')
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  if (usable.length <= count) return usable.map((m) => m.id);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    // Sample from the middle of each of `count` equal slices of the period.
    const at = Math.floor(((i + 0.5) * usable.length) / count);
    out.push(usable[Math.min(at, usable.length - 1)]!.id);
  }
  return out;
}

/** How many photos a layout has room for. */
export function photoSlots(template: string): number {
  if (template === 'photos') return 6;
  if (template === 'route') return 3;
  if (template === 'ribbon') return 4;
  return 1;
}

/**
 * The places you actually stayed, in travel order.
 *
 * A planner also holds the getting-there: a stop called "Heenreis" with no
 * nights in it, which is a day of driving and not somewhere you went. Anything
 * on the route you did not sleep at is left out; a day trip keeps its place,
 * because that IS somewhere you went, from the stop it hangs off.
 */
function stopsIn(source: SummarySource, from: string, to: string) {
  return source.stops
    .filter((s) => s.latitude !== null && s.longitude !== null)
    .filter((s) => s.parentStopId || s.nights > 0)
    .filter((s) => {
      const arrival = dayKey(s.arrivalDate);
      const departure = dayKey(s.departureDate);
      return arrival <= to && departure >= from;
    })
    .map((s) => ({
      name: s.name,
      lng: s.longitude!,
      lat: s.latitude!,
      countryCode: s.countryCode,
    }));
}

/** "SE" → "Zweden". Falls back to the code itself for anything unknown. */
const REGION_NAMES = (() => {
  try {
    return new Intl.DisplayNames(['nl'], { type: 'region' });
  } catch {
    return null;
  }
})();

function countryName(code: string): string {
  try {
    return REGION_NAMES?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The line under the trip's name, per the spec's subtitle setting. */
async function subtitleFor(
  spec: SummarySpec,
  scope: Scope,
  stops: { name: string; countryCode: string | null }[],
  countries: string[],
  middle: [number, number] | null,
): Promise<string | null> {
  const typed = spec.subtitleText.trim();
  if (typed) return typed;
  const mode =
    spec.subtitle !== 'auto'
      ? spec.subtitle
      : // A whole trip visits too many places to name one of them, so it says
        // which countries it was in. A day or a stretch of days happened
        // somewhere in particular, and that is worth naming.
        scope.kind === 'trip' && stops.length > 1 && countries.length > 0
        ? 'countries'
        : 'place';
  if (mode === 'none') return null;
  if (mode === 'countries') {
    return countries.length > 0 ? countries.map(countryName).join(' · ') : null;
  }
  if (mode === 'stops') {
    if (stops.length === 0) return null;
    const names = stops.map((s) => s.name);
    return names.length > 4 ? `${names.slice(0, 3).join(' · ')} · +${names.length - 3}` : names.join(' · ');
  }
  if (stops.length === 1) return stops[0]!.name;
  if (!middle) return null;
  return reversePlaceName(middle[1], middle[0]).catch(() => null);
}

export function scopeLabel(scope: Scope): string {
  if (scope.kind === 'trip') return 'Hele reis';
  if (scope.kind === 'day') return formatDate(scope.from);
  return formatDateRange(scope.from, scope.to);
}

/**
 * Turns a spec into the pages that will be drawn.
 *
 * One page for a single poster. For a series: a cover with the whole route,
 * then one page per day that has anything to show, then the numbers. Days
 * where nothing happened are left out rather than posted empty.
 */
export async function buildPages(source: SummarySource, spec: SummarySpec): Promise<PageData[]> {
  const { trip } = source;
  const accent = trip.color ?? accentFromId(trip.id);
  const all = tripLines(source);

  const periods: { scope: Scope; label: string | null }[] = [];
  if (spec.series) {
    const days = daysBetween(spec.scope.from, spec.scope.to);
    const withSomething = days.filter((d) =>
      source.media.some((m) => dayKey(m.takenAt) === d && m.assetType === 'IMAGE'),
    );
    // Ten pages is already a long swipe; beyond that the emptiest days go.
    const chosen = withSomething.slice(0, 10);
    periods.push({ scope: spec.scope, label: null });
    for (const day of chosen) periods.push({ scope: { kind: 'day', from: day, to: day }, label: null });
    periods.push({ scope: spec.scope, label: null });
  } else {
    periods.push({ scope: spec.scope, label: null });
  }

  const pages: PageData[] = [];
  for (let i = 0; i < periods.length; i++) {
    const scope = periods[i]!.scope;
    const isCover = spec.series && i === 0;
    const isEnd = spec.series && i === periods.length - 1;
    const photosIn = source.media.filter((m) => {
      const day = dayKey(m.takenAt);
      return day >= scope.from && day <= scope.to;
    });

    const lines = isCover || isEnd ? all : await scopeLines(source, scope);

    const km = Math.round(lineKm(lines));
    const stops = stopsIn(source, scope.from, scope.to);
    const middle = centroid(lines, photosIn);

    // Weather belongs to a day and to the place you were that day, not to the
    // trip's home stop. Over a longer period it says nothing, so it is left off.
    let weather: Weather | null = null;
    if (spec.showWeather && middle && scope.kind === 'day' && !isCover && !isEnd) {
      weather = await fetchWeather(middle[1], middle[0], scope.from);
    }

    const slots = photoSlots(isEnd ? 'stats' : isCover ? 'ribbon' : spec.template);
    const chosenPhotos =
      spec.photoIds.length > 0 && !spec.series
        ? spec.photoIds.slice(0, slots)
        : pickPhotos(photosIn, slots);

    const countries = [...new Set(stops.map((s) => s.countryCode).filter(Boolean))] as string[];
    const days = daysBetween(scope.from, scope.to).length;
    const place = await subtitleFor(spec, scope, stops, countries, middle);

    const facts: Fact[] = [];
    if (km > 0) facts.push({ value: km.toLocaleString('nl-NL'), label: 'km' });
    if (days > 1) facts.push({ value: String(days), label: 'dagen' });
    if (stops.length > 1) facts.push({ value: String(stops.length), label: 'stops' });
    if (photosIn.length > 0) facts.push({ value: String(photosIn.length), label: "foto's" });
    if (countries.length > 1) facts.push({ value: String(countries.length), label: 'landen' });

    pages.push({
      title: trip.title,
      dateLabel: scope.from === scope.to ? formatDate(scope.from) : formatDateRange(scope.from, scope.to),
      place,
      weather,
      lines,
      allLines: all,
      stops,
      photos: chosenPhotos,
      facts: facts.slice(0, 4),
      flags: countries.map(flagEmoji).filter(Boolean),
      accent,
      pageLabel: spec.series && !isCover && !isEnd ? `${i} van ${periods.length - 2}` : null,
    });
  }
  return pages;
}

/** Which template draws page `i` of a series. */
export function templateForPage(spec: SummarySpec, index: number, total: number): string {
  if (!spec.series) return spec.template;
  if (index === 0) return 'ribbon';
  if (index === total - 1) return 'stats';
  return spec.template === 'ribbon' ? 'photos' : spec.template;
}
