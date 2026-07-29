import { geoOrthographic, geoPath, GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as topojson from 'topojson-client';
// Low-res land outline bundled locally (no CDN); ~110m resolution.
import land110m from 'world-atlas/land-110m.json';
import type { Trip } from '../api/types';
import { airportByCode } from '../lib/airports';
import { getDefaultAirports } from '../lib/prefs';
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
  /** Manual marker override in effect → draw one dot at the anchor, not ends. */
  markerFixed: boolean;
}

/**
 * Rotating 3D globe behind the trips overview. Orthographic projection on a
 * canvas — a genuine sphere. Each trip draws its route (dashed if it hasn't
 * happened yet) plus a glowing marker; the globe auto-rotates back whenever it
 * would drift to an empty hemisphere so a trip is always in view.
 */
export function GlobeBackdrop({
  trips,
  noTour,
  selfLocation,
}: {
  trips: Trip[];
  noTour?: boolean;
  /** [lng, lat] of your own live position, when you've opted to show it here. */
  selfLocation?: [number, number] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const tripsRef = useRef(trips);
  tripsRef.current = trips;
  const noTourRef = useRef(noTour);
  noTourRef.current = noTour;
  const selfRef = useRef(selfLocation);
  selfRef.current = selfLocation;

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
          markerFixed: t.markerLng != null && t.markerLat != null,
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
    // When each trip first showed up. Trips arrive a beat after the page (the
    // list is fetched), so they ease in with a small per-trip stagger instead of
    // snapping onto the globe all at once.
    const appearedAt = new Map<string, number>();
    const REVEAL_MS = 620;
    const tripAlpha = (id: string, now: number): number => {
      let at = appearedAt.get(id);
      if (at === undefined) {
        // Deterministic 0–320 ms offset per trip, so they don't arrive in lockstep.
        let hash = 0;
        for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
        at = now + (hash % 320);
        appearedAt.set(id, at);
      }
      const t = (now - at) / REVEAL_MS;
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return 1 - (1 - t) * (1 - t) * (1 - t); // ease-out cubic
    };
    // On the homepage globe names are hidden until you tap a trip; this holds the
    // tapped trip (its name card shows, tapping the card opens the trip). Tapping
    // elsewhere clears it. Onboarding ignores this and shows names over routes.
    let selectedId: string | null = null;
    // A comet of light that flows along the active route so you can see its
    // direction. Measured in degrees along the path → constant travel speed.
    let glowDist = 0;
    // Auto-tour state: alternate a wide overview with a zoom into the busiest
    // region, so trips are shown big first, then explored up close.
    let tourPhase = 0; // 0 = overview, 1 = focus
    let phaseStart = performance.now();
    let tourIdx = 0; // which trip is being framed during a focus phase
    /** Completed runs of the light along the framed trip's route. The tour
     *  waits for two — one pass reads as a glance, two as having shown you the
     *  route — and only once the trail behind the head is in as well. */
    let glowRuns = 0;
    /** Two passes read as "here is the route"; on a route long enough that one
     *  pass already takes a while, a second is just waiting. */
    const glowRunsFor = (totalDeg: number) => (totalDeg > 40 ? 1 : 2);
    let glowRunsNeeded = 2;
    /** Which trip the tour framed last, by id: picking by index went round
     *  again whenever the list came back in a different order, which showed the
     *  same trip twice. */
    let lastFocusId: string | null = null;
    // Velocities for the camera springs (see easeTo). A plain lerp starts at
    // full speed, which is what made zooming out feel abrupt; a critically
    // damped spring starts from rest and settles without overshooting.
    let scaleV = 0;
    let tiltV = 0;
    let rotV = 0;
    let lastFrame = performance.now();
    // Screen rects of the drawn labels, so tapping a name opens its trip.
    let labelRects: { id: string; x: number; y: number; w: number; h: number }[] = [];

    // The canvas fills its container completely; the sphere is then drawn
    // centred at the largest radius that fits BOTH dimensions (see draw()).
    // Because everything outside the sphere stays transparent there is no
    // rectangle to hide, so nothing has to be shrunk "just in case".
    function size() {
      const parent = canvas!.parentElement!;
      const w = Math.max(1, parent.clientWidth);
      const h = Math.max(1, parent.clientHeight);
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
    }
    size();
    // clientWidth/Height can still be 0 (or stale) on the very first frame of a
    // freshly mounted page — re-measure whenever the container settles.
    const ro = new ResizeObserver(() => size());
    ro.observe(canvas.parentElement!);

    // The airports you fly out of are not destinations — they get the small
    // grey airport dot and stay out of the coloured, colour-cycling trip dots.
    const homeAirports = getDefaultAirports()
      .map((code) => airportByCode(code))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => [a.lon, a.lat] as [number, number]);
    const isHomeAirport = (p: [number, number]) =>
      homeAirports.some((h) => distance(h, p) < 0.4);

    const projection = geoOrthographic().clipAngle(90);
    const path = geoPath(projection, ctx);
    // Lifts the framing toward Europe so Africa isn't dominant. Raised a touch
    // when the bottom fade got shorter: the sphere sat low in what was left.
    const CENTER_LAT = 27;

    function draw() {
      const w = canvas!.width;
      const h = canvas!.height;
      const trips = globeTrips();

      const now = performance.now();
      // Clamped: a backgrounded tab hands back a huge gap on its first frame.
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;
      const idle = !dragging && now - lastInteract > 1400;

      /** Critically damped step toward `target`. Returns [value, velocity]. */
      const ease = (
        value: number,
        velocity: number,
        target: number,
        stiffness: number,
      ): [number, number] => {
        const damping = 2 * Math.sqrt(stiffness);
        const accel = -stiffness * (value - target) - damping * velocity;
        const v = velocity + accel * dt;
        return [value + v * dt, v];
      };

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
            // Entering a focus: frame the next trip (biggest first). A stale tap
            // selection is cleared so the tour can highlight this one.
            tourPhase = 1;
            // Step to the next trip by id, so a reordered list cannot land on
            // the one just shown.
            const at = trips.findIndex((t) => t.id === lastFocusId);
            tourIdx = trips.length > 1 ? (at + 1) % trips.length : 0;
            if (trips.length > 1 && trips[tourIdx]!.id === lastFocusId) {
              tourIdx = (tourIdx + 1) % trips.length;
            }
            lastFocusId = trips[tourIdx]!.id;
            selectedId = null;
            glowDist = 0;
            glowRuns = 0;
            phaseStart = now;
          } else if (glowRuns >= glowRunsNeeded || now - phaseStart > dur * 5) {
            // Hold the zoom until the light has travelled the whole route (with
            // a ceiling, so a route that never finishes can't strand the tour).
            tourPhase = 0;
            phaseStart = now;
          }
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
          targetScale = 1;
          [scale, scaleV] = ease(scale, scaleV, targetScale, 5.2);
          [tilt, tiltV] = ease(tilt, tiltV, 0, 5.2);
        } else {
          // Focus: ease onto one real trip and frame the WHOLE of it — its
          // middle, and a zoom taken from how far the route reaches from there.
          // Framing on the anchor put the first dot in the centre with the rest
          // of the route trailing off one side.
          const trip = trips[Math.min(tourIdx, trips.length - 1)]!;
          const { centre, spread } = tripFraming(trip);
          const zoom = Math.max(1.5, Math.min(3.4, 46 / (spread + 9)));
          const shortest = ((-centre[0] - rotation + 540) % 360) - 180;
          [rotation, rotV] = ease(rotation, rotV, rotation + shortest, 2.4);
          // A touch above centre: the fade tail eats the lower third, so the
          // route would otherwise sit low in the view.
          [tilt, tiltV] = ease(tilt, tiltV, centre[1] - CENTER_LAT - 3, 5.2);
          targetScale = zoom;
          [scale, scaleV] = ease(scale, scaleV, targetScale, 5.2);
        }
      }

      // Dragging and pinching set targetScale directly; catch up quickly there,
      // since the finger is the one in charge.
      if (!idle || trips.length === 0) {
        [scale, scaleV] = ease(scale, scaleV, targetScale, 26);
      }

      // Radius fits the SHORTER side, so the sphere is as big as it can be
      // without ever being clipped left/right or top/bottom.
      const radius = Math.min(w, h) / 2 - 2 * dpr;
      projection
        .scale(radius * scale)
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
      // Every point a flight touches, layovers included — they get a grey
      // airport dot, unlike the coloured dots reserved for real destinations.
      const airportPoints: [number, number][] = [];
      for (const trip of trips) {
        const [r, g, b] = legibleColor(trip.color, dark);
        for (const seg of trip.flights ?? []) {
          // A flight is stored as its whole itinerary; bow each hop so a
          // stopover visibly breaks the line at that airport.
          for (let k = 1; k < seg.length; k++) {
            flightPairs.push({ a: seg[k - 1]!, b: seg[k]!, up: trip.upcoming });
          }
          for (const p of seg) airportPoints.push(p);
        }
        if (!trip.path) continue;

        ctx!.globalAlpha = tripAlpha(trip.id, now);
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
              airportPoints.push(seg[i - 1]!, seg[i]!);
              run = [seg[i]!];
            } else {
              run.push(seg[i]!);
            }
          }
          flushRun();
        }
        ctx!.globalAlpha = 1;
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

      // --- Markers ---
      // A short "city trip" (route stays around one place) gets the big ring
      // dot; a longer trip that draws a real route across the map gets a small
      // plain dot at each endpoint (no ring) so those don't shout. Endpoints at
      // the SAME real city — the same place visited on more than one trip — merge
      // into one dot carrying a count INSIDE it (not because dots drift close on
      // zoom: merging is geographic, so the number is stable). A trip whose start
      // and end are ~the same place (an interrail loop) is a single dot.
      const center = projection.invert!([w / 2, h / 2]);
      const frontFacing = trips.filter((t) => !center || distance(center, t.anchor) <= 90);

      // The "active" trip whose name + glow are shown: on the homepage that's the
      // trip you tapped, else the one the auto-tour is framing. Resolved here (not
      // just before the labels) because a shared dot has to hold this trip's colour.
      const activeId = noTourRef.current
        ? null
        : selectedId ??
          (idle && tourPhase === 1 ? trips[Math.min(tourIdx, trips.length - 1)]?.id ?? null : null);

      // Small grey dots at every flight endpoint (departure/arrival airports) so
      // the dashed bows visibly start FROM a point, not out of thin air. Smaller
      // than the trip dots, deduped by coarse endpoint.
      const airportSeen = new Set<string>();
      ctx!.setLineDash([]);
      for (const ap of airportPoints) {
        const kk = key(ap);
        if (airportSeen.has(kk)) continue;
        airportSeen.add(kk);
        if (center && distance(center, ap) > 90) continue;
        const pr = projection(ap);
        if (!pr) continue;
        ctx!.beginPath();
        ctx!.arc(pr[0], pr[1], 2.6 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = dark ? 'rgba(150,160,172,0.9)' : 'rgba(120,128,140,0.85)';
        ctx!.fill();
      }

      // Group endpoints by real-world proximity (~40 km), counting DISTINCT trips
      // so a single loop trip counts once, two separate visits count two.
      const SAME_PLACE_DEG = 0.4;
      type Member = {
        id: string;
        col: [number, number, number];
        upcoming: boolean;
        alpha: number;
      };
      type Place = {
        lng: number;
        lat: number;
        city: boolean; // at least one short/city trip ends here
        trips: Set<string>;
        members: Member[]; // one per distinct trip meeting here; dot cycles colours
      };
      const places: Place[] = [];
      const addEndpoint = (
        p: [number, number],
        col: [number, number, number],
        upcoming: boolean,
        city: boolean,
        tripId: string,
      ) => {
        if (center && distance(center, p) > 90) return;
        const alpha = tripAlpha(tripId, now);
        const g = places.find((q) => distance([q.lng, q.lat], p) < SAME_PLACE_DEG);
        if (g) {
          if (!g.trips.has(tripId)) {
            g.trips.add(tripId);
            g.members.push({ id: tripId, col, upcoming, alpha });
          }
          g.city = g.city || city;
        } else {
          places.push({
            lng: p[0],
            lat: p[1],
            city,
            trips: new Set([tripId]),
            members: [{ id: tripId, col, upcoming, alpha }],
          });
        }
      };
      for (const trip of frontFacing) {
        const col = legibleColor(trip.color, dark);
        const isCity = tripSpread(trip) < 2.5; // stays around one place
        // A manual marker (interrail loop) is the single dot — snapped onto the
        // nearest route vertex so it always sits ON the line, never on empty land.
        if (trip.markerFixed) {
          let mp = trip.anchor;
          let best = Infinity;
          for (const seg of trip.path ?? [])
            for (const p of seg) {
              const d = distance(trip.anchor, p);
              if (d < best) {
                best = d;
                mp = p;
              }
            }
          addEndpoint(mp, col, trip.upcoming, isCity, trip.id);
          continue;
        }
        // Collect every ground and flight segment endpoint (start, intermediate flight stops, destination).
        const tripPoints: [number, number][] = [];
        for (const seg of trip.path ?? []) {
          const firstPt = seg[0];
          const lastPt = seg[seg.length - 1];
          if (firstPt) tripPoints.push(firstPt);
          if (lastPt) tripPoints.push(lastPt);
        }
        for (const seg of trip.flights ?? []) {
          const firstPt = seg[0];
          const lastPt = seg[seg.length - 1];
          if (firstPt && !isHomeAirport(firstPt)) tripPoints.push(firstPt);
          if (lastPt && !isHomeAirport(lastPt)) tripPoints.push(lastPt);
        }
        if (tripPoints.length === 0) {
          tripPoints.push(trip.anchor);
        }

        for (const pt of tripPoints) {
          addEndpoint(pt, col, trip.upcoming, isCity, trip.id);
        }
      }
      // Second pass: a trip whose route PASSES THROUGH an existing place (a city
      // you've been before, mid-route with no dot of its own) joins that place, so
      // its dot cycles between both trips' colours — no new dot is created.
      for (const trip of frontFacing) {
        const col = legibleColor(trip.color, dark);
        for (const seg of trip.path ?? []) {
          for (const p of seg) {
            const g = places.find((q) => distance([q.lng, q.lat], p) < SAME_PLACE_DEG);
            if (g && !g.trips.has(trip.id)) {
              g.trips.add(trip.id);
              g.members.push({
                id: trip.id,
                col,
                upcoming: trip.upcoming,
                alpha: tripAlpha(trip.id, now),
              });
            }
          }
        }
      }

      // One clean dot style. A finished trip is a solid dot in its colour; an
      // upcoming trip is a coloured dot with a white DASHED ring.
      const drawSmallDot = (
        x: number,
        y: number,
        col: [number, number, number],
        upcoming: boolean,
      ) => {
        const [r, g, b] = col;
        ctx!.beginPath();
        ctx!.arc(x, y, 4.5 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = `rgb(${r},${g},${b})`;
        ctx!.fill();
        if (upcoming) {
          ctx!.lineWidth = 2 * dpr;
          ctx!.strokeStyle = dark ? 'rgba(235,240,247,0.98)' : 'rgba(255,255,255,1)';
          ctx!.stroke();
        } else {
          ctx!.lineWidth = 1.2 * dpr;
          ctx!.strokeStyle = dark ? 'rgba(20,25,32,0.7)' : 'rgba(255,255,255,0.85)';
          ctx!.stroke();
        }
      };

      const mix = (
        a: [number, number, number],
        b: [number, number, number],
        f: number,
      ): [number, number, number] => [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f),
      ];

      for (const pl of places) {
        const projected = projection([pl.lng, pl.lat]);
        if (!projected) continue;
        const [x, y] = projected;
        const m = pl.members;
        // A place shared by several trips is as visible as its most-arrived one.
        ctx!.globalAlpha = Math.max(...m.map((v) => v.alpha), 0);
        if (m.length <= 1) {
          drawSmallDot(x, y, m[0]?.col ?? [90, 110, 225], m[0]?.upcoming ?? false);
          ctx!.globalAlpha = 1;
          continue;
        }
        // While a trip is highlighted, every dot it touches holds ITS colour —
        // a city you've visited before shouldn't cycle away from the trip you're
        // looking at. Cycling resumes once nothing is highlighted.
        const held = activeId ? m.find((v) => v.id === activeId) : undefined;
        if (held) {
          drawSmallDot(x, y, held.col, held.upcoming);
          ctx!.globalAlpha = 1;
          continue;
        }
        // Visited by more than one trip → the dot slowly cycles through each
        // trip's colour (crossfading), so every trip sharing this place is seen.
        const PERIOD = 2200; // ms per colour
        const t = now / PERIOD;
        const idx = Math.floor(t) % m.length;
        const nextIdx = (idx + 1) % m.length;
        const f = t - Math.floor(t);
        const blend = f > 0.82 ? (f - 0.82) / 0.18 : 0; // crossfade the last bit
        const col = mix(m[idx]!.col, m[nextIdx]!.col, blend);
        drawSmallDot(x, y, col, m[idx]!.upcoming && m[nextIdx]!.upcoming);
        ctx!.globalAlpha = 1;
      }

      // --- Active route glow: a single continuous ribbon of light that runs
      // along the trip's path in travel direction, brightest at its head and
      // fading out along its tail. It's stroked as one chain of short segments
      // (not a string of separate dots, which read as beads on the line) and
      // moves at a CONSTANT speed measured in degrees, so a long route's glow
      // isn't faster than a short one. ---
      if (activeId) {
        const act = trips.find((t) => t.id === activeId);
        const pts = act?.path?.flat();
        const seglen: number[] = [];
        let total = 0;
        for (let i = 1; i < (pts?.length ?? 0); i++) {
          const d = distance(pts![i - 1]!, pts![i]!);
          seglen.push(d);
          total += d;
        }
        // A route needs some length before a light can visibly travel along it.
        // Below that (a city trip: one place, barely any line) the ribbon would
        // be a flickering speck, so those get a pulsing halo instead.
        const RIBBON_MIN_DEG = 1.2;
        if (act && pts && pts.length >= 2 && total > RIBBON_MIN_DEG) {
          const posAt = (d: number): [number, number] => {
            d = ((d % total) + total) % total;
            let acc = 0;
            for (let i = 0; i < seglen.length; i++) {
              if (acc + seglen[i]! >= d) {
                const f = (d - acc) / seglen[i]!;
                const a = pts[i]!;
                const b = pts[i + 1]!;
                return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
              }
              acc += seglen[i]!;
            }
            return pts[pts.length - 1]!;
          };
          // A run is over once the TAIL has arrived too, not just the head —
          // otherwise the globe zooms out through the light's own trail. Then a
          // short dwell before the next pass; looping instantly feels frantic.
          const TRAIL_DEG = Math.min(11, total * 0.4);
          // Just enough of a beat to read as two passes rather than one long
          // one; any more and the globe sits there doing nothing.
          const PAUSE = 2.5; // degrees' worth of dwell time past the end
          // Constant speed, except on a route long enough that one pass would
          // take forever — there the run is capped to a few seconds instead.
          const speed = Math.max(0.07, total / (5 * 60));
          glowRunsNeeded = glowRunsFor(total);
          if (glowRuns < glowRunsNeeded) {
            glowDist += speed * (dt * 60);
            if (glowDist > total + TRAIL_DEG + PAUSE) {
              // Straight into the next pass; the dwell above already happened.
              glowDist = glowRuns + 1 < glowRunsNeeded ? 0 : glowDist;
              glowRuns += 1;
            }
          }
          const [gr, gg, gb] = legibleColor(act.color, dark);

          // Sample the ribbon head → tail. A sample whose distance is
          // negative (or past the end) is simply dropped, so the ribbon slides
          // on and off the route instead of wrapping around in one jump.
          const STEPS = 28;
          const samples: { pt: [number, number]; t: number }[] = [];
          for (let i = 0; i <= STEPS; i++) {
            const t = i / STEPS; // 0 = head, 1 = tail
            const d = glowDist - TRAIL_DEG * t;
            if (d < 0 || d > total) continue;
            const gp = posAt(d);
            if (center && distance(center, gp) > 90) continue;
            const pr = projection(gp);
            if (!pr) continue;
            samples.push({ pt: [pr[0], pr[1]], t });
          }

          ctx!.lineCap = 'round';
          ctx!.lineJoin = 'round';
          // Two passes: a wide soft halo, then a thin bright core on top.
          for (const pass of [
            { width: 9 * dpr, peak: 0.22 },
            { width: 2.8 * dpr, peak: 0.95 },
          ]) {
            ctx!.lineWidth = pass.width;
            for (let i = 1; i < samples.length; i++) {
              const a = samples[i - 1]!;
              const b = samples[i]!;
              // Guard against a segment that leapt across the globe.
              if (Math.hypot(b.pt[0] - a.pt[0], b.pt[1] - a.pt[1]) > 60 * dpr) continue;
              // Quadratic falloff → a long, soft tail rather than a hard edge.
              const fade = (1 - b.t) * (1 - b.t);
              ctx!.strokeStyle = `rgba(${gr},${gg},${gb},${pass.peak * fade})`;
              ctx!.beginPath();
              ctx!.moveTo(a.pt[0], a.pt[1]);
              ctx!.lineTo(b.pt[0], b.pt[1]);
              ctx!.stroke();
            }
          }
        } else if (act) {
          // A city trip has no route to run a light along, so the place itself
          // is what gets highlighted. Two rings a beat apart, each easing out
          // as it widens and thins — a single expanding circle read as a blip,
          // and a bare halo read as nothing at all.
          glowRunsNeeded = 2;
          if (now - phaseStart > 3600) glowRuns = glowRunsNeeded;
          const spot = act.path?.[0]?.[0] ?? act.anchor;
          if (!center || distance(center, spot) <= 90) {
            const pr = projection(spot);
            if (pr) {
              const [gr, gg, gb] = legibleColor(act.color, dark);
              const [x, y] = pr;
              const PERIOD = 2000;

              // A halo that breathes with the rings rather than sitting still.
              const breathe = 0.5 + 0.5 * Math.sin((now / PERIOD) * Math.PI * 2);
              const haloR = (14 + breathe * 5) * dpr;
              const grad = ctx!.createRadialGradient(x, y, 0, x, y, haloR);
              grad.addColorStop(0, `rgba(${gr},${gg},${gb},${0.26 + breathe * 0.12})`);
              grad.addColorStop(0.55, `rgba(${gr},${gg},${gb},0.1)`);
              grad.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
              ctx!.fillStyle = grad;
              ctx!.beginPath();
              ctx!.arc(x, y, haloR, 0, 2 * Math.PI);
              ctx!.fill();

              for (const offset of [0, 0.5]) {
                const phase = ((now / PERIOD + offset) % 1 + 1) % 1;
                // Ease-out quart: quick out of the dot, then drifting.
                const ease = 1 - Math.pow(1 - phase, 4);
                const radius = (5.5 + ease * 21) * dpr;
                // Fades over the last two thirds, so a ring is fully formed
                // before it starts disappearing.
                const alpha = 0.6 * Math.min(1, phase * 3) * (1 - ease);
                ctx!.beginPath();
                ctx!.arc(x, y, radius, 0, 2 * Math.PI);
                ctx!.lineWidth = Math.max(0.6, 2.4 * (1 - ease)) * dpr;
                ctx!.strokeStyle = `rgba(${gr},${gg},${gb},${alpha})`;
                ctx!.stroke();
              }
            }
          }
        }
      }

      // --- Your own live position: a soft pulsing beacon, so it reads as "you"
      // rather than as another trip marker. ---
      const self = selfRef.current;
      if (self && (!center || distance(center, self) <= 90)) {
        const pr = projection(self);
        if (pr) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 700);
          const halo = (9 + pulse * 5) * dpr;
          const grad = ctx!.createRadialGradient(pr[0], pr[1], 0, pr[0], pr[1], halo);
          grad.addColorStop(0, 'rgba(56,132,255,0.4)');
          grad.addColorStop(1, 'rgba(56,132,255,0)');
          ctx!.fillStyle = grad;
          ctx!.beginPath();
          ctx!.arc(pr[0], pr[1], halo, 0, 2 * Math.PI);
          ctx!.fill();
          ctx!.beginPath();
          ctx!.arc(pr[0], pr[1], 4 * dpr, 0, 2 * Math.PI);
          ctx!.fillStyle = '#3884ff';
          ctx!.fill();
          ctx!.lineWidth = 2 * dpr;
          ctx!.strokeStyle = '#fff';
          ctx!.stroke();
        }
      }

      // --- Labels ---
      // Onboarding: a few names float over the routes. Homepage: only the active
      // trip's name shows (tap a dot to reveal it, tap the card to open it).
      const maxLabels = Math.max(2, Math.round(2 + (scale - 1) * 3));
      const showIds = noTourRef.current
        ? new Set(frontFacing.slice(0, maxLabels).map((t) => t.id))
        : new Set(activeId ? [activeId] : []);
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
        // The name belongs at the trip's starting point, unless a marker was
        // placed by hand in the trip settings — then it goes there. Either way
        // it snaps to a dot that is actually drawn, so the card never floats in
        // empty sea beside the route.
        const want = trip.markerFixed ? trip.anchor : trip.path?.[0]?.[0] ?? trip.anchor;
        let base = want;
        let bestD = Infinity;
        for (const pl of places) {
          if (!pl.trips.has(trip.id)) continue;
          const d = distance([pl.lng, pl.lat], want);
          if (d < bestD) {
            bestD = d;
            base = [pl.lng, pl.lat];
          }
        }
        const projected = projection(base);
        if (!projected) continue;
        if (center && distance(center, base) > 90) continue;
        const label = trip.title;
        ctx!.font = `${11 * dpr}px 'Inter Variable', sans-serif`;
        const tw = ctx!.measureText(label).width;
        const pw = tw + 12 * dpr;
        const ph = 18 * dpr;
        // Sits to the right of the dot; flips to the left when that would run
        // off the canvas, and is clamped so a long title is never half cut off.
        const margin = 6 * dpr;
        let px = projected[0] + 9 * dpr;
        if (px + pw > w - margin) px = projected[0] - 9 * dpr - pw;
        px = Math.max(margin, Math.min(px, w - pw - margin));
        const collides = overlaps({ x: px, y: projected[1] - 17 * dpr, w: pw, h: ph });
        // Suppress if not in the top-N or it would collide with a placed label.
        const target = showIds.has(trip.id) && !collides ? 1 : 0;
        const cur = labelOpacity.get(trip.id) ?? 0;
        // Eases IN noticeably slower than it fades out: appearing was a pop.
        const next = cur + (target - cur) * (target > cur ? 0.055 : 0.13);
        labelOpacity.set(trip.id, next);
        if (next < 0.03) continue;
        // Rises the last few pixels into place as it fades in, then sits still.
        const py = Math.max(
          margin,
          Math.min(projected[1] - 8 * dpr + (1 - next) * 7 * dpr, h - ph - margin),
        );
        if (next > 0.5) placed.push({ x: px, y: py, w: pw, h: ph });
        if (next > 0.6) labelRects.push({ id: trip.id, x: px, y: py, w: pw, h: ph });
        // Scales up from 88% around its left edge, so it grows out of the dot.
        const grow = 0.88 + 0.12 * next;
        ctx!.save();
        ctx!.globalAlpha = Math.min(1, next);
        ctx!.translate(px, py + ph / 2);
        ctx!.scale(grow, grow);
        ctx!.translate(-px, -(py + ph / 2));
        ctx!.fillStyle = 'rgba(255,255,255,0.94)';
        roundRect(ctx!, px, py, pw, ph, 9 * dpr);
        ctx!.fill();
        ctx!.fillStyle = '#1e2a35';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(label, px + 6 * dpr, py + 9 * dpr);
        ctx!.restore();
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
      // A tap on a trip's name card opens it (the card only shows once selected).
      for (const r of labelRects) {
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
          navigate(`/trips/${r.id}`);
          return;
        }
      }
      // A tap on a dot / near a route reveals that trip's name card; onboarding
      // opens the trip directly (its names are always shown there).
      const inverted = projection.invert!([cx, cy]);
      if (!inverted) {
        selectedId = null;
        return;
      }
      let best: { id: string; d: number } | null = null;
      for (const trip of globeTrips()) {
        // Nearest of the anchor and any route vertex, so tapping the line works.
        let d = distance(inverted, trip.anchor);
        for (const seg of trip.path ?? []) {
          for (const p of seg) d = Math.min(d, distance(inverted, p));
        }
        if (d < 6 / scale && (!best || d < best.d)) best = { id: trip.id, d };
      }
      if (!best) {
        selectedId = null; // tapped empty space → hide the name card
        return;
      }
      if (noTourRef.current) navigate(`/trips/${best.id}`);
      else selectedId = selectedId === best.id ? null : best.id; // toggle the card
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
      ro.disconnect();
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

/**
 * Where to point the camera to see the WHOLE trip, and how far away.
 *
 * Framing on the anchor put the first dot (and its name card) in the middle
 * with the rest of the route trailing off one side. This takes the middle of
 * everything the trip touches — route and flights — and a zoom from how far
 * that reaches, so a long route sits inside the view instead of running out of
 * it.
 */
function tripFraming(trip: GlobeTrip): { centre: [number, number]; spread: number } {
  const points: [number, number][] = [];
  for (const seg of trip.path ?? []) points.push(...seg);
  for (const seg of trip.flights ?? []) points.push(...seg);
  if (points.length === 0) return { centre: trip.anchor, spread: 0 };

  // Averaged as unit vectors: a plain mean of longitudes falls apart either
  // side of the date line, and a trip can straddle it.
  const toRad = Math.PI / 180;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lng, lat] of points) {
    const la = lat * toRad;
    const lo = lng * toRad;
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  const centre: [number, number] = [
    Math.atan2(y, x) / toRad,
    Math.atan2(z, Math.hypot(x, y)) / toRad,
  ];
  let spread = 0;
  for (const p of points) spread = Math.max(spread, distance(centre, p));
  return { centre, spread };
}

/**
 * A distinct colour per trip.
 *
 * The golden angle alone spreads hues nicely, but `legibleColor` then squeezes
 * saturation and lightness into a narrow band to keep every dot readable on the
 * globe — which pulled neighbouring hues back together, so a dozen trips ended
 * up with several near-identical greens and reds. Cycling saturation and
 * lightness alongside the hue puts that variation back: three bands of each,
 * out of step with the hue, so trips that land on a similar hue differ in
 * weight instead.
 */
function autoColor(i: number): [number, number, number] {
  const hue = (i * 137.508) % 360;
  const saturation = [70, 55, 84][i % 3]!;
  const lightness = [55, 42, 66][Math.floor(i / 3) % 3]!;
  return hslToRgb(hue, saturation, lightness);
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
  // Nudged into a readable range rather than flattened into one: clamping hard
  // made trips of a similar hue indistinguishable.
  const s2 = Math.min(96, Math.max(s, 48));
  const l2 = dark ? Math.min(80, Math.max(l, 50)) : Math.max(26, Math.min(l, 54));
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
