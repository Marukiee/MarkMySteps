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
  path: [number, number][] | null;
  upcoming: boolean;
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

    const globeTrips = (): GlobeTrip[] =>
      tripsRef.current
        .filter((t): t is Trip & { anchor: [number, number] } => t.anchor !== null)
        .map((t) => ({
          id: t.id,
          title: t.title,
          anchor: t.anchor,
          path: t.routePath && t.routePath.length >= 2 ? t.routePath : null,
          upcoming: t.endDate.slice(0, 10) >= today,
        }));

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

      // --- Auto-rotate: sweep back and forth across the trips (pendulum) so
      // they always stay in view. At the edge of the spread the direction just
      // flips — no snap-back. Paused while the user is interacting. ---
      if (idle) {
        if (trips.length > 0) {
          const lngs = trips.map((t) => t.anchor[0]);
          const lo = Math.min(...lngs) - 35;
          const hi = Math.max(...lngs) + 35;
          const centerLng = -rotation;
          if (centerLng <= lo) sweepDir = 1;
          else if (centerLng >= hi) sweepDir = -1;
          rotation -= velocity * sweepDir;
        } else {
          rotation += velocity;
        }
        // Ease zoom + tilt back to the default overview.
        targetScale += (1 - targetScale) * 0.04;
        tilt += (0 - tilt) * 0.04;
      }

      // Smooth zoom toward the target every frame (no jumps).
      scale += (targetScale - scale) * 0.15;

      projection
        .scale((w / 2 - 2 * dpr) * scale)
        .translate([w / 2, h / 2])
        .rotate([rotation, -(CENTER_LAT + tilt), 0]);

      ctx!.clearRect(0, 0, w, h);

      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.fillStyle = '#eadfce';
      ctx!.fill();

      ctx!.beginPath();
      path(land);
      ctx!.fillStyle = '#d8c9ad';
      ctx!.fill();

      // --- Trip routes ---
      for (const trip of trips) {
        if (!trip.path) continue;
        ctx!.beginPath();
        path({ type: 'LineString', coordinates: trip.path } as GeoPermissibleObjects);
        if (trip.upcoming) {
          ctx!.setLineDash([4 * dpr, 4 * dpr]);
          ctx!.strokeStyle = 'rgba(42,143,133,0.9)'; // teal for planned
        } else {
          ctx!.setLineDash([]);
          ctx!.strokeStyle = 'rgba(232,97,60,0.9)'; // accent for past
        }
        ctx!.lineWidth = 2.4 * dpr;
        ctx!.lineJoin = 'round';
        ctx!.lineCap = 'round';
        ctx!.stroke();
      }
      ctx!.setLineDash([]);

      // --- Markers + labels ---
      const center = projection.invert!([w / 2, h / 2]);
      for (const trip of trips) {
        const projected = projection(trip.anchor);
        if (!projected) continue;
        if (center && distance(center, trip.anchor) > 90) continue;
        const color = trip.upcoming ? '#2a8f85' : '#e8613c';
        ctx!.beginPath();
        ctx!.arc(projected[0], projected[1], 9 * dpr, 0, 2 * Math.PI);
        ctx!.strokeStyle = trip.upcoming ? 'rgba(42,143,133,0.4)' : 'rgba(232,97,60,0.4)';
        ctx!.lineWidth = 1.5 * dpr;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(projected[0], projected[1], 5 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = color;
        ctx!.fill();
        // Label pill with the trip title.
        const label = trip.title;
        ctx!.font = `${11 * dpr}px 'Inter Variable', sans-serif`;
        const tw = ctx!.measureText(label).width;
        const px = projected[0] + 9 * dpr;
        const py = projected[1] - 8 * dpr;
        ctx!.fillStyle = 'rgba(255,255,255,0.92)';
        roundRect(ctx!, px, py, tw + 12 * dpr, 18 * dpr, 9 * dpr);
        ctx!.fill();
        ctx!.fillStyle = '#1e2a35';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(label, px + 6 * dpr, py + 9 * dpr);
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
      const inverted = projection.invert!([
        (e.clientX - rect.left) * dpr,
        (e.clientY - rect.top) * dpr,
      ]);
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
