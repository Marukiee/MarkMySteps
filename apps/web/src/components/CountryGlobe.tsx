import { geoOrthographic, geoPath, GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useMemo, useRef } from 'react';
import * as topojson from 'topojson-client';
// Countries at the same ~110m resolution as the home globe's land outline.
import countries110m from 'world-atlas/countries-110m.json';
import { COUNTRY_ID } from '../lib/countryShapes';
import './countryglobe.css';

type Topology = Parameters<typeof topojson.feature>[0] & {
  objects: { countries: Parameters<typeof topojson.feature>[1] };
};

interface Feature {
  id?: string | number;
  type: string;
  geometry: unknown;
  properties: unknown;
}

const topo = countries110m as unknown as Topology;
const ALL = (topojson.feature(topo, topo.objects.countries) as unknown as { features: Feature[] })
  .features;

/**
 * A country's colour, from its own code.
 *
 * Deliberately spread across the whole wheel rather than tinted from one
 * accent: a wall of the same orange says "visited" no better than a grey fill
 * would, and the point of this globe is that it looks like a collection.
 */
function hueFor(code: string): string {
  let hash = 0;
  for (const char of code) hash = (hash * 131 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  // Skips the muddy 55-85° band, where a fill reads as unpainted land.
  const safe = hue > 55 && hue < 85 ? hue + 40 : hue;
  return `hsl(${safe} ${58 + (hash % 3) * 8}% ${52 + (hash % 4) * 4}%)`;
}

/** Longitude/latitude to open on: the middle of what there is to see. */
function centreOf(codes: string[], features: Feature[]): [number, number] {
  if (codes.length === 0) return [10, 30];
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const f of features) {
    const [lon, lat] = geoPath().centroid(f as unknown as GeoPermissibleObjects) as [number, number];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    // Averaged as unit vectors, so a country either side of the date line does
    // not pull the camera to the middle of the Pacific.
    const λ = (lon * Math.PI) / 180;
    const φ = (lat * Math.PI) / 180;
    x += Math.cos(φ) * Math.cos(λ);
    y += Math.cos(φ) * Math.sin(λ);
    z += Math.sin(φ);
    n += 1;
  }
  if (!n) return [10, 30];
  return [
    (Math.atan2(y / n, x / n) * 180) / Math.PI,
    (Math.asin(Math.max(-1, Math.min(1, z / n))) * 180) / Math.PI,
  ];
}

/**
 * The countries you have been to, filled in on a slowly turning globe.
 *
 * A row of flag emoji says the same thing, but it says it as a list. This says
 * it as a map: where you have been, and how much of the world that is.
 */
export function CountryGlobe({ countries, size = 200 }: { countries: string[]; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visited = useMemo(() => {
    const ids = new Map<string, string>();
    for (const code of countries) {
      const id = COUNTRY_ID[code.toUpperCase()];
      if (id) ids.set(id, code.toUpperCase());
    }
    return ids;
  }, [countries]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const mine = ALL.filter((f) => visited.has(String(f.id)));
    const [startLon, startLat] = centreOf([...visited.values()], mine);
    // Turning is the whole idea, but not for someone who asked for less of it.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const projection = geoOrthographic()
      .clipAngle(90)
      .fitExtent(
        [
          [4, 4],
          [size - 4, size - 4],
        ],
        { type: 'Sphere' },
      );
    const path = geoPath(projection, ctx);

    // Held on the same side of the globe as the countries themselves, so the
    // first frame already shows something rather than an empty ocean.
    let rotation = -startLon;
    let raf = 0;
    let last = performance.now();

    const styles = getComputedStyle(canvas);
    const water = styles.getPropertyValue('--cg-water').trim() || '#e8edf2';
    const landColor = styles.getPropertyValue('--cg-land').trim() || '#d3dae1';
    const edge = styles.getPropertyValue('--cg-edge').trim() || '#ffffff';

    function draw(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!still) rotation -= dt * 7;
      projection.rotate([rotation, -startLat * 0.55, 0]);

      ctx!.clearRect(0, 0, size, size);

      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.fillStyle = water;
      ctx!.fill();

      for (const feature of ALL) {
        const code = visited.get(String(feature.id));
        ctx!.beginPath();
        path(feature as unknown as GeoPermissibleObjects);
        ctx!.fillStyle = code ? hueFor(code) : landColor;
        ctx!.fill();
        ctx!.lineWidth = 0.4;
        ctx!.strokeStyle = edge;
        ctx!.stroke();
      }

      // Thin rim, so the sphere ends somewhere instead of dissolving.
      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.lineWidth = 1;
      ctx!.strokeStyle = edge;
      ctx!.stroke();

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [visited, size]);

  return (
    <canvas
      ref={canvasRef}
      className="country-globe"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Globe met ${countries.length} bezochte landen`}
    />
  );
}
