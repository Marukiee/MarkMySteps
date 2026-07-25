import { geoOrthographic, geoPath, GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as topojson from 'topojson-client';
// Low-res land outline bundled locally (no CDN); ~110m resolution.
import land110m from 'world-atlas/land-110m.json';
import type { Trip } from '../api/types';
import './globe.css';

// Minimal shape of the TopoJSON we consume (avoids a types-only dep).
type LandTopology = Parameters<typeof topojson.feature>[0] & {
  objects: { land: Parameters<typeof topojson.feature>[1] };
};

interface GlobeTrip {
  id: string;
  title: string;
  anchor: [number, number];
  path: [number, number][][] | null;
  flights: [number, number][][] | null;
  upcoming: boolean;
  /** Resolved RGB colour (custom trip colour, else auto-assigned distinct). */
  color: [number, number, number];
  /** Relative importance (km, else days) — drives label priority. */
  size: number;
}

/**
 * Rotating 3D globe behind the trips overview. Orthographic projection on a
 * canvas — a genuine sphere. Each trip draws its route (dashed if it hasn't
 * happened yet) plus a glowing marker; the globe auto-rotates back whenever it
 * would drift to an empty hemisphere so a trip is always in view.
 */
export function GlobeBackdrop({ trips, noTour }: { trips: Trip[]; noTour?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const tripsRef = useRef(trips);
  tripsRef.current = trips;
  const noTourRef = useRef(noTour);
  noTourRef.current = noTour;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const topo = land110m as unknown as LandTopology;
    const land = topojson.feature(topo, topo.objects.land) as unknown as GeoPermissibleObjects;

    let raf = 0;
    let rotation = -14; // start centred on Europe (positive lon)
    const velocity = 0.02; // gentle idle sweep speed
    let sweepDir = 1; // +1 / -1 — flips at the edges of the trip spread
    let dragging = false;
    let scale = 1; // current zoom (1 = whole globe)
    let targetScale = 1;
    let tilt = 0; // extra vertical look-around, degrees
    let lastInteract = 0;
    let moved = 0; // drag distance, to tell a pan from a tap
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const today = new Date().toISOString().slice(0, 10);

    const dayCount = (t: Trip) =>
      Math.max(
        1,
        Math.round(
          (new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / 86_400_000,
        ),
      );

    const globeTrips = (): GlobeTrip[] => {
      const list = tripsRef.current
        .filter((t): t is Trip & { anchor: [number, number] } => t.anchor !== null)
        .map((t) => ({
          id: t.id,
          title: t.title,
          anchor: t.anchor,
          path: t.routePath && t.routePath.length > 0 ? t.routePath : null,
          flights: t.flightPath && t.flightPath.length > 0 ? t.flightPath : null,
          // Only trips that haven't started yet are dashed; ongoing trips are solid.
          upcoming: t.startDate.slice(0, 10) > today,
          color: [90, 110, 225] as [number, number, number],
          size: t.distanceKm && t.distanceKm > 0 ? t.distanceKm : dayCount(t) * 40,
        }));
      // Assign a distinct colour per trip: a custom trip colour wins, otherwise
      // spread hues by the golden angle over a stable (id-sorted) index so every
      // trip differs — no hash collisions.
      const idOrder = [...list].sort((a, b) => a.id.localeCompare(b.id));
      const colorIdx = new Map(idOrder.map((t, i) => [t.id, i]));
      const custom = new Map(tripsRef.current.map((t) => [t.id, t.color ?? null]));
      for (const t of list) {
        const c = custom.get(t.id);
        t.color = c ? hexToRgb(c) : autoColor(colorIdx.get(t.id) ?? 0);
      }
      // Biggest trips first — they get labelled first / at the lowest zoom.
      return list.sort((a, b) => b.size - a.size);
    };

    // Per-trip label opacity, eased across frames for a soft pop-in.
    const labelOpacity = new Map<string, number>();
    // Auto-tour state: alternate a wide overview with a zoom into the busiest
    // region, so trips are shown big first, then explored up close.
    let tourPhase = 0; // 0 = overview, 1 = focus
    let phaseStart = performance.now();
    let tourIdx = 0; // which trip is being framed during a focus phase
    // Screen rects of the drawn labels, so tapping a name opens its trip.
    let labelRects: { id: string; x: number; y: number; w: number; h: number }[] = [];

    function size() {
      const parent = canvas!.parentElement!;
      const s = Math.min(parent.clientWidth, Math.max(parent.clientHeight * 1.4, 320), 900);
      canvas!.width = s * dpr;
      canvas!.height = s * dpr;
      canvas!.style.width = `${s}px`;
      canvas!.style.height = `${s}px`;
    }
    size();

    const projection = geoOrthographic().clipAngle(90);
    const path = geoPath(projection, ctx);
    const CENTER_LAT = 32; // lift the framing to Europe so Africa isn't dominant

    function draw() {
      const w = canvas!.width;
      const h = canvas!.height;
      const trips = globeTrips();

      const now = performance.now();
      const idle = !dragging && now - lastInteract > 1400;

      // --- Auto-tour (idle only) ---
      // Phase 0: wide overview, pendulum-sweep across all trips.
      // Phase 1: ease in on the busiest region (centroid of the trips) so more
      // names pop up up close. Interaction resets to overview.
      if (!idle) {
        phaseStart = now;
        tourPhase = 0;
      } else if (trips.length > 0) {
        const OVERVIEW_MS = 6000;
        const FOCUS_MS = 6500;
        const dur = tourPhase === 0 ? OVERVIEW_MS : FOCUS_MS;
        // In "no tour" mode (onboarding) it never zooms into a trip — stays a
        // gentle overview.
        if (noTourRef.current) {
          tourPhase = 0;
        } else if (now - phaseStart > dur) {
          if (tourPhase === 0) {
            // Entering a focus: frame the next trip (biggest first).
            tourPhase = 1;
            tourIdx = (tourIdx + 1) % trips.length;
          } else {
            tourPhase = 0;
          }
          phaseStart = now;
        }

        if (tourPhase === 0) {
          // Overview: sweep across all trips + ease back out.
          const lngs = trips.map((t) => t.anchor[0]);
          const lo = Math.min(...lngs) - 35;
          const hi = Math.max(...lngs) + 35;
          const centerLng = -rotation;
          if (centerLng <= lo) sweepDir = 1;
          else if (centerLng >= hi) sweepDir = -1;
          rotation -= velocity * sweepDir;
          targetScale += (1 - targetScale) * 0.04;
          tilt += (0 - tilt) * 0.04;
        } else {
          // Focus: ease onto one real trip and frame it. Zoom adapts to how
          // spread out its route is, so a big trip fills the view nicely.
          const trip = trips[Math.min(tourIdx, trips.length - 1)]!;
          const spread = tripSpread(trip);
          const zoom = Math.max(1.6, Math.min(3.4, 70 / (spread + 12)));
          rotation += (((-trip.anchor[0] - rotation + 540) % 360) - 180) * 0.03;
          tilt += (trip.anchor[1] - CENTER_LAT - tilt) * 0.04;
          targetScale += (zoom - targetScale) * 0.035;
        }
      }

      // Smooth zoom toward the target every frame (no jumps).
      scale += (targetScale - scale) * 0.15;

      projection
        .scale((w / 2 - 2 * dpr) * scale)
        .translate([w / 2, h / 2])
        .rotate([rotation, -(CENTER_LAT + tilt), 0]);

      ctx!.clearRect(0, 0, w, h);

      const dark = document.documentElement.dataset.theme === 'dark';

      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.fillStyle = dark ? '#1a2028' : '#eadfce';
      ctx!.fill();

      ctx!.beginPath();
      path(land);
      ctx!.fillStyle = dark ? '#2d3742' : '#d8c9ad';
      ctx!.fill();

      // A jump longer than this within a route line is treated as an (unmarked)
      // flight, so photos NL→Rome draw a flight bow, not a straight blue line.
      const FLIGHT_DEG = 6; // ~660 km
      const flightCenter = projection.invert!([w / 2, h / 2]);

      // --- Trip routes: keep the real vertices (corners), just split off any
      // flight-sized jumps so they render as bows, not straight lines. ---
      // Collect every flight leg (explicit + implicit) as endpoint pairs, then
      // draw them deduped so overlapping/close flights become one line.
      const flightPairs: { a: [number, number]; b: [number, number]; up: boolean }[] = [];
      for (const trip of trips) {
        const [r, g, b] = legibleColor(trip.color, dark);
        for (const seg of trip.flights ?? []) {
          flightPairs.push({ a: seg[0]!, b: seg[seg.length - 1]!, up: trip.upcoming });
        }
        if (!trip.path) continue;

        ctx!.lineJoin = 'round';
        ctx!.lineCap = 'round';
        for (const seg of trip.path) {
          // Split the segment wherever a jump is flight-sized.
          let run: [number, number][] = seg.length ? [seg[0]!] : [];
          const flushRun = () => {
            if (run.length < 2) return;
            ctx!.beginPath();
            path({ type: 'LineString', coordinates: run } as GeoPermissibleObjects);
            if (trip.upcoming) {
              ctx!.setLineDash([2 * dpr, 7 * dpr]);
              ctx!.strokeStyle = `rgba(${r},${g},${b},0.6)`;
              ctx!.lineWidth = 1.8 * dpr;
            } else {
              ctx!.setLineDash([]);
              ctx!.strokeStyle = `rgba(${r},${g},${b},0.95)`;
              ctx!.lineWidth = 1.9 * dpr;
            }
            ctx!.stroke();
          };
          for (let i = 1; i < seg.length; i++) {
            if (distance(seg[i - 1]!, seg[i]!) > FLIGHT_DEG) {
              flushRun();
              flightPairs.push({ a: seg[i - 1]!, b: seg[i]!, up: trip.upcoming });
              run = [seg[i]!];
            } else {
              run.push(seg[i]!);
            }
          }
          flushRun();
        }
      }
      ctx!.setLineDash([]);

      // --- Flight legs: thin grey dashed BOWS. Deduped by coarse endpoints so a
      // there-and-back on the same route, or two nearby airports (JFK/EWR), draw
      // as a single line rather than two overlapping ones. ---
      const seen = new Set<string>();
      const key = (p: [number, number]) => `${Math.round(p[0] / 1.2)},${Math.round(p[1] / 1.2)}`;
      ctx!.strokeStyle = dark ? 'rgba(165,175,187,0.9)' : 'rgba(105,115,128,0.85)';
      ctx!.lineWidth = 1.2 * dpr;
      ctx!.setLineDash([2 * dpr, 5 * dpr]);
      for (const { a: start, b: end } of flightPairs) {
        const k = [key(start), key(end)].sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        if (flightCenter && (distance(flightCenter, start) > 90 || distance(flightCenter, end) > 90))
          continue;
        const a = projection(start);
        const b = projection(end);
        if (!a || !b) continue;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 2) continue;
        const off = Math.min(len * 0.22, 70 * dpr);
        let px = dy / len;
        let py = -dx / len;
        if (py > 0) {
          px = -px;
          py = -py;
        }
        ctx!.beginPath();
        ctx!.moveTo(a[0], a[1]);
        ctx!.quadraticCurveTo((a[0] + b[0]) / 2 + px * off, (a[1] + b[1]) / 2 + py * off, b[0], b[1]);
        ctx!.stroke();
      }
      ctx!.setLineDash([]);

      // --- Markers: the trip's start, plus its end when the route finishes in a
      // different place (e.g. fly into Marrakech, out of Barcelona). Endpoints
      // that land on (nearly) the same screen spot — a city visited on several
      // trips, or a busy corner of Europe seen from afar — merge into ONE dot
      // with a small corner count, so the globe stays readable and the dot
      // never grows. ---
      const center = projection.invert!([w / 2, h / 2]);
      const frontFacing = trips.filter((t) => !center || distance(center, t.anchor) <= 90);

      type MarkerPt = { x: number; y: number; col: [number, number, number]; upcoming: boolean };
      const markerPts: MarkerPt[] = [];
      const collect = (p: [number, number], col: [number, number, number], upcoming: boolean) => {
        if (center && distance(center, p) > 90) return;
        const projected = projection(p);
        if (!projected) return;
        markerPts.push({ x: projected[0], y: projected[1], col, upcoming });
      };
      for (const trip of frontFacing) {
        const col = legibleColor(trip.color, dark);
        collect(trip.anchor, col, trip.upcoming);
        // Route end (last vertex of the last ground segment).
        const lastSeg = trip.path?.[trip.path.length - 1];
        const end = lastSeg?.[lastSeg.length - 1];
        if (end && distance(trip.anchor, end) > 1.2) collect(end, col, trip.upcoming);
      }

      // Cluster overlapping markers in screen space. First-seen wins the colour
      // (trips are size-sorted, so the biggest trip's colour represents the dot).
      const mergeR = 15 * dpr;
      const clusters: (MarkerPt & { count: number })[] = [];
      for (const pt of markerPts) {
        const near = clusters.find((c) => Math.hypot(c.x - pt.x, c.y - pt.y) < mergeR);
        if (near) {
          near.count += 1;
          near.upcoming = near.upcoming && pt.upcoming; // solid wins over dashed
        } else {
          clusters.push({ ...pt, count: 1 });
        }
      }

      const drawMarker = (x: number, y: number, col: [number, number, number], upcoming: boolean) => {
        const [r, g, b] = col;
        ctx!.beginPath();
        ctx!.arc(x, y, 9 * dpr, 0, 2 * Math.PI);
        ctx!.strokeStyle = `rgba(${r},${g},${b},0.4)`;
        ctx!.lineWidth = 1.5 * dpr;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(x, y, 5 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = `rgb(${r},${g},${b})`;
        ctx!.fill();
        if (upcoming) {
          ctx!.beginPath();
          ctx!.arc(x, y, 12 * dpr, 0, 2 * Math.PI);
          ctx!.strokeStyle = `rgba(${r},${g},${b},0.3)`;
          ctx!.setLineDash([2 * dpr, 2 * dpr]);
          ctx!.lineWidth = 1.2 * dpr;
          ctx!.stroke();
          ctx!.setLineDash([]);
        }
      };

      // Small count badge in the dot's upper-right corner (no bigger dot).
      const drawCount = (x: number, y: number, n: number) => {
        const bx = x + 6 * dpr;
        const by = y - 6 * dpr;
        ctx!.beginPath();
        ctx!.arc(bx, by, 6.5 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = dark ? '#e9edf2' : '#1e2a35';
        ctx!.fill();
        ctx!.fillStyle = dark ? '#1e2a35' : '#ffffff';
        ctx!.font = `600 ${8.5 * dpr}px 'Inter Variable', sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(n > 9 ? '9+' : String(n), bx, by + 0.5 * dpr);
        ctx!.textAlign = 'start';
      };

      for (const c of clusters) {
        drawMarker(c.x, c.y, c.col, c.upcoming);
        if (c.count > 1) drawCount(c.x, c.y, c.count);
      }

      // --- Labels: only a few, biggest first; more as you zoom in. Each fades
      // in/out so names pop up softly rather than snapping. ---
      const maxLabels = Math.max(2, Math.round(2 + (scale - 1) * 3));
      const showIds = new Set(frontFacing.slice(0, maxLabels).map((t) => t.id));
      labelRects = [];
      // Rects already drawn this frame — bigger trips (drawn first) win; a name
      // that would overlap one is suppressed so labels never pile up unreadably.
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const overlaps = (a: { x: number; y: number; w: number; h: number }) =>
        placed.some(
          (b) =>
            a.x < b.x + b.w + 4 * dpr &&
            a.x + a.w + 4 * dpr > b.x &&
            a.y < b.y + b.h + 4 * dpr &&
            a.y + a.h + 4 * dpr > b.y,
        );
      for (const trip of trips) {
        const projected = projection(trip.anchor);
        if (!projected) continue;
        if (center && distance(center, trip.anchor) > 90) continue;
        const label = trip.title;
        ctx!.font = `${11 * dpr}px 'Inter Variable', sans-serif`;
        const tw = ctx!.measureText(label).width;
        const px = projected[0] + 9 * dpr;
        const pw = tw + 12 * dpr;
        const ph = 18 * dpr;
        const collides = overlaps({ x: px, y: projected[1] - 17 * dpr, w: pw, h: ph });
        // Suppress if not in the top-N or it would collide with a placed label.
        const target = showIds.has(trip.id) && !collides ? 1 : 0;
        const cur = labelOpacity.get(trip.id) ?? 0;
        const next = cur + (target - cur) * 0.12;
        labelOpacity.set(trip.id, next);
        if (next < 0.03) continue;
        const py = projected[1] - 8 * dpr - (1 - next) * 6 * dpr; // slide up as it appears
        if (next > 0.5) placed.push({ x: px, y: py, w: pw, h: ph });
        if (next > 0.6) labelRects.push({ id: trip.id, x: px, y: py, w: pw, h: ph });
        ctx!.globalAlpha = Math.min(1, next);
        ctx!.fillStyle = 'rgba(255,255,255,0.94)';
        roundRect(ctx!, px, py, pw, ph, 9 * dpr);
        ctx!.fill();
        ctx!.fillStyle = '#1e2a35';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(label, px + 6 * dpr, py + 9 * dpr);
        ctx!.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    }
    draw();

    // --- Interaction: drag to spin/tilt, pinch or wheel to zoom, tap a marker
    // to open the trip. After you let go it eases back to the auto-sweep. ---
    const pinchDist = () => {
      const p = [...pointers.values()];
      return Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y);
    };

    function onDown(e: PointerEvent) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragging = true;
      moved = 0;
      lastInteract = performance.now();
      if (pointers.size === 2) pinchStart = pinchDist();
      canvas!.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      lastInteract = performance.now();
      if (pointers.size === 2) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinchStart > 0) {
          targetScale = Math.min(5, Math.max(1, targetScale * (pinchDist() / pinchStart)));
          pinchStart = pinchDist();
        }
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      // Pan slower when zoomed in so it stays controllable.
      rotation += (dx * 0.25) / scale;
      tilt = Math.max(-60, Math.min(60, tilt + (dy * 0.25) / scale));
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    function onUp(e: PointerEvent) {
      pointers.delete(e.pointerId);
      lastInteract = performance.now();
      if (pointers.size < 2) pinchStart = 0;
      if (pointers.size === 0) dragging = false;
      canvas!.releasePointerCapture?.(e.pointerId);
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      lastInteract = performance.now();
      targetScale = Math.min(5, Math.max(1, targetScale * (1 - e.deltaY * 0.0015)));
    }
    function onClick(e: PointerEvent) {
      if (moved > 8) return; // it was a pan, not a tap
      const rect = canvas!.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * dpr;
      const cy = (e.clientY - rect.top) * dpr;
      // A tap on a trip's name pill opens it.
      for (const r of labelRects) {
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
          navigate(`/trips/${r.id}`);
          return;
        }
      }
      const inverted = projection.invert!([cx, cy]);
      if (!inverted) return;
      let best: { id: string; d: number } | null = null;
      for (const trip of globeTrips()) {
        const d = distance(inverted, trip.anchor);
        if (d < 6 / scale && (!best || d < best.d)) best = { id: trip.id, d };
      }
      if (best) navigate(`/trips/${best.id}`);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', (e) => onClick(e as PointerEvent));

    const onResize = () => size();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [navigate]);

  return (
    <div className="globe-backdrop">
      <canvas ref={canvasRef} />
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Rough angular spread (degrees) of a trip's route around its anchor. */
function tripSpread(trip: GlobeTrip): number {
  if (!trip.path) return 0;
  let max = 0;
  for (const seg of trip.path) {
    for (const p of seg) {
      const d = distance(trip.anchor, p);
      if (d > max) max = d;
    }
  }
  return max;
}

/** Golden-angle hue spread → a distinct, legible colour for trip index i. */
function autoColor(i: number): [number, number, number] {
  const hue = (i * 137.508) % 360;
  return hslToRgb(hue, 62, 55);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Clamp a colour's lightness so it stays readable on the current background:
 *  darker on the light (beige) globe, lighter on the dark globe. */
function legibleColor(rgb: [number, number, number], dark: boolean): [number, number, number] {
  const [h, s, l] = rgbToHsl(rgb);
  const s2 = Math.max(s, 55);
  const l2 = dark ? Math.max(l, 58) : Math.min(l, 46);
  return hslToRgb(h, s2, l2);
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function distance(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))) / toRad;
}
