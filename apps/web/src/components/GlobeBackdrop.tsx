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

/**
 * Subtle rotating 3D globe behind the trips overview. Orthographic
 * projection on a canvas — genuine sphere, cheap, starts on Europe and
 * drifts slowly. Trip start points glow as markers.
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
    const velocity = 0.015; // gentle idle auto-spin
    let dragging = false;
    let lastX = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const anchored = () =>
      tripsRef.current.filter(
        (t): t is Trip & { anchor: [number, number] } => t.anchor !== null,
      );

    function size() {
      const parent = canvas!.parentElement!;
      // Fill the hero: diameter tracks the smaller of width/height, but larger
      // than before so continents and trip labels read clearly.
      const s = Math.min(parent.clientWidth, Math.max(parent.clientHeight * 1.4, 320), 900);
      canvas!.width = s * dpr;
      canvas!.height = s * dpr;
      canvas!.style.width = `${s}px`;
      canvas!.style.height = `${s}px`;
    }
    size();

    const projection = geoOrthographic().clipAngle(90);
    const path = geoPath(projection, ctx);

    function draw() {
      const w = canvas!.width;
      const h = canvas!.height;
      projection
        .scale(w / 2 - 2 * dpr)
        .translate([w / 2, h / 2])
        .rotate([rotation, -18, 0]);

      ctx!.clearRect(0, 0, w, h);

      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.fillStyle = '#eadfce';
      ctx!.fill();

      ctx!.beginPath();
      path(land);
      ctx!.fillStyle = '#d8c9ad';
      ctx!.fill();

      const center = projection.invert!([w / 2, h / 2]);
      for (const trip of anchored()) {
        const projected = projection(trip.anchor);
        if (!projected) continue;
        if (center && distance(center, trip.anchor) > 90) continue;
        // Pulsing marker.
        ctx!.beginPath();
        ctx!.arc(projected[0], projected[1], 9 * dpr, 0, 2 * Math.PI);
        ctx!.strokeStyle = 'rgba(232,97,60,0.4)';
        ctx!.lineWidth = 1.5 * dpr;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(projected[0], projected[1], 5 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = '#e8613c';
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

      if (!dragging) rotation += velocity;
      raf = requestAnimationFrame(draw);
    }
    draw();

    // --- Interaction: drag to spin, click a marker to open the trip ---
    function onDown(e: PointerEvent) {
      dragging = true;
      lastX = e.clientX;
      canvas!.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      if (!dragging) return;
      rotation += (e.clientX - lastX) * 0.25;
      lastX = e.clientX;
    }
    function onUp(e: PointerEvent) {
      dragging = false;
      canvas!.releasePointerCapture(e.pointerId);
    }
    function onClick(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const inverted = projection.invert!([
        (e.clientX - rect.left) * dpr,
        (e.clientY - rect.top) * dpr,
      ]);
      if (!inverted) return;
      let best: { id: string; d: number } | null = null;
      for (const trip of anchored()) {
        const d = distance(inverted, trip.anchor);
        if (d < 6 && (!best || d < best.d)) best = { id: trip.id, d };
      }
      if (best) navigate(`/trips/${best.id}`);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('click', (e) => onClick(e as PointerEvent));

    const onResize = () => size();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
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
