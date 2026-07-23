import { geoOrthographic, geoPath, GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as topojson from 'topojson-client';
// Low-res land outline bundled locally (no CDN); ~110m resolution.
import land110m from 'world-atlas/land-110m.json';
import type { Trip } from '../api/types';
import { flightArc, splitOnGaps } from '../lib/arc';
import './globe.css';

// Minimal shape of the TopoJSON we consume (avoids a types-only dep).
type LandTopology = Parameters<typeof topojson.feature>[0] & {
  objects: { land: Parameters<typeof topojson.feature>[1] };
};

interface GlobeTrip {
  id: string;
  title: string;
  anchor: [number, number];
  path: [number, number][] | null;
  upcoming: boolean;
  /** Relative importance (km, else days) — drives label priority. */
  size: number;
}

/**
 * Rotating 3D globe behind the trips overview. Orthographic projection on a
 * canvas — a genuine sphere. Each trip draws its route (dashed if it hasn't
 * happened yet) plus a glowing marker; the globe auto-rotates back whenever it
 * would drift to an empty hemisphere so a trip is always in view.
 */
export function GlobeBackdrop({ trips }: { trips: Trip[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const tripsRef = useRef(trips);
  tripsRef.current = trips;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const topo = land110m as unknown as LandTopology;
    const land = topojson.feature(topo, topo.objects.land) as unknown as GeoPermissibleObjects;

    let raf = 0;
    let rotation = 10; // start over Europe/Africa
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

    const globeTrips = (): GlobeTrip[] =>
      tripsRef.current
        .filter((t): t is Trip & { anchor: [number, number] } => t.anchor !== null)
        .map((t) => ({
          id: t.id,
          title: t.title,
          anchor: t.anchor,
          path: t.routePath && t.routePath.length >= 2 ? t.routePath : null,
          upcoming: t.endDate.slice(0, 10) >= today,
          size: t.distanceKm && t.distanceKm > 0 ? t.distanceKm : dayCount(t) * 40,
        }))
        // Biggest trips first — they get labelled first / at the lowest zoom.
        .sort((a, b) => b.size - a.size);

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
    const CENTER_LAT = 18;

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
        if (now - phaseStart > dur) {
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

      // --- Trip routes (solid ground segments + lighter bowed flight arcs) ---
      for (const trip of trips) {
        if (!trip.path) continue;
        const [r, g, b] = tripColor(trip.id);
        const segs = splitOnGaps(trip.path, 500);

        ctx!.lineJoin = 'round';
        ctx!.lineCap = 'round';
        for (const seg of segs) {
          ctx!.beginPath();
          path({ type: 'LineString', coordinates: seg } as GeoPermissibleObjects);
          if (trip.upcoming) {
            ctx!.setLineDash([3 * dpr, 5 * dpr]);
            ctx!.strokeStyle = `rgba(${r},${g},${b},0.55)`;
            ctx!.lineWidth = 1.8 * dpr;
          } else {
            ctx!.setLineDash([]);
            ctx!.strokeStyle = `rgba(${r},${g},${b},0.95)`;
            ctx!.lineWidth = 2.4 * dpr;
          }
          ctx!.stroke();
        }

        // Flight arcs across the gaps, in a lighter tint of the trip colour.
        if (segs.length > 1) {
          const lr = Math.round(r + (255 - r) * 0.5);
          const lg = Math.round(g + (255 - g) * 0.5);
          const lb = Math.round(b + (255 - b) * 0.5);
          ctx!.setLineDash([3 * dpr, 4 * dpr]);
          ctx!.strokeStyle = `rgba(${lr},${lg},${lb},0.85)`;
          ctx!.lineWidth = 1.8 * dpr;
          for (let s = 1; s < segs.length; s++) {
            const a = segs[s - 1]![segs[s - 1]!.length - 1]!;
            const arc = flightArc(a, segs[s]![0]!, 40);
            ctx!.beginPath();
            path({ type: 'LineString', coordinates: arc } as GeoPermissibleObjects);
            ctx!.stroke();
          }
        }
      }
      ctx!.setLineDash([]);

      // --- Markers (all front-facing trips) ---
      const center = projection.invert!([w / 2, h / 2]);
      const frontFacing = trips.filter((t) => !center || distance(center, t.anchor) <= 90);
      for (const trip of frontFacing) {
        const projected = projection(trip.anchor);
        if (!projected) continue;
        const [r, g, b] = tripColor(trip.id);
        ctx!.beginPath();
        ctx!.arc(projected[0], projected[1], 9 * dpr, 0, 2 * Math.PI);
        ctx!.strokeStyle = `rgba(${r},${g},${b},0.4)`;
        ctx!.lineWidth = 1.5 * dpr;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(projected[0], projected[1], 5 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = `rgb(${r},${g},${b})`;
        ctx!.fill();
        // A faint ring marks a planned/upcoming trip.
        if (trip.upcoming) {
          ctx!.beginPath();
          ctx!.arc(projected[0], projected[1], 12 * dpr, 0, 2 * Math.PI);
          ctx!.strokeStyle = `rgba(${r},${g},${b},0.3)`;
          ctx!.setLineDash([2 * dpr, 2 * dpr]);
          ctx!.lineWidth = 1.2 * dpr;
          ctx!.stroke();
          ctx!.setLineDash([]);
        }
      }

      // --- Labels: only a few, biggest first; more as you zoom in. Each fades
      // in/out so names pop up softly rather than snapping. ---
      const maxLabels = Math.max(2, Math.round(2 + (scale - 1) * 3));
      const showIds = new Set(frontFacing.slice(0, maxLabels).map((t) => t.id));
      labelRects = [];
      for (const trip of trips) {
        const target = showIds.has(trip.id) ? 1 : 0;
        const cur = labelOpacity.get(trip.id) ?? 0;
        const next = cur + (target - cur) * 0.12;
        labelOpacity.set(trip.id, next);
        if (next < 0.03) continue;
        const projected = projection(trip.anchor);
        if (!projected) continue;
        if (center && distance(center, trip.anchor) > 90) continue;
        const label = trip.title;
        ctx!.font = `${11 * dpr}px 'Inter Variable', sans-serif`;
        const tw = ctx!.measureText(label).width;
        const px = projected[0] + 9 * dpr;
        const py = projected[1] - 8 * dpr - (1 - next) * 6 * dpr; // slide up as it appears
        const pw = tw + 12 * dpr;
        const ph = 18 * dpr;
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
  for (const p of trip.path) {
    const d = distance(trip.anchor, p);
    if (d > max) max = d;
  }
  return max;
}

// Distinct, legible marker/route colours; assigned deterministically per trip.
const TRIP_PALETTE: [number, number, number][] = [
  [232, 97, 60], // coral
  [42, 143, 133], // teal
  [90, 110, 225], // indigo
  [214, 141, 51], // amber
  [176, 84, 168], // magenta
  [76, 160, 92], // green
  [223, 92, 120], // rose
  [64, 158, 197], // sky
  [150, 122, 74], // olive
];

function tripColor(id: string): [number, number, number] {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TRIP_PALETTE[hash % TRIP_PALETTE.length]!;
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
