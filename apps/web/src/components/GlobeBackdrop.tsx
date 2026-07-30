import { geoOrthographic, geoPath, GeoPermissibleObjects } from 'd3-geo';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as topojson from 'topojson-client';
// Low-res land outline bundled locally (no CDN); ~110m resolution.
import land110m from 'world-atlas/land-110m.json';
import type { Trip } from '../api/types';
import { airportByCode } from '../lib/airports';
import { getDefaultAirports, getGlobeStops, type GlobeStopsMode } from '../lib/prefs';
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
  /** Every planned stop with coordinates, in travel order. */
  stops: [number, number][];
  /** The legs in travel order, when the server knows them. */
  journey: { flight: boolean; points: [number, number][] }[] | null;
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
    /** Last zoom level the wordmark was told about. */
    let lastToldScale = 1;
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
          stops: t.stopPoints ?? [],
          journey: t.journey && t.journey.length > 0 ? t.journey : null,
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
    /**
     * How far the globe has committed to one trip: 0 = every trip equal, 1 =
     * one highlighted and the rest receded. Eased, so the others fade back
     * instead of dimming between two frames.
     */
    let focus = 0;
    /** The trip the others receded behind — kept while they come back, or the
     *  moment nothing is highlighted they would snap to full colour. */
    let recedeId: string | null = null;
    /** Per trip: how much of its chain of stop dots is out (0–1). */
    const stopReveal = new Map<string, number>();
    /** Where the travelling light is right now, for the dots to react to. */
    let headGeo: [number, number] | null = null;
    /** The plane's heading, eased so it never twitches. Null while on the ground. */
    let planeAngle: number | null = null;
    /**
     * Standing still at a place before moving on.
     *
     * Krakau to Praag ran straight through both, which read as passing over
     * them rather than as arriving. Long enough for the dot to throw two rings.
     */
    const DWELL_MS = 1900;
    let holdUntil = 0;
    let holdSince = 0;
    let holdPoint: [number, number] | null = null;
    /** Falls 1 → 0 twice over a wait, which is what makes the two rings. */
    let holdPulse = 0;
    /** Per dot: how brightly it is still lit after the light went past. */
    const flares = new Map<string, number>();
    /**
     * How lit a dot is, given where the light is. Rises the moment the light
     * arrives and decays on its own, so a dot flares and dims behind it rather
     * than pulsing symmetrically as it passes.
     */
    const flareAt = (key: string, p: [number, number], dt: number): number => {
      // A dot the light is waiting at pulses instead of sitting lit: the head
      // is not moving, so proximity alone would hold it at one brightness.
      if (holdPoint && distance(holdPoint, p) < 0.6) {
        flares.set(key, holdPulse);
        return holdPulse;
      }
      const near = headGeo ? Math.max(0, 1 - distance(headGeo, p) / 2.6) : 0;
      const lit = Math.max((flares.get(key) ?? 0) * Math.pow(0.05, dt), near * near);
      if (lit < 0.004) flares.delete(key);
      else flares.set(key, lit);
      return lit;
    };
    let stopsMode = getGlobeStops();
    const onStopsMode = (e: Event) => {
      stopsMode = (e as CustomEvent<GlobeStopsMode>).detail;
    };
    window.addEventListener('mms-globe-stops', onStopsMode);

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
    // The latitude that sits at the centre of the sphere. Below the routes'
    // own latitude on purpose, so Europe reads as the top half of a globe
    // rather than the middle of a disc — but close enough that the routes are
    // not pinned against the upper edge.
    const CENTER_LAT = 38;

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
            // A wait belongs to the trip that was being shown, not to the next.
            holdUntil = 0;
            holdPoint = null;
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

      // The wordmark's compass needle is driven by the zoom: most of two turns
      // per unit of scale, in whichever direction the globe is going. Announced
      // rather than called, because the mark is a sibling in another component
      // and the globe has no business holding a ref to it. Only on a real
      // change, so a still globe is silent.
      //
      // The threshold is what the needle's smoothness costs: at 420° per unit
      // of scale, the old 0.015 meant reports 6° apart, and a spring settling
      // asymptotically hands those over slower and slower — so the last stretch
      // ticked over like a seconds hand instead of gliding to a stop. A twelfth
      // of a degree is below noticing, and a still globe still says nothing.
      if (Math.abs(scale - lastToldScale) > 0.0002) {
        lastToldScale = scale;
        window.dispatchEvent(new CustomEvent('mms-globe-scale', { detail: scale }));
      }

      // The "active" trip: on the homepage that's the trip you tapped, else the
      // one the auto-tour is framing. Resolved before anything is drawn, because
      // every line and dot on the globe is painted relative to it.
      const activeId = noTourRef.current
        ? null
        : selectedId ??
          (idle && tourPhase === 1 ? trips[Math.min(tourIdx, trips.length - 1)]?.id ?? null : null);

      // Everything that is not the highlighted trip steps back, so the one being
      // shown is the one you look at. Eased frame-rate independently, so it is a
      // movement on any device.
      //
      // Which trip the others stepped back FOR is remembered past the moment it
      // stops being highlighted: reading `activeId` here meant the way back was
      // no fade at all — every other trip returned to full colour in one frame
      // while `focus` was still easing down behind it.
      if (activeId) recedeId = activeId;
      focus += ((activeId ? 1 : 0) - focus) * (1 - Math.pow(0.004, dt));
      if (focus < 0.002) recedeId = null;
      /** How much of its own colour a trip keeps this frame. */
      const standing = (id: string) => (recedeId && id !== recedeId ? 1 - focus : 1);

      // Trips overlap where you took the same road twice. Painted biggest-first
      // otherwise, which put the highlighted trip underneath whichever trip
      // happened to be longer; it goes last so it ends up on top.
      const painted = activeId
        ? [...trips].sort(
            (a, b) => (a.id === activeId ? 1 : 0) - (b.id === activeId ? 1 : 0),
          )
        : trips;

      // Radius fits the SHORTER side, so the sphere is as big as it can be
      // without ever being clipped left/right or top/bottom.
      // Nudged down and in by a hair, so the top of the sphere sits under the
      // top of the screen instead of running off it. The bottom loses the same
      // amount, where the fade eats it anyway.
      const inset = 10 * dpr;
      const radius = Math.min(w, h) / 2 - 2 * dpr - inset;
      projection
        .scale(radius * scale)
        .translate([w / 2, h / 2 + inset])
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
      const flightPairs: {
        a: [number, number];
        b: [number, number];
        up: boolean;
        /** Whose flight it is, so it can step back with the rest of its trip. */
        tripId: string;
      }[] = [];
      // Every point a flight touches, layovers included — they get a grey
      // airport dot, unlike the coloured dots reserved for real destinations.
      const airportPoints: [number, number][] = [];
      for (const trip of painted) {
        const stand = standing(trip.id);
        const [r, g, b] = recede(legibleColor(trip.color, dark), dark, 1 - stand);
        for (const seg of trip.flights ?? []) {
          // A flight is stored as its whole itinerary; bow each hop so a
          // stopover visibly breaks the line at that airport.
          for (let k = 1; k < seg.length; k++) {
            flightPairs.push({ a: seg[k - 1]!, b: seg[k]!, up: trip.upcoming, tripId: trip.id });
          }
          for (const p of seg) airportPoints.push(p);
        }
        if (!trip.path) continue;

        ctx!.globalAlpha = tripAlpha(trip.id, now) * (0.34 + 0.66 * stand);
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
              flightPairs.push({ a: seg[i - 1]!, b: seg[i]!, up: trip.upcoming, tripId: trip.id });
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
      const key = (p: [number, number]) => `${Math.round(p[0] / 1.2)},${Math.round(p[1] / 1.2)}`;
      // Deduped keeping the most present version: a hop two trips share must not
      // step back because the copy that happened to come first belongs to a trip
      // nobody is looking at.
      const bows = new Map<string, (typeof flightPairs)[number]>();
      for (const pair of flightPairs) {
        const k = [key(pair.a), key(pair.b)].sort().join('|');
        const held = bows.get(k);
        if (!held || standing(pair.tripId) > standing(held.tripId)) bows.set(k, pair);
      }
      ctx!.lineWidth = 1.2 * dpr;
      ctx!.setLineDash([2 * dpr, 5 * dpr]);
      // Faded ones first, so a highlighted trip's bow lies over the rest where
      // two flights share a stretch of sky.
      const orderedBows = [...bows.values()].sort(
        (a, b) => standing(a.tripId) - standing(b.tripId),
      );
      for (const { a: start, b: end, tripId } of orderedBows) {
        if (flightCenter && (distance(flightCenter, start) > 90 || distance(flightCenter, end) > 90))
          continue;
        // Grey either way, but a flight belonging to a trip that has stepped
        // back fades with it — the bows used to stay as dark as they ever were,
        // which made them the loudest thing left on the globe.
        const stand = standing(tripId);
        ctx!.strokeStyle = dark
          ? `rgba(165,175,187,${0.9 * (0.3 + 0.7 * stand)})`
          : `rgba(105,115,128,${0.85 * (0.3 + 0.7 * stand)})`;
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
        /** Reveal progress: 0 while the trip is still arriving on the globe. */
        alpha: number;
        /** 1 = full colour, 0 = fully receded behind a highlighted trip. */
        stand: number;
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
        const stand = standing(tripId);
        const g = places.find((q) => distance([q.lng, q.lat], p) < SAME_PLACE_DEG);
        if (g) {
          if (!g.trips.has(tripId)) {
            g.trips.add(tripId);
            g.members.push({ id: tripId, col, upcoming, alpha, stand });
          }
          g.city = g.city || city;
        } else {
          places.push({
            lng: p[0],
            lat: p[1],
            city,
            trips: new Set([tripId]),
            members: [{ id: tripId, col, upcoming, alpha, stand }],
          });
        }
      };
      for (const trip of frontFacing) {
        const col = recede(legibleColor(trip.color, dark), dark, 1 - standing(trip.id));
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
        const col = recede(legibleColor(trip.color, dark), dark, 1 - standing(trip.id));
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
                stand: standing(trip.id),
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
        lit = 0,
      ) => {
        const [r, g, b] = col;
        const radius = 4.5 * dpr * (1 + 0.45 * lit);
        // A ring thrown off as the light arrives, widening as it fades.
        if (lit > 0.01) {
          ctx!.beginPath();
          ctx!.arc(x, y, radius + (2 + 9 * (1 - lit)) * dpr, 0, 2 * Math.PI);
          ctx!.lineWidth = 2 * dpr * lit;
          ctx!.strokeStyle = `rgba(${r},${g},${b},${0.55 * lit})`;
          ctx!.stroke();
        }
        ctx!.beginPath();
        ctx!.arc(x, y, radius, 0, 2 * Math.PI);
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

      // --- The places in between ---
      // Every stop the plan names gets its own small dot, so a trip reads as a
      // string of places instead of a line with two ends. They arrive one after
      // another in travel order and leave the same way: a whole itinerary
      // appearing in one frame read as noise rather than as a route.
      const STEP = 0.06; // progress between one dot starting and the next
      const WINDOW = 0.45; // how much of the progress axis a single dot takes
      for (const trip of painted) {
        if (trip.stops.length === 0) continue;
        const want = trip.id === activeId || stopsMode === 'always' ? 1 : 0;
        const cur = stopReveal.get(trip.id) ?? 0;
        // Quicker to appear than to leave: the dots coming out answer a tap,
        // while their going is only tidying up after one.
        const reveal = cur + (want - cur) * (1 - Math.pow(want > cur ? 0.03 : 0.12, dt));
        stopReveal.set(trip.id, reveal);
        if (reveal < 0.012) continue;

        const col = recede(legibleColor(trip.color, dark), dark, 1 - standing(trip.id));
        const axis = (trip.stops.length - 1) * STEP + WINDOW;
        const head = reveal * axis;
        // A dot is opaque: stepping back is done with the colour alone. Fading
        // it instead left the route lines showing straight through the dots.
        const baseAlpha = tripAlpha(trip.id, now);
        for (let i = 0; i < trip.stops.length; i++) {
          const sp = trip.stops[i]!;
          // Lights up as the travelling light reaches it, then dims behind it.
          // Read before anything can skip the dot, so one that turned out of
          // sight while lit is not still lit when it comes back round.
          const lit = flareAt(`${trip.id}:${i}`, sp, dt);
          // A stop that already carries a full-size dot — a route end, or a city
          // two trips share — would only be drawn underneath it.
          if (places.some((q) => distance([q.lng, q.lat], sp) < SAME_PLACE_DEG)) continue;
          if (center && distance(center, sp) > 90) continue;
          const pr = projection(sp);
          if (!pr) continue;
          const local = Math.max(0, Math.min(1, (head - i * STEP) / WINDOW));
          if (local <= 0) continue;
          // Ease-out-back: it overshoots a touch and settles, so a dot lands
          // rather than simply being there.
          const k = local - 1;
          const pop = 1 + 2.3 * k * k * k + 1.5 * k * k;
          const [r, g, b] = col;
          const radius = 3.1 * dpr * pop * (1 + 0.55 * lit);
          ctx!.globalAlpha = baseAlpha * Math.min(1, local * 1.6);
          if (lit > 0.01) {
            ctx!.beginPath();
            ctx!.arc(pr[0], pr[1], radius + (2 + 7 * (1 - lit)) * dpr, 0, 2 * Math.PI);
            ctx!.lineWidth = 1.8 * dpr * lit;
            ctx!.strokeStyle = `rgba(${r},${g},${b},${0.55 * lit})`;
            ctx!.stroke();
          }
          ctx!.beginPath();
          ctx!.arc(pr[0], pr[1], radius, 0, 2 * Math.PI);
          ctx!.fillStyle = `rgb(${r},${g},${b})`;
          ctx!.fill();
          ctx!.lineWidth = 1.1 * dpr;
          ctx!.strokeStyle = dark ? 'rgba(20,25,32,0.65)' : 'rgba(255,255,255,0.9)';
          ctx!.stroke();
        }
        ctx!.globalAlpha = 1;
      }

      for (const pl of places) {
        const projected = projection([pl.lng, pl.lat]);
        if (!projected) continue;
        const [x, y] = projected;
        const m = pl.members;
        // A place shared by several trips is as visible as its most-arrived one.
        // Stepping back is the colour's job, not the alpha's: a see-through dot
        // showed the route lines running underneath it.
        ctx!.globalAlpha = Math.max(...m.map((v) => v.alpha), 0);
        // Keyed on where it is in the world, not on the screen: the globe turns,
        // and a key that turned with it would forget the flare every frame.
        const lit = flareAt(`place:${pl.lng.toFixed(2)}:${pl.lat.toFixed(2)}`, [pl.lng, pl.lat], dt);
        if (m.length <= 1) {
          drawSmallDot(x, y, m[0]?.col ?? [90, 110, 225], m[0]?.upcoming ?? false, lit);
          ctx!.globalAlpha = 1;
          continue;
        }
        // While a trip is highlighted, every dot it touches holds ITS colour —
        // a city you've visited before shouldn't cycle away from the trip you're
        // looking at. Cycling resumes once nothing is highlighted.
        const held = activeId ? m.find((v) => v.id === activeId) : undefined;
        if (held) {
          drawSmallDot(x, y, held.col, held.upcoming, lit);
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
        drawSmallDot(x, y, col, m[idx]!.upcoming && m[nextIdx]!.upcoming, lit);
        ctx!.globalAlpha = 1;
      }

      // --- The active trip, travelled ---
      // One head of light runs the WHOLE journey in order: a ribbon of light
      // along the ground legs, a small plane along each flight bow, and a flare
      // on every dot it reaches. Brightest at its head, fading out along its
      // tail, and moving at a CONSTANT speed measured in degrees, so a long
      // route's light isn't faster than a short one.
      //
      // The route and the flights arrive as two separate lists, so the order is
      // recovered by chaining leg endpoints (see journeyLegs). A trip that is
      // nothing but flights — Eindhoven, Krakau, Praag, Schiphol — used to have
      // no route at all and fell through to the city-trip halo, which lit one of
      // its three places and ignored the rest.
      headGeo = null;
      if (activeId) {
        const act = trips.find((t) => t.id === activeId);
        const legs = act ? journeyLegs(act) : [];
        const total = legs.reduce((sum, leg) => sum + leg.len, 0);

        /** The drawn bow between two airports, so the light can follow it. */
        const bowOf = (a: [number, number], b: [number, number]) => {
          const A = projection(a);
          const B = projection(b);
          if (!A || !B) return null;
          const dx = B[0] - A[0];
          const dy = B[1] - A[1];
          const len = Math.hypot(dx, dy);
          if (len < 2) return null;
          const off = Math.min(len * 0.22, 70 * dpr);
          let px = dy / len;
          let py = -dx / len;
          if (py > 0) {
            px = -px;
            py = -py;
          }
          return {
            A: A as [number, number],
            B: B as [number, number],
            C: [(A[0] + B[0]) / 2 + px * off, (A[1] + B[1]) / 2 + py * off] as [number, number],
          };
        };

        /**
         * Where the head is, `d` degrees into the journey: on the ground a point
         * on the line, in the air a point along the bow that is actually drawn —
         * a light running the straight line under an arc reads as a mistake.
         */
        const at = (
          d: number,
        ): {
          geo: [number, number];
          screen: [number, number] | null;
          angle: number;
          flying: boolean;
          /** How far into this leg, 0 at the gate it left, 1 at the one it reaches. */
          f: number;
          leg: number;
        } | null => {
          const want = Math.max(0, Math.min(total, d));
          let acc = 0;
          for (let i = 0; i < legs.length; i++) {
            const leg = legs[i]!;
            if (want > acc + leg.len && i < legs.length - 1) {
              acc += leg.len;
              continue;
            }
            const f = leg.len > 0 ? Math.max(0, Math.min(1, (want - acc) / leg.len)) : 0;
            if (leg.kind === 'ground') {
              const along = f * leg.len;
              let k = 0;
              while (k < leg.cum.length - 1 && leg.cum[k + 1]! < along) k++;
              const a = leg.pts[k]!;
              const b = leg.pts[k + 1] ?? a;
              const span = (leg.cum[k + 1] ?? leg.cum[k]!) - leg.cum[k]!;
              const g = span > 0 ? (along - leg.cum[k]!) / span : 0;
              const geo: [number, number] = [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
              const pr = projection(geo);
              return {
                geo,
                screen: pr ? [pr[0], pr[1]] : null,
                angle: 0,
                flying: false,
                f,
                leg: i,
              };
            }
            // Straight in geographic terms (good enough to know WHERE it is and
            // which dot it is arriving at), curved on screen (what you see).
            const geo: [number, number] = [
              leg.a[0] + (leg.b[0] - leg.a[0]) * f,
              leg.a[1] + (leg.b[1] - leg.a[1]) * f,
            ];
            const bow = bowOf(leg.a, leg.b);
            if (!bow) return { geo, screen: null, angle: 0, flying: true, f, leg: i };
            const u = 1 - f;
            const screen: [number, number] = [
              u * u * bow.A[0] + 2 * u * f * bow.C[0] + f * f * bow.B[0],
              u * u * bow.A[1] + 2 * u * f * bow.C[1] + f * f * bow.B[1],
            ];
            const tx = 2 * u * (bow.C[0] - bow.A[0]) + 2 * f * (bow.B[0] - bow.C[0]);
            const ty = 2 * u * (bow.C[1] - bow.A[1]) + 2 * f * (bow.B[1] - bow.C[1]);
            return { geo, screen, angle: Math.atan2(ty, tx), flying: true, f, leg: i };
          }
          return null;
        };

        // A journey needs some length before a light can visibly travel it.
        // Below that (a city trip: one place, barely any line) it would be a
        // flickering speck, so those get a pulsing halo instead.
        const RIBBON_MIN_DEG = 1.2;
        if (act && legs.length > 0 && total > RIBBON_MIN_DEG) {
          // A run is over once the TAIL has arrived too, not just the head —
          // otherwise the globe zooms out through the light's own trail. Then a
          // short dwell before the next pass; looping instantly feels frantic.
          const TRAIL_DEG = Math.min(11, total * 0.4);
          // Just enough of a beat to read as two passes rather than one long
          // one; any more and the globe sits there doing nothing.
          const PAUSE = 2.5; // degrees' worth of dwell time past the end
          // Base pace. A route long enough that one pass would take forever is
          // capped to a few seconds instead.
          const speed = Math.max(0.07, total / (5 * 60));

          // Where a leg hands over to the next, and the light is worth holding.
          // A short hop out to the airport is part of arriving rather than a
          // stop of its own, so the wait goes at the end of THAT instead.
          const arrivals: number[] = [];
          let walked = 0;
          for (let i = 0; i < legs.length - 1; i++) {
            walked += legs[i]!.len;
            if (legs[i + 1]!.len > 0.25) arrivals.push(walked);
          }

          // A journey that stops along the way already shows itself as it goes,
          // so one pass is enough; a straight line from A to B gets its second.
          glowRunsNeeded = arrivals.length >= 2 ? 1 : glowRunsFor(total);
          if (glowRuns < glowRunsNeeded && now >= holdUntil) {
            // Away from a stop and up to speed, then off it again at the next:
            // one constant rate for the whole journey read as a cursor being
            // dragged rather than as something travelling.
            const legF = at(glowDist)?.f ?? 0.5;
            const pace = 0.28 + 0.72 * Math.pow(Math.sin(Math.PI * legF), 0.55);
            const before = glowDist;
            glowDist += speed * pace * (dt * 60);
            // Arriving somewhere is worth two rings' worth of standing still.
            for (const arrival of arrivals) {
              if (before < arrival && glowDist >= arrival) {
                glowDist = arrival;
                holdUntil = now + DWELL_MS;
                holdSince = now;
                holdPoint = at(arrival)?.geo ?? null;
                break;
              }
            }
            if (glowDist > total + TRAIL_DEG + PAUSE) {
              // Straight into the next pass; the dwell above already happened.
              glowDist = glowRuns + 1 < glowRunsNeeded ? 0 : glowDist;
              glowRuns += 1;
            }
          }
          // The dot it is waiting at throws a ring, twice, while it waits.
          holdPulse =
            now < holdUntil ? 1 - (((now - holdSince) / DWELL_MS) * 2) % 1 : 0;
          if (now >= holdUntil) holdPoint = null;
          const [gr, gg, gb] = legibleColor(act.color, dark);

          // Where the light is now, for the dots to light up as it reaches them.
          const head = glowDist <= total ? at(glowDist) : null;
          if (head && (!center || distance(center, head.geo) <= 90)) headGeo = head.geo;

          // Sample the ribbon head → tail. A sample whose distance is
          // negative (or past the end) is simply dropped, so the ribbon slides
          // on and off the route instead of wrapping around in one jump.
          const STEPS = 28;
          const samples: { pt: [number, number]; t: number; flying: boolean }[] = [];
          for (let i = 0; i <= STEPS; i++) {
            const t = i / STEPS; // 0 = head, 1 = tail
            const d = glowDist - TRAIL_DEG * t;
            if (d < 0 || d > total) continue;
            const sample = at(d);
            if (!sample || !sample.screen) continue;
            if (center && distance(center, sample.geo) > 90) continue;
            samples.push({ pt: sample.screen, t, flying: sample.flying });
          }

          ctx!.lineCap = 'round';
          ctx!.lineJoin = 'round';
          // Behind a plane the trail is a contrail, so it goes grey and thin:
          // it is exhaust, not the trip's own colour, and the plane is what you
          // are meant to be watching. On the ground the light IS the thing
          // moving, so there it keeps the trip's colour and its brightness.
          const CONTRAIL: [number, number, number] = dark ? [186, 195, 205] : [128, 137, 148];
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
              const [cr, cg, cb] = b.flying ? CONTRAIL : [gr, gg, gb];
              const weight = b.flying ? 0.45 : 1;
              ctx!.strokeStyle = `rgba(${cr},${cg},${cb},${pass.peak * fade * weight})`;
              ctx!.beginPath();
              ctx!.moveTo(a.pt[0], a.pt[1]);
              ctx!.lineTo(b.pt[0], b.pt[1]);
              ctx!.stroke();
            }
          }

          // In the air, the head of the light IS a plane, flying the bow it
          // drew. It hands back over to the ribbon the moment it lands.
          if (head?.flying && head.screen && (!center || distance(center, head.geo) <= 90)) {
            // The heading is smoothed across frames: taken straight from the
            // curve's tangent it twitched, because the camera is easing under
            // the plane at the same time as the plane moves along the bow.
            const target = head.angle;
            if (planeAngle === null) planeAngle = target;
            else {
              // Shortest way round, so passing ±180° is not most of a turn.
              const delta = ((target - planeAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
              planeAngle += delta * (1 - Math.pow(0.0001, dt));
            }
            // Climbs away and settles onto the runway: small at both gates,
            // full size in the cruise between them. It fades over the same
            // stretch, because a plane that simply stopped existing at the gate
            // was the ugliest moment of the whole thing.
            const ends = Math.min(head.f, 1 - head.f);
            const lift = 0.5 + 0.5 * Math.min(1, ends / 0.2);
            const alpha = Math.min(1, ends / 0.07);
            drawPlane(ctx!, head.screen[0], head.screen[1], planeAngle, dpr, dark, lift, alpha);
          } else if (!head?.flying) {
            planeAngle = null;
          }
        } else if (act) {
          // A city trip has no route to run a light along, so the place itself
          // is what gets highlighted. Two rings a beat apart, each easing out
          // as it widens and thins — a single expanding circle read as a blip,
          // and a bare halo read as nothing at all.
          glowRunsNeeded = 2;
          if (now - phaseStart > 5400) glowRuns = glowRunsNeeded;
          const spot = act.path?.[0]?.[0] ?? act.anchor;
          if (!center || distance(center, spot) <= 90) {
            const pr = projection(spot);
            if (pr) {
              const [gr, gg, gb] = legibleColor(act.color, dark);
              const [x, y] = pr;
              // Slow enough to watch a ring widen rather than register that one
              // went past.
              const PERIOD = 2800;

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
          targetScale = Math.min(MAX_ZOOM, Math.max(1, targetScale * (pinchDist() / pinchStart)));
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
      targetScale = Math.min(MAX_ZOOM, Math.max(1, targetScale * (1 - e.deltaY * 0.0015)));
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
      window.removeEventListener('mms-globe-stops', onStopsMode);
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

/** One leg of a journey: a stretch on the ground, or one hop through the air. */
type Leg =
  | { kind: 'ground'; pts: [number, number][]; cum: number[]; len: number }
  | { kind: 'flight'; a: [number, number]; b: [number, number]; len: number };

/** Two points count as the same place when handing one leg over to the next. */
const LEG_JOIN_DEG = 0.8;

/**
 * How far in you can pinch. The auto-tour never goes past ~3.4, so this is
 * about looking at a city yourself. The land outline is a 1:110M coastline and
 * does get blocky up here; the routes are what you are actually zooming in on.
 */
const MAX_ZOOM = 12;

/**
 * Closes the gaps between legs, so the light never jumps.
 *
 * A flight leaves from an airport and the leg before it ended in a town centre
 * ten kilometres away — small on a world map, a visible teleport once the globe
 * has zoomed in on the trip. The gap becomes a short leg of its own, which the
 * light travels like any other.
 */
function stitch(legs: Leg[]): Leg[] {
  const startOf = (l: Leg) => (l.kind === 'ground' ? l.pts[0]! : l.a);
  const endOf = (l: Leg) => (l.kind === 'ground' ? l.pts[l.pts.length - 1]! : l.b);
  const out: Leg[] = [];
  for (const leg of legs) {
    const prev = out[out.length - 1];
    if (prev) {
      const from = endOf(prev);
      const to = startOf(leg);
      if (distance(from, to) > 0.05) out.push(groundLeg([from, to]));
    }
    out.push(leg);
  }
  return out;
}

/** A stretch on the ground, with the distance to each vertex measured out. */
function groundLeg(pts: [number, number][]): Leg {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1]! + distance(pts[i - 1]!, pts[i]!));
  }
  return { kind: 'ground', pts, cum, len: cum[cum.length - 1]! };
}

/**
 * A trip as one journey, in the order it was travelled.
 *
 * The API hands over the ground route and the flights as two separate lists,
 * each in order but with no record of how they interleave. They do not need
 * one: a leg starts where the one before it ended, so the chain can be laid out
 * by matching endpoints. The first leg is the one nothing else ends at.
 *
 * Greedy, and it always consumes every leg — a trip whose pieces do not quite
 * meet still gets shown, just in its best-guess order.
 */
function journeyLegs(trip: GlobeTrip): Leg[] {
  // When the server sent the order, take it: it walked the stops in order and
  // knows, where matching endpoints only guesses. A flight whose arrival
  // airport was left blank ends at the city rather than at the airport, and
  // that is exactly the kind of gap that put the plane on the wrong leg.
  if (trip.journey) {
    const ordered: Leg[] = [];
    for (const leg of trip.journey) {
      if (leg.flight) {
        // Each hop on its own: a layover is a place the plane lands, and the
        // light should touch it rather than fly straight over it.
        for (let i = 1; i < leg.points.length; i++) {
          const a = leg.points[i - 1]!;
          const b = leg.points[i]!;
          ordered.push({ kind: 'flight', a, b, len: distance(a, b) });
        }
        continue;
      }
      if (leg.points.length < 2) continue;
      ordered.push(groundLeg(leg.points));
    }
    return stitch(ordered);
  }

  const legs: Leg[] = [];
  for (const seg of trip.path ?? []) {
    if (seg.length < 2) continue;
    legs.push(groundLeg(seg));
  }
  for (const itinerary of trip.flights ?? []) {
    // Each hop separately: a layover is a place the plane lands, and the light
    // should touch it rather than fly straight over it.
    for (let i = 1; i < itinerary.length; i++) {
      const a = itinerary[i - 1]!;
      const b = itinerary[i]!;
      legs.push({ kind: 'flight', a, b, len: distance(a, b) });
    }
  }
  if (legs.length <= 1) return legs;

  const startOf = (l: Leg) => (l.kind === 'ground' ? l.pts[0]! : l.a);
  const endOf = (l: Leg) => (l.kind === 'ground' ? l.pts[l.pts.length - 1]! : l.b);

  const rest = [...legs];
  let firstIdx = rest.findIndex((leg) =>
    rest.every((other) => other === leg || distance(endOf(other), startOf(leg)) > LEG_JOIN_DEG),
  );
  if (firstIdx < 0) firstIdx = 0;
  const chain: Leg[] = [rest.splice(firstIdx, 1)[0]!];
  while (rest.length > 0) {
    const tail = endOf(chain[chain.length - 1]!);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = distance(tail, startOf(rest[i]!));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    chain.push(rest.splice(best, 1)[0]!);
  }
  return stitch(chain);
}

/**
 * A small plane, nose along `angle`.
 *
 * Grey and flat on purpose: at fifteen pixels a silhouette reads as a plane
 * where a shaded model reads as a smudge, and the coloured ribbon behind it is
 * already carrying the trip's identity. A soft shadow underneath lifts it off
 * the globe so it looks like it is flying over the map rather than printed on
 * it.
 */
function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  dpr: number,
  dark: boolean,
  size = 1,
  alpha = 1,
): void {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Just enough shadow to sit above the map rather than be printed on it. An
  // outline around it read as a sticker, and the halo it used to carry was
  // brighter than the plane.
  ctx.shadowColor = 'rgba(10,14,20,0.3)';
  ctx.shadowBlur = 3.5 * dpr;
  ctx.shadowOffsetY = 1.2 * dpr;
  planeShape(ctx, 8 * dpr * size);
  ctx.fillStyle = dark ? '#cdd5de' : '#79838f';
  ctx.fill();
  ctx.restore();
}

/** Airliner outline in units of `s` (half its length), nose at +x. */
function planeShape(ctx: CanvasRenderingContext2D, s: number): void {
  // Half the silhouette, nose to tail; the other half is the mirror of it.
  const half: [number, number][] = [
    [1, 0],
    [0.55, 0.13],
    [0.12, 0.14],
    [-0.06, 0.86],
    [-0.3, 0.86],
    [-0.28, 0.14],
    [-0.72, 0.13],
    [-0.8, 0.46],
    [-0.97, 0.46],
    [-1, 0.05],
  ];
  ctx.beginPath();
  ctx.moveTo(s, 0);
  for (const [px, py] of half) ctx.lineTo(px * s, py * s);
  for (let i = half.length - 1; i >= 0; i--) {
    const [px, py] = half[i]!;
    ctx.lineTo(px * s, -py * s);
  }
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

/**
 * A colour stepping back behind a highlighted trip.
 *
 * Only the colour goes: most of the saturation drains and the lightness moves
 * toward the globe's own surface, so the route is still there and still legible
 * — it has simply stopped competing. `f` is how far back, 0 to 1.
 */
function recede(
  rgb: [number, number, number],
  dark: boolean,
  f: number,
): [number, number, number] {
  if (f <= 0.001) return rgb;
  const [h, s, l] = rgbToHsl(rgb);
  const target = dark ? 46 : 58;
  return hslToRgb(h, s * (1 - 0.72 * f), l + (target - l) * 0.6 * f);
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
