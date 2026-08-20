import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { dbAll, dbDelete, dbGet, dbPut } from './localDb';

/**
 * Map tiles kept on the device, per trip.
 *
 * The phones this runs on are de-Googled and often abroad on no data at all,
 * which is exactly where a travel map is worth having. MapLibre fetches its
 * own resources, so the only way to answer those requests from storage is to
 * own the scheme they are asked over: every URL in the style is rewritten to
 * `mmsc://<original>`, and this module answers.
 *
 * Nothing is stored while you browse. A region is written only when you ask
 * for one, so the cache never grows behind your back.
 */

const MAP_CACHE = 'mms-map-v1';
export const CACHE_SCHEME = 'mmsc';
const PREFIX = `${CACHE_SCHEME}://`;

/** Tiles are square; a region is capped so a stray whole-country bbox can't run away. */
const MAX_TILES = 6000;
/** Street level. Beyond this a city becomes thousands of tiles for one walk. */
const MAX_ZOOM = 13;

export interface RegionInfo {
  tripId: string;
  urls: string[];
  bytes: number;
  savedAt: number;
  /** The deepest zoom that actually fitted within the tile cap. */
  zoom: number;
}

export interface RegionProgress {
  done: number;
  total: number;
  bytes: number;
}

let registered = false;
/**
 * Whether anything is stored at all.
 *
 * Every tile the map draws comes through this protocol, and asking Cache
 * Storage about a tile that cannot be there costs a round trip through another
 * thread for each one. Until a region is saved, requests go straight out.
 */
let hasRegions = false;
/** One handle, opened once: `caches.open` per tile is not free either. */
let cachePromise: Promise<Cache> | null = null;

function mapCache(): Promise<Cache> {
  cachePromise ??= caches.open(MAP_CACHE);
  return cachePromise;
}

/** Installs the protocol MapLibre asks cached resources over. Idempotent. */
export function registerMapCache(): void {
  if (registered) return;
  registered = true;
  // Cheap and once: which trips have a saved region decides whether every
  // later tile request needs to look in storage at all.
  void dbAll<{ tripId?: string; urls?: string[] }>('meta')
    .then((rows) => {
      hasRegions = rows.some((row) => Array.isArray(row?.urls) && row.urls.length > 0);
    })
    .catch(() => undefined);

  maplibregl.addProtocol(CACHE_SCHEME, async (params, abortController) => {
    const target = params.url.slice(PREFIX.length);

    const cached = hasRegions ? await matchCache(target) : null;
    const response = cached ?? (await fetch(target, { signal: abortController.signal }));
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    // Style, TileJSON and the sprite index are JSON that themselves point at
    // more URLs; those have to come back through here too or the tiles of a
    // cached style would still be fetched from the network.
    if (isJson(params.type, response)) {
      const json = (await response.clone().json()) as unknown;
      return { data: rewriteJson(json) };
    }
    return { data: await response.arrayBuffer() };
  });
}

/** The style URL MapLibre should be given, so its resources come through here. */
export function cachedStyle(style: string | StyleSpecification): string | StyleSpecification {
  if (typeof style === 'string') return style.startsWith(PREFIX) ? style : `${PREFIX}${style}`;
  return rewriteJson(style) as StyleSpecification;
}

/** What is stored for one trip, if anything. */
export async function regionFor(tripId: string): Promise<RegionInfo | null> {
  return (await dbGet<RegionInfo>('meta', `map:${tripId}`)) ?? null;
}

/** Throws one trip's tiles away. Others keep theirs, shared tiles included. */
export async function clearRegion(tripId: string): Promise<void> {
  const region = await regionFor(tripId);
  if (!region) return;
  try {
    const cache = await mapCache();
    for (const url of region.urls) await cache.delete(url);
  } catch {
    /* best-effort */
  }
  await dbDelete('meta', `map:${tripId}`);
  const rows = await dbAll<{ urls?: string[] }>('meta').catch(() => []);
  hasRegions = rows.some((row) => Array.isArray(row?.urls) && row.urls.length > 0);
}

/**
 * Downloads everything the map needs for one bounding box: the style, its
 * fonts and sprite, and every tile covering the box up to street level.
 *
 * Zoom is chosen to fit the tile cap, so a trip across three countries saves a
 * coarser map rather than refusing or filling the phone.
 */
export async function saveRegion(
  tripId: string,
  bbox: [number, number, number, number],
  styleUrl: string,
  onProgress?: (progress: RegionProgress) => void,
): Promise<RegionInfo> {
  const cache = await mapCache();
  const style = (await fetchJson(styleUrl)) as StyleSpecification & {
    sprite?: string | { id: string; url: string }[];
    glyphs?: string;
  };

  // Tile templates: either listed in the style or one TileJSON hop away.
  const templates: { tiles: string[]; maxzoom: number }[] = [];
  const extras: string[] = [styleUrl];

  for (const source of Object.values(style.sources ?? {})) {
    const spec = source as { url?: string; tiles?: string[]; maxzoom?: number };
    if (spec.tiles) {
      templates.push({ tiles: spec.tiles, maxzoom: spec.maxzoom ?? MAX_ZOOM });
    } else if (spec.url) {
      const absolute = new URL(spec.url, styleUrl).toString();
      extras.push(absolute);
      const tileJson = (await fetchJson(absolute)) as { tiles?: string[]; maxzoom?: number };
      if (tileJson.tiles) {
        templates.push({ tiles: tileJson.tiles, maxzoom: tileJson.maxzoom ?? MAX_ZOOM });
      }
    }
  }

  // Fonts and icons, or an offline map draws unlabelled shapes.
  if (typeof style.sprite === 'string') extras.push(...spriteUrls(style.sprite, styleUrl));
  else if (Array.isArray(style.sprite)) {
    for (const entry of style.sprite) extras.push(...spriteUrls(entry.url, styleUrl));
  }
  if (style.glyphs) extras.push(...glyphUrls(style.glyphs, styleUrl, fontsIn(style)));

  const zoom = zoomThatFits(bbox, templates);
  const urls = new Set<string>(extras);
  for (const template of templates) {
    for (const tile of tilesFor(bbox, Math.min(zoom, template.maxzoom))) {
      for (const pattern of template.tiles) {
        urls.add(
          new URL(
            pattern
              .replace('{z}', String(tile.z))
              .replace('{x}', String(tile.x))
              .replace('{y}', String(tile.y)),
            styleUrl,
          ).toString(),
        );
      }
    }
  }

  const list = [...urls];
  let bytes = 0;
  let done = 0;

  // Six at a time: enough to saturate a hotel connection, few enough that the
  // phone stays usable while it runs.
  const queue = [...list];
  const workers = Array.from({ length: 6 }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const copy = res.clone();
          await cache.put(url, res);
          bytes += (await copy.blob()).size;
        }
      } catch {
        /* one missing tile is a hole in the map, not a failed download */
      }
      done++;
      onProgress?.({ done, total: list.length, bytes });
    }
  });
  await Promise.all(workers);

  const info: RegionInfo = { tripId, urls: list, bytes, savedAt: Date.now(), zoom };
  await dbPut<RegionInfo>('meta', info, `map:${tripId}`);
  hasRegions = true;
  return info;
}

/** How many tiles a box would take at a given zoom, for the estimate on screen. */
export function tileCount(bbox: [number, number, number, number], zoom: number): number {
  const [west, south, east, north] = bbox;
  const x0 = lngToTile(west, zoom);
  const x1 = lngToTile(east, zoom);
  const y0 = latToTile(north, zoom);
  const y1 = latToTile(south, zoom);
  return (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1);
}

/** The deepest zoom whose tile count still fits the cap. */
export function zoomThatFits(
  bbox: [number, number, number, number],
  templates: { maxzoom: number }[] = [],
): number {
  const ceiling = Math.min(MAX_ZOOM, ...templates.map((t) => t.maxzoom), MAX_ZOOM);
  for (let zoom = ceiling; zoom >= 4; zoom--) {
    let total = 0;
    for (let z = 0; z <= zoom; z++) total += tileCount(bbox, z);
    if (total <= MAX_TILES) return zoom;
  }
  return 4;
}

/* ---- internals ---------------------------------------------------------- */

async function matchCache(url: string): Promise<Response | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await mapCache();
    return (await cache.match(url)) ?? null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const cached = await matchCache(url);
  const res = cached ?? (await fetch(url));
  if (!res.ok) throw new Error(`Kon ${url} niet ophalen`);
  return res.json();
}

function isJson(type: string | undefined, response: Response): boolean {
  if (type === 'Style' || type === 'Source' || type === 'SpriteJSON') return true;
  return (response.headers.get('content-type') ?? '').includes('json');
}

/** Every absolute http(s) URL inside a style/TileJSON, pointed back at us. */
function rewriteJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return /^https?:\/\//.test(value) ? `${PREFIX}${value}` : value;
  }
  if (Array.isArray(value)) return value.map(rewriteJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rewriteJson(item);
    }
    return out;
  }
  return value;
}

function spriteUrls(base: string, styleUrl: string): string[] {
  const absolute = new URL(base, styleUrl).toString();
  return [`${absolute}.json`, `${absolute}.png`, `${absolute}@2x.json`, `${absolute}@2x.png`];
}

/** The font stacks the style actually asks for, so unused fonts aren't fetched. */
function fontsIn(style: StyleSpecification): string[] {
  const fonts = new Set<string>();
  for (const layer of style.layers ?? []) {
    const font = (layer as { layout?: { 'text-font'?: unknown } }).layout?.['text-font'];
    if (Array.isArray(font) && font.every((f) => typeof f === 'string')) {
      fonts.add((font as string[]).join(','));
    }
  }
  return [...fonts];
}

function glyphUrls(template: string, styleUrl: string, fonts: string[]): string[] {
  const urls: string[] = [];
  for (const stack of fonts) {
    // Latin, Latin-1 supplement and Latin Extended-A cover the place names on
    // any trip these phones have been on; the rest is fetched when online.
    for (const range of ['0-255', '256-511']) {
      urls.push(
        new URL(
          template.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range),
          styleUrl,
        ).toString(),
      );
    }
  }
  return urls;
}

function* tilesFor(
  bbox: [number, number, number, number],
  maxZoom: number,
): Generator<{ z: number; x: number; y: number }> {
  const [west, south, east, north] = bbox;
  for (let z = 0; z <= maxZoom; z++) {
    const x0 = Math.min(lngToTile(west, z), lngToTile(east, z));
    const x1 = Math.max(lngToTile(west, z), lngToTile(east, z));
    const y0 = Math.min(latToTile(north, z), latToTile(south, z));
    const y1 = Math.max(latToTile(north, z), latToTile(south, z));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) yield { z, x, y };
    }
  }
}

function lngToTile(lng: number, zoom: number): number {
  const n = 2 ** zoom;
  return Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
}

function latToTile(lat: number, zoom: number): number {
  const n = 2 ** zoom;
  const rad = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return Math.min(n - 1, Math.max(0, y));
}
