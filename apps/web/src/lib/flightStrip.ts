import { geoDistance, geoInterpolate, geoMercator, geoPath, geoRotation, GeoPermissibleObjects } from 'd3-geo';
import * as topojson from 'topojson-client';
import land110m from 'world-atlas/land-110m.json';

/**
 * The earth under one flight, the way an old aviation strip map has it: turned
 * so the route runs left to right along the ticket, with the real coastlines
 * passing underneath.
 *
 * Drawn once onto a canvas instead of as an SVG path. One flight's coastline is
 * tens of kilobytes of path, and a list of those would be redrawn while it
 * scrolls; a canvas is a picture by then.
 *
 * Most flights are drawn from the coarse map, whose detail is about a pixel at
 * this scale and which projects twenty times faster. Only a flight short enough
 * to show the difference asks for the fine one, half a megabyte loaded on its
 * own the first time it is needed.
 */

type LandTopology = Parameters<typeof topojson.feature>[0] & {
  objects: { land: Parameters<typeof topojson.feature>[1] };
};

type Lonlat = [number, number];

interface Polygon {
  shape: GeoPermissibleObjects;
  centre: Lonlat;
  /** Radians from the centre to the furthest corner of the polygon. */
  radius: number;
}

/** A polygon with the smallest circle we cheaply can around it, so the ones
 *  nowhere near a flight are skipped before they are projected point by point. */
function withBounds(coordinates: Lonlat[][]): Polygon {
  let x = 0;
  let y = 0;
  let z = 0;
  const ring = coordinates[0]!;
  for (const [lon, lat] of ring) {
    const l = (lon * Math.PI) / 180;
    const p = (lat * Math.PI) / 180;
    x += Math.cos(p) * Math.cos(l);
    y += Math.cos(p) * Math.sin(l);
    z += Math.sin(p);
  }
  const centre: Lonlat = [
    (Math.atan2(y, x) * 180) / Math.PI,
    (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
  ];
  let radius = 0;
  for (const point of ring) radius = Math.max(radius, geoDistance(centre, point));
  return { shape: { type: 'Polygon', coordinates }, centre, radius };
}

function polygonsOf(data: unknown): Polygon[] {
  const topo = data as LandTopology;
  const land = topojson.feature(topo, topo.objects.land) as unknown as {
    features?: { geometry: { type: string; coordinates: unknown } }[];
    geometry?: { type: string; coordinates: unknown };
  };
  const geometries = land.features?.map((f) => f.geometry) ?? (land.geometry ? [land.geometry] : []);
  const out: Polygon[] = [];
  for (const geometry of geometries) {
    if (geometry.type === 'Polygon') out.push(withBounds(geometry.coordinates as Lonlat[][]));
    if (geometry.type === 'MultiPolygon') {
      for (const part of geometry.coordinates as Lonlat[][][]) out.push(withBounds(part));
    }
  }
  return out;
}

const COARSE = polygonsOf(land110m);
let fine: Promise<Polygon[]> | null = null;

/** Earth radians per pixel above which the coarse map loses nothing you can see. */
const COARSE_ABOVE = 10 / 6371;

function polygonsFor(radiansPerPixel: number): Promise<Polygon[]> | Polygon[] {
  if (radiansPerPixel >= COARSE_ABOVE) return COARSE;
  fine ??= import('world-atlas/land-50m.json').then((m) => polygonsOf(m.default));
  return fine;
}

/** Below this the two ends are one place: nothing to draw a route over. */
const MIN_SPAN = 0.008;

export interface StripGeometry {
  /** Where the two ends of the route are on the canvas, in CSS pixels. */
  x0: number;
  x1: number;
  y: number;
  width: number;
  height: number;
  /** Device pixels per CSS pixel. */
  scale: number;
}

/** Paints the land in `color`. How strongly it shows is up to the stylesheet,
 *  so the picture is the same one in light and dark. */
export async function drawFlightStrip(
  canvas: HTMLCanvasElement,
  from: Lonlat,
  to: Lonlat,
  { x0, x1, y, width, height, scale }: StripGeometry,
  color: string,
): Promise<boolean> {
  const span = geoDistance(from, to);
  if (!(span > MIN_SPAN) || x1 <= x0) return false;
  const polygons = await polygonsFor(span / (x1 - x0));

  const mid = geoInterpolate(from, to)(0.5);
  const heading = geoRotation([-mid[0], -mid[1]])(to);
  const gamma = (-Math.atan2(heading[1], heading[0]) * 180) / Math.PI;
  const k = (x1 - x0) / span;
  const projection = geoMercator()
    .rotate([-mid[0], -mid[1], gamma])
    .scale(k)
    .translate([(x0 + x1) / 2, y])
    .clipExtent([
      [0, 0],
      [width, height],
    ])
    .precision(0.5);

  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.scale(scale, scale);
  ctx.fillStyle = color;

  const reach = Math.hypot(width, height) / k;
  const path = geoPath(projection, ctx);
  ctx.beginPath();
  for (const polygon of polygons) {
    if (geoDistance(mid as Lonlat, polygon.centre) > polygon.radius + reach) continue;
    path(polygon.shape);
  }
  ctx.fill();
  return true;
}
