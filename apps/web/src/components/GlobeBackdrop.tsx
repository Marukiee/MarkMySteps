import { geoOrthographic, geoPath, GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const topo = land110m as unknown as LandTopology;
    const land = topojson.feature(topo, topo.objects.land) as unknown as GeoPermissibleObjects;

    let raf = 0;
    let rotation = 10; // start over Europe/Africa
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const points = trips
      .map((t) => t.anchor)
      .filter((p): p is [number, number] => p !== null);

    function size() {
      const parent = canvas!.parentElement!;
      const s = Math.min(parent.clientWidth, 820);
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

      // Ocean sphere.
      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.fillStyle = '#eadfce';
      ctx!.fill();

      // Land.
      ctx!.beginPath();
      path(land);
      ctx!.fillStyle = '#d8c9ad';
      ctx!.fill();

      // Trip markers.
      for (const coord of points) {
        const projected = projection(coord);
        if (!projected) continue;
        // Hide points on the far side of the globe.
        const center = projection.invert!([w / 2, h / 2]);
        if (center && distance(center, coord) > 90) continue;
        ctx!.beginPath();
        ctx!.arc(projected[0], projected[1], 5 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = '#e8613c';
        ctx!.fill();
      }

      rotation += 0.06;
      raf = requestAnimationFrame(draw);
    }
    draw();

    const onResize = () => size();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [trips]);

  return (
    <div className="globe-backdrop" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
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
