import { geoOrthographic, geoPath, GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useMemo, useRef } from 'react';
import * as topojson from 'topojson-client';
// Countries at the same ~110m resolution as the home globe's land outline.
import countries110m from 'world-atlas/countries-110m.json';
import { COUNTRY_COLOR } from '../lib/countryColors';
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

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

/**
 * A country's colour, from its own flag.
 *
 * The hue comes from the flag file (see lib/countryColors.ts); saturation and
 * lightness do not, because a flag is printed on white and this is painted on
 * a globe that is sometimes dark. Both are clamped into a band that reads on
 * either theme, with a small per-country jitter so the many countries whose
 * flags are the same red still come apart where they share a border.
 */
export function hueFor(code: string, dark = false): string {
  let hash = 0;
  for (const char of code) hash = (hash * 131 + char.charCodeAt(0)) >>> 0;

  const flag = COUNTRY_COLOR[code.toUpperCase()];
  const [h, s, l] = flag ? hexToHsl(flag) : [hash % 360, 60, 52];

  const hue = (h + ((hash % 9) - 4)) % 360;
  const sat = Math.max(38, Math.min(dark ? 62 : 72, s));
  const base = dark ? 52 : 50;
  const light = Math.max(dark ? 42 : 40, Math.min(dark ? 62 : 62, base + (l - 50) * 0.35));
  return `hsl(${hue} ${sat}% ${light + ((hash % 5) - 2)}%)`;
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

    const dark = document.documentElement.dataset.theme === 'dark';
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
        ctx!.fillStyle = code ? hueFor(code, dark) : landColor;
        ctx!.fill();
        ctx!.lineWidth = 0.4;
        ctx!.strokeStyle = edge;
        ctx!.stroke();
      }

      // Light from the upper left, shadow curving away at the lower right. A
      // flat disc of colours read as a map cut into a circle; this is what
      // makes it a ball. Clipped to the sphere so nothing spills past its edge.
      ctx!.save();
      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.clip();
      const r = size / 2;
      const shade = ctx!.createRadialGradient(
        r - r * 0.42,
        r - r * 0.46,
        r * 0.12,
        r,
        r,
        r * 1.22,
      );
      shade.addColorStop(0, dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.34)');
      shade.addColorStop(0.55, 'rgba(255,255,255,0)');
      shade.addColorStop(1, dark ? 'rgba(0,0,0,0.42)' : 'rgba(24,32,42,0.26)');
      ctx!.fillStyle = shade;
      ctx!.fillRect(0, 0, size, size);
      ctx!.restore();

      // Thin rim, so the sphere ends somewhere instead of dissolving.
      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.lineWidth = 1;
      ctx!.strokeStyle = edge;
      ctx!.stroke();

      raf = requestAnimationFrame(draw);
    }

    /**
     * Only turns while it is being looked at. Same redraw-everything cost as
     * the big globe, on a canvas that sits well down a stats page and keeps
     * spinning after the app is put away. Stopping and starting is invisible:
     * the rotation resumes from the angle it held.
     */
    let onScreen = true;
    let awake = document.visibilityState !== 'hidden';
    const sync = () => {
      if (onScreen && awake) {
        if (!raf) raf = requestAnimationFrame(draw);
      } else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const onVisibility = () => {
      awake = document.visibilityState !== 'hidden';
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        sync();
      },
      { rootMargin: '120px' },
    );
    io.observe(canvas);
    sync();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
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
