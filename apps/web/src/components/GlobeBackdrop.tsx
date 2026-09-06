import { geoInterpolate, geoOrthographic, geoPath, GeoPermissibleObjects } from 'd3-geo';
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
  solo,
  selfLocation,
}: {
  trips: Trip[];
  noTour?: boolean;
  /** One trip, framed from the first frame and replayed for as long as the
   *  slide is on screen. The onboarding has no six seconds to spend on an
   *  overview of a globe with a single route on it. */
  solo?: boolean;
  /** [lng, lat] of your own live position, when you've opted to show it here. */
  selfLocation?: [number, number] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const tripsRef = useRef(trips);
  tripsRef.current = trips;
  const noTourRef = useRef(noTour);
  noTourRef.current = noTour;
  const soloRef = useRef(solo);
  soloRef.current = solo;
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
        t.color = c ? hexToRgb(c) : autoColor(colorIdx.get(t.id) ?? 0, list.length);
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
    /** Trips still to be shown this round, shuffled. Refilled when it runs out. */
    let tourQueue: string[] = [];
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
    /**
     * Every vertex of the active trip's journey with how far into it it lies.
     *
     * A dot lights up when the light REACHES it, which is a question about
     * distance along the journey and not about distance across the map. Asking
     * the map instead lit places the route happens to pass near — a city later
     * in the trip, flared while the light was still four stops away, because a
     * flight went over it.
     */
    let journeyMarks: { p: [number, number]; d: number }[] | null = null;
    /**
     * How far into the journey a dot sits, or null if it is not on it.
     *
     * The EARLIEST point of the journey that comes near it, not the nearest
     * one. A flight arc leaving a city curves back over it, and that later
     * vertex was often the closest of the lot — so the city was only counted
     * as reached seconds after the plane had left it, and the ring arrived
     * long after the moment it was about.
     */
    const journeyDistOf = (p: [number, number]): number | null => {
      if (!journeyMarks) return null;
      let at: number | null = null;
      for (const mark of journeyMarks) {
        if (distance(mark.p, p) > 1.2) continue;
        if (at === null || mark.d < at) at = mark.d;
      }
      return at;
    };
    /** The plane's heading, eased so it never twitches. Null while on the ground. */
    let planeAngle: number | null = null;
    /**
     * Standing still at a place before moving on.
     *
     * Krakau to Praag ran straight through both, which read as passing over
     * them rather than as arriving. Long enough for the dot to throw two rings.
     */
    /**
     * Coming down somewhere: worth standing still for, two rings' worth —
     * which is the ring's own beat twice over PLUS the pause before the first
     * one. Cut to the length of the rings alone, the second never started.
     *
     * Only for a place reached by air. Overland, the light stopping at every
     * dot read as a cursor being dragged from waypoint to waypoint; the dot
     * still throws its ring, but the light goes straight on through it.
     */
    const AIR_ARRIVAL_MS = 2700;
    /**
     * A beat between the light reaching a place and the plane leaving it. Long
     * enough that the departure is its own moment, short enough that the globe
     * is not sitting there waiting for a plane to start.
     */
    const TAKEOFF_MS = 800;
    /** A layover: the plane touches down, but nobody gets off. */
    const LAYOVER_MS = 450;
    /** The end of a run, before the globe pulls back out. */
    const END_MS = 1500;
    /**
     * A beat between wheels-down and the dot's first ring.
     *
     * They used to happen in the same frame, so the ring read as part of the
     * landing rather than as the place greeting it. Only landings get it: on
     * the ground the place answers the moment the light arrives.
     */
    const FLARE_DELAY_MS = 420;
    /** How far into the journey the places you flew into sit. */
    let airMarks: number[] = [];
    /** Per dot: when its first ripple may start. */
    const flareWait = new Map<string, number>();
    let holdUntil = 0;
    let holdPoint: [number, number] | null = null;
    /** Whose journey the light is currently running, so a change can restart it. */
    let glowTripId: string | null = null;
    /**
     * A plane still in the air over a trip nobody is watching any more.
     *
     * Look away mid-flight — tap another trip, or tap nothing — and the plane
     * finishes its leg and lands. It keeps flying on its own from here, so it
     * does not matter that the light has already moved on to another journey;
     * two things are simply in the air at once, which is what would be true.
     */
    type Landing = {
      col: [number, number, number];
      a: [number, number];
      b: [number, number];
      /** How far along, and how much of that it covers per second. */
      f: number;
      rate: number;
    };
    let landing: Landing | null = null;
    /** The flight under way this frame, ready to be handed over as a landing. */
    let inFlight: Landing | null = null;
    /**
     * A dot's reaction to the light reaching it: a ripple leaving it, and the
     * swell of the dot itself while that ripple is on its way.
     */
    type Flare = { swell: number; ring: number };
    const NO_FLARE: Flare = { swell: 0, ring: -1 };
    /** Per dot: how far into its ripple it is, or -1 once it has had one. */
    const flares = new Map<string, number>();
    /** How long one ripple lasts. Two of them fit inside a DWELL. */
    const RING_S = 0.95;
    /**
     * A ripple is born at the dot's own edge at full strength and dies
     * invisible further out, so one following another has nothing to jump
     * between, and the dot swells and settles once per ripple.
     *
     * The ring used to CONTRACT as the light approached and then restart from a
     * sawtooth that fell 1 → 0 and snapped back — an arrival that flashed a few
     * times instead of throwing rings.
     */
    const flareAt = (key: string, p: [number, number], dt: number): Flare => {
      let ring = flares.get(key);
      if (ring === undefined) {
        // Reached, asked along the journey rather than across the map: a place
        // a flight merely passes over is not a place the light has got to.
        const mark = headGeo ? journeyDistOf(p) : null;
        if (mark === null || glowDist < mark) return NO_FLARE;
        // Landed, but not greeted yet: hold the ring back for a beat. A place
        // the light simply walked into gets no such pause — it answers now.
        if (airMarks.some((d) => Math.abs(d - mark) < 0.35)) {
          const readyAt = flareWait.get(key);
          if (readyAt === undefined) {
            flareWait.set(key, performance.now() + FLARE_DELAY_MS);
            return NO_FLARE;
          }
          if (performance.now() < readyAt) return NO_FLARE;
        }
        ring = 0;
      }
      if (ring < 0) {
        // Done ringing, but the light has since come to a stop here: an arc
        // comes within reach of a city before it actually lands there, so the
        // first ring can be over and done before the plane is down. While the
        // light stands at a place, that place keeps answering.
        if (holdPoint && distance(holdPoint, p) < 0.6 && performance.now() < holdUntil) ring = 0;
        else return NO_FLARE;
      }
      ring += dt / RING_S;
      // Standing at a dot keeps the ripples coming; once the light moves on the
      // one under way finishes, and that is the last of them.
      if (ring >= 1) ring = holdPoint && distance(holdPoint, p) < 0.6 ? ring - 1 : -1;
      flares.set(key, ring);
      return ring < 0 ? NO_FLARE : { swell: Math.sin(Math.PI * ring), ring };
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
      // A tap counts as watching, not as interrupting: without the second
      // condition the tour was held in its overview while the light was
      // already running the tapped trip, and the moment idling resumed a few
      // seconds later the branch below saw phase 0 and started the whole
      // journey again — the plane visibly jumped back to its airport.
      if (!idle && !selectedId) {
        phaseStart = now;
        tourPhase = 0;
      } else if (trips.length > 0) {
        const OVERVIEW_MS = 6000;
        const FOCUS_MS = 6500;
        const dur = tourPhase === 0 ? OVERVIEW_MS : FOCUS_MS;
        // A trip you tapped is framed and shown all the way through — and then
        // let go of. Holding it framed until the next tap left the globe parked
        // on one trip forever, with nothing left to watch.
        const tapped = selectedId ? trips.findIndex((t) => t.id === selectedId) : -1;
        // In "no tour" mode (onboarding) it never zooms into a trip — stays a
        // gentle overview.
        if (noTourRef.current) {
          tourPhase = 0;
        } else if (soloRef.current) {
          // One trip, shown from the first frame: a slide has no time to spend
          // six seconds on an overview first.
          tourPhase = 1;
          tourIdx = 0;
        } else if (tapped >= 0) {
          if (tourPhase !== 1 || lastFocusId !== selectedId) {
            tourPhase = 1;
            tourIdx = tapped;
            lastFocusId = selectedId;
            glowDist = 0;
            glowRuns = 0;
            holdUntil = 0;
            holdPoint = null;
            phaseStart = now;
          } else if (glowRuns >= glowRunsNeeded || now - phaseStart > dur * 5) {
            // Its journey has been travelled: release the tap and pull back out,
            // exactly as the tour's own focus ends.
            selectedId = null;
            tourPhase = 0;
            phaseStart = now;
          }
        } else if (now - phaseStart > dur) {
          if (tourPhase === 0) {
            // Entering a focus: frame the next trip (biggest first). A stale tap
            // selection is cleared so the tour can highlight this one.
            tourPhase = 1;
            // Shuffled rather than in order: the same trips in the same
            // sequence every time made the globe feel like a slideshow with a
            // fixed running order. Each round is a fresh shuffle of whatever
            // trips there are now, and it never opens with the one it just
            // closed with.
            if (tourQueue.length === 0) {
              tourQueue = trips.map((t) => t.id);
              for (let i = tourQueue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [tourQueue[i], tourQueue[j]] = [tourQueue[j]!, tourQueue[i]!];
              }
              if (tourQueue.length > 1 && tourQueue[0] === lastFocusId) {
                [tourQueue[0], tourQueue[1]] = [tourQueue[1]!, tourQueue[0]!];
              }
            }
            const nextId = tourQueue.shift()!;
            const found = trips.findIndex((t) => t.id === nextId);
            tourIdx = found >= 0 ? found : 0;
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
          // A slide moves in far enough to read the route, but not so far that
          // the sphere runs out of its box: past ~1.7 the rim leaves the frame
          // on every side and it stops looking like a globe.
          const zoom = soloRef.current ? 1.7 : Math.max(1.5, Math.min(3.4, 46 / (spread + 9)));
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

      // Dots are sized in screen pixels, so zooming in already makes them
      // smaller next to the earth. What they were not was small enough on the
      // whole world, where every trip's stops are on screen at once and they
      // crowded into each other. They grow a little with the zoom, far slower
      // than the globe does, so close up they still shrink relative to it.
      const dotScale = Math.min(1.12, 0.75 * Math.pow(scale, 0.21));

      const dark = document.documentElement.dataset.theme === 'dark';

      ctx!.beginPath();
      path({ type: 'Sphere' });
      ctx!.fillStyle = dark ? '#1a2028' : '#eadfce';
      ctx!.fill();

      ctx!.beginPath();
      path(land);
      ctx!.fillStyle = dark ? '#2d3742' : '#d8c9ad';
      ctx!.fill();

      // Where the middle of the disc is, so a flight can be lifted off the
      // surface: an orthographic point at height R sits R times as far from the
      // centre, which is the whole trick.
      const discX = w / 2;
      const discY = h / 2 + inset;
      const flightPoint = (
        p: [number, number],
        t: number,
        arcDeg: number,
      ): [number, number] | null => {
        const pr = projection(p);
        if (!pr) return null;
        const lift = flightLift(t, arcDeg);
        return [discX + (pr[0] - discX) * lift, discY + (pr[1] - discY) * lift];
      };

      // A jump longer than this within a route line is a hole the tracker left
      // rather than ground it recorded. Whether it was flown is the plan's
      // answer, not the distance's: a tunnel and a fast train leave the same
      // hole, and bowing those put aeroplanes over half of Spain.
      const FLIGHT_DEG = 6; // ~660 km
      // Except this far, which nothing on rails or roads covers in one hop.
      const INTERCONTINENTAL_DEG = 16; // ~1800 km
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
        /** Which hop of its flight this is, and how many there are — a flight
         *  with a stopover is drawn one hop after the other, not both at once. */
        hop: number;
        hops: number;
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
            flightPairs.push({
              a: seg[k - 1]!,
              b: seg[k]!,
              up: trip.upcoming,
              tripId: trip.id,
              hop: k - 1,
              hops: seg.length - 1,
            });
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
            const a = seg[i - 1]!;
            const b = seg[i]!;
            // A gap the trip's own flights already span: it has a bow of its
            // own, so the ground line stops here. Any other gap is ground
            // nobody recorded, and the line simply runs straight across it.
            const flown = (trip.flights ?? []).some((f) => {
              const start = f[0]!;
              const end = f[f.length - 1]!;
              return (
                (distance(start, a) < 1.2 && distance(end, b) < 1.2) ||
                (distance(start, b) < 1.2 && distance(end, a) < 1.2)
              );
            });
            const gap = distance(a, b);
            if (gap > FLIGHT_DEG && flown) {
              flushRun();
              run = [b];
            } else if (gap > INTERCONTINENTAL_DEG) {
              // No plan to ask, and no way to have driven it: a bow of its own,
              // with no stopovers, drawn with the trip.
              flushRun();
              flightPairs.push({
                a,
                b,
                up: trip.upcoming,
                tripId: trip.id,
                hop: 0,
                hops: 1,
              });
              airportPoints.push(a, b);
              run = [b];
            } else {
              run.push(b);
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
      for (const { a: start, b: end, tripId, hop, hops } of orderedBows) {
        if (flightCenter && (distance(flightCenter, start) > 90 || distance(flightCenter, end) > 90))
          continue;
        // Amsterdam → Keflavík → New York is drawn in that order: the trip's
        // reveal is split across its hops, so the second one only starts once
        // the first has reached its airport. Both used to grow at once, from
        // two places at the same time, which is not how you get there.
        const span = 1 / hops;
        const local = Math.max(0, Math.min(1, (tripAlpha(tripId, now) - hop * span) / span));
        if (local <= 0) continue;
        // Grey either way, but a flight belonging to a trip that has stepped
        // back fades with it — the bows used to stay as dark as they ever were,
        // which made them the loudest thing left on the globe.
        const stand = standing(tripId);
        ctx!.strokeStyle = dark
          ? `rgba(165,175,187,${0.9 * (0.3 + 0.7 * stand)})`
          : `rgba(105,115,128,${0.85 * (0.3 + 0.7 * stand)})`;
        const arc = greatCircle(start, end);
        const arcDeg = distance(start, end);
        // Drawn from the airport it leaves towards the one it lands at, rather
        // than being there in one frame: the dots arrive with the trip and the
        // bows between them used to simply exist.
        const drawn = Math.max(2, Math.round(arc.length * local));
        ctx!.beginPath();
        let pen = false;
        for (let i = 0; i < drawn; i++) {
          const sp = flightPoint(arc[i]!, i / (arc.length - 1), arcDeg);
          if (!sp) {
            // Round the back of the globe: pick the line up again on the far side.
            pen = false;
            continue;
          }
          if (pen) ctx!.lineTo(sp[0], sp[1]);
          else ctx!.moveTo(sp[0], sp[1]);
          pen = true;
        }
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

      // Group endpoints by real-world proximity (~40 km), counting DISTINCT trips
      // so a single loop trip counts once, two separate visits count two.
      // ~13 km. It was three times that, which is the distance between
      // Mulhouse and Belfort — two cities, two trips, and one dot on the globe
      // flickering between their colours because it thought they were the same
      // place. Still wide enough that one city searched twice, or a station a
      // few kilometres out of town, counts as one.
      const SAME_PLACE_DEG = 0.12;
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
      /**
       * An airport is not a place you went; the city it serves is.
       *
       * A route ends at the airport it flew out of, and photos taken while
       * waiting for the gate put a point there too — so the globe grew a dot
       * beside the city that already had one. A point within about fifty-five
       * kilometres of one of this trip's own stops is that stop.
       */
      const AIRPORT_OF_CITY_DEG = 0.5;
      const snapToStop = (
        trip: (typeof frontFacing)[number],
        p: [number, number],
      ): [number, number] => {
        let best: [number, number] | null = null;
        let bestD = AIRPORT_OF_CITY_DEG;
        for (const sp of trip.stops) {
          const d = distance(sp, p);
          if (d < bestD) {
            bestD = d;
            best = sp;
          }
        }
        return best ?? p;
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
          addEndpoint(snapToStop(trip, pt), col, trip.upcoming, isCity, trip.id);
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
        flare: Flare = NO_FLARE,
      ) => {
        const [r, g, b] = col;
        const radius = 4.5 * dpr * dotScale * (1 + 0.4 * flare.swell);
        // The ripple: it leaves the dot's edge and fades on its way out.
        if (flare.ring >= 0) {
          ctx!.beginPath();
          ctx!.arc(x, y, radius + (1.5 + 10 * flare.ring) * dpr, 0, 2 * Math.PI);
          ctx!.lineWidth = 2 * dpr * (1 - flare.ring);
          ctx!.strokeStyle = `rgba(${r},${g},${b},${0.6 * Math.pow(1 - flare.ring, 1.4)})`;
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
          const flare = flareAt(`${trip.id}:${i}`, sp, dt);
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
          const radius = 3.1 * dpr * dotScale * pop * (1 + 0.5 * flare.swell);
          ctx!.globalAlpha = baseAlpha * Math.min(1, local * 1.6);
          if (flare.ring >= 0) {
            ctx!.beginPath();
            ctx!.arc(pr[0], pr[1], radius + (1.2 + 8 * flare.ring) * dpr, 0, 2 * Math.PI);
            ctx!.lineWidth = 1.8 * dpr * (1 - flare.ring);
            ctx!.strokeStyle = `rgba(${r},${g},${b},${0.6 * Math.pow(1 - flare.ring, 1.4)})`;
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

      // Small grey dots at every flight endpoint (departure/arrival airports) so
      // the dashed bows visibly start FROM a point, not out of thin air. Smaller
      // than the trip dots, deduped by coarse endpoint — and skipped where the
      // city itself already has a dot. Budapest's airport is sixteen kilometres
      // out of town, which was enough for the city and the plane to each get
      // their own, on one trip with one stop there.
      // Every place that carries a dot of its own: the route's endpoints and
      // shared cities (`places`), AND the stops in between, which are drawn
      // from the trips themselves and were not in that list — which is why
      // checking `places` alone still left a grey dot beside half of them.
      const dotted: [number, number][] = places.map((q) => [q.lng, q.lat]);
      for (const trip of frontFacing) for (const sp of trip.stops) dotted.push(sp);
      const airportSeen = new Set<string>();
      ctx!.setLineDash([]);
      for (const ap of airportPoints) {
        const kk = key(ap);
        if (airportSeen.has(kk)) continue;
        airportSeen.add(kk);
        if (center && distance(center, ap) > 90) continue;
        if (dotted.some((q) => distance(q, ap) < AIRPORT_OF_CITY_DEG)) continue;
        const pr = projection(ap);
        if (!pr) continue;
        ctx!.beginPath();
        ctx!.arc(pr[0], pr[1], 2.6 * dpr, 0, 2 * Math.PI);
        ctx!.fillStyle = dark ? 'rgba(150,160,172,0.9)' : 'rgba(120,128,140,0.85)';
        ctx!.fill();
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
        const flare = flareAt(
          `place:${pl.lng.toFixed(2)}:${pl.lat.toFixed(2)}`,
          [pl.lng, pl.lat],
          dt,
        );
        if (m.length <= 1) {
          drawSmallDot(x, y, m[0]?.col ?? [90, 110, 225], m[0]?.upcoming ?? false, flare);
          ctx!.globalAlpha = 1;
          continue;
        }
        // While a trip is highlighted, every dot it touches holds ITS colour —
        // a city you've visited before shouldn't cycle away from the trip you're
        // looking at. Cycling resumes once nothing is highlighted.
        const held = activeId ? m.find((v) => v.id === activeId) : undefined;
        if (held) {
          drawSmallDot(x, y, held.col, held.upcoming, flare);
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
        drawSmallDot(x, y, col, m[idx]!.upcoming && m[nextIdx]!.upcoming, flare);
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

      // Every highlight starts its trip over. Tapping one used to show a light
      // frozen wherever the last run had left it, because the run counter was
      // already full; and coming back to a trip picked up mid-flight, halfway
      // across a sea, which is not where a journey begins.
      if (activeId !== glowTripId) {
        // Whatever was in the air keeps flying, on its own, to the airport it
        // was heading for. Cutting it off mid-ocean was the abrupt bit.
        if (inFlight) landing = inFlight;
        glowDist = 0;
        glowRuns = 0;
        holdUntil = 0;
        holdPoint = null;
        // Every dot gets to react again: they remember having been reached, and
        // a journey starting over has reached none of them yet.
        flares.clear();
        flareWait.clear();
        glowTripId = activeId;
      }

      inFlight = null;
      journeyMarks = null;
      if (activeId) {
        const act = trips.find((t) => t.id === activeId);
        const legs = act ? journeyLegs(act) : [];
        const total = legs.reduce((sum, leg) => sum + leg.len, 0);

        // The journey laid out as points with their distance into it, so a dot
        // can be asked how far along it sits rather than how near it looks.
        const marks: { p: [number, number]; d: number }[] = [];
        let walkedSoFar = 0;
        for (const leg of legs) {
          if (leg.kind === 'ground') {
            // A recorded route can be hundreds of points, and every dot on the
            // globe asks this list a question every frame. One in every few is
            // plenty to place a dot along a line.
            const step = Math.max(1, Math.ceil(leg.pts.length / 120));
            for (let i = 0; i < leg.pts.length; i += step) {
              marks.push({ p: leg.pts[i]!, d: walkedSoFar + leg.cum[i]! });
            }
            marks.push({
              p: leg.pts[leg.pts.length - 1]!,
              d: walkedSoFar + leg.len,
            });
          } else {
            marks.push({ p: leg.a, d: walkedSoFar });
            marks.push({ p: leg.b, d: walkedSoFar + leg.len });
          }
          walkedSoFar += leg.len;
        }
        journeyMarks = marks;

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
            // The same lifted great circle the arc is drawn along, so the
            // plane is on the line you can see rather than on a second one of
            // its own — and it flies at the same height the arc is drawn at.
            const along = geoInterpolate(leg.a, leg.b);
            const geo = along(f) as [number, number];
            const pr = flightPoint(geo, f, leg.len);
            if (!pr) return { geo, screen: null, angle: 0, flying: true, f, leg: i };
            // Heading from a step further along the same curve — the tangent of
            // a projected arc is not something to work out analytically.
            const ahead = flightPoint(along(Math.min(1, f + 0.01)) as [number, number], Math.min(1, f + 0.01), leg.len);
            const behind = flightPoint(along(Math.max(0, f - 0.01)) as [number, number], Math.max(0, f - 0.01), leg.len);
            const angle =
              ahead && behind ? Math.atan2(ahead[1] - behind[1], ahead[0] - behind[0]) : 0;
            return { geo, screen: [pr[0], pr[1]], angle, flying: true, f, leg: i };
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
          // The tail used to be long enough that the globe sat waiting for it
          // well after the plane had landed — the run is about the head, and a
          // shorter trail behind it says the same thing in less time.
          const TRAIL_DEG = Math.min(6, total * 0.22);
          // Just enough of a beat to read as two passes rather than one long
          // one; any more and the globe sits there doing nothing.
          const PAUSE = 1.2; // degrees' worth of dwell time past the end
          // Base pace, with a ceiling as well as a floor. Without the ceiling a
          // long-haul flight is dragged across the globe: the rate was set from
          // the journey's own length so that a long one would not take forever,
          // which made the longest ones move fastest of all.
          const speed = Math.min(0.14, Math.max(0.07, total / (7 * 60)));

          // Where a leg hands over to the next, and how long the light waits
          // there. A short hop out to the airport is part of arriving rather
          // than a stop of its own, so the wait goes at the end of THAT instead.
          const arrivals: { at: number; ms: number }[] = [];
          airMarks = [];
          // The last stop is an arrival too, and if the last leg flew there it
          // is a landing like any other.
          if (legs[legs.length - 1]?.kind === 'flight') airMarks.push(total);
          let walked = 0;
          // A landing followed by a hop from the airport into town is still a
          // landing: the wait belongs at the end of that hop, and so does the
          // fact that you got there by air. Without carrying it across, Kraków
          // was treated as a place you merely drove to and got a single ring.
          let carriedAir = false;
          for (let i = 0; i < legs.length - 1; i++) {
            walked += legs[i]!.len;
            if (legs[i + 1]!.len <= 0.25) {
              const hop = legs[i]!;
              if (hop.kind === 'flight' && !hop.layoverAfter) carriedAir = true;
              continue;
            }
            // Changing planes is not arriving somewhere: Keflavík on the way to
            // New York is an hour in a terminal. The plane does touch down
            // though, so it pauses for a beat rather than sailing through.
            //
            // Only a change of planes INSIDE one flight counts. "Two flights in
            // a row" also describes Krakau to Praag to Schiphol, where Praag is
            // a city you stayed in — and it was getting the layover's beat.
            const here = legs[i]!;
            const layover = here.kind === 'flight' && here.layoverAfter;
            // Landed here, and this is where you got off.
            const byAir = (here.kind === 'flight' && !layover) || carriedAir;
            carriedAir = false;
            const takingOff = legs[i + 1]!.kind === 'flight';
            if (byAir) airMarks.push(walked);
            // Overland, the light does not stop at all: it passes through the
            // dot, the dot rings, and the journey carries on.
            const ms = layover
              ? LAYOVER_MS
              : byAir
                ? AIR_ARRIVAL_MS
                : takingOff
                  ? TAKEOFF_MS
                  : 0;
            if (ms > 0) arrivals.push({ at: walked, ms });
          }

          // A journey that shows itself as it goes needs one pass, not two:
          // anything with a flight in it, or with places to stop at along the
          // way. A straight line from A to B still gets its second.
          const hasFlight = legs.some((leg) => leg.kind === 'flight');
          glowRunsNeeded = hasFlight || arrivals.length >= 2 ? 1 : glowRunsFor(total);
          // A slide keeps replaying: it is on screen for as long as you read it,
          // and a light that ran once and stopped left a still picture.
          if (soloRef.current) glowRunsNeeded = Number.POSITIVE_INFINITY;
          if (glowRuns < glowRunsNeeded && now >= holdUntil) {
            // Away from a stop and up to speed, then off it again at the next:
            // one constant rate for the whole journey read as a cursor being
            // dragged rather than as something travelling. Past the end there
            // is nothing left to arrive at, so the tail catches up at full
            // speed — easing it too was what left the globe sitting there after
            // the light had already reached the last stop.
            const legF = at(glowDist)?.f ?? 0.5;
            const pace =
              glowDist >= total ? 1.5 : 0.28 + 0.72 * Math.pow(Math.sin(Math.PI * legF), 0.55);
            const before = glowDist;
            glowDist += speed * pace * (dt * 60);
            // Arriving somewhere is worth two rings' worth of standing still.
            for (const arrival of arrivals) {
              if (before < arrival.at && glowDist >= arrival.at) {
                glowDist = arrival.at;
                holdUntil = now + arrival.ms;
                holdPoint = at(arrival.at)?.geo ?? null;
                break;
              }
            }
            // Arriving at the LAST stop is an arrival too. It was not in the
            // list (that one only holds the hand-overs between legs), so the
            // light sailed straight past the end in a single frame and the
            // final dot was never standing where the light was — it got no
            // ring at all, while every dot before it did.
            if (before < total && glowDist > total) {
              glowDist = total;
              holdUntil = now + (legs[legs.length - 1]?.kind === 'flight' ? AIR_ARRIVAL_MS : END_MS);
              holdPoint = at(total)?.geo ?? null;
            }
            if (glowDist > total + TRAIL_DEG + PAUSE) {
              // Straight into the next pass; the dwell above already happened.
              if (glowRuns + 1 < glowRunsNeeded) {
                glowDist = 0;
                flares.clear();
                flareWait.clear();
              }
              glowRuns += 1;
            }
          }
          if (now >= holdUntil) holdPoint = null;
          const [gr, gg, gb] = legibleColor(act.color, dark);

          // Where the light is now, for the dots to light up as it reaches them.
          const head = glowDist <= total ? at(glowDist) : null;
          if (head && (!center || distance(center, head.geo) <= 90)) headGeo = head.geo;
          // Keep the flight under way ready to be handed over: if you look at
          // something else in the next second, this is what carries on alone.
          const flying = legs[head?.leg ?? -1];
          if (head?.flying && flying?.kind === 'flight' && flying.len > 0) {
            inFlight = {
              col: [gr, gg, gb],
              a: flying.a,
              b: flying.b,
              f: head.f,
              // Degrees per second along this leg, as a fraction of its length.
              rate: (speed * 60) / flying.len,
            };
          }

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

      // --- A plane finishing a flight nobody is watching any more ---
      // It carries its own short contrail and lands where it was going. Drawn
      // apart from the light so it can share the sky with another trip's
      // journey: tapping trip B does not make trip A's plane disappear from
      // over the Atlantic.
      if (landing) {
        landing.f = Math.min(1, landing.f + landing.rate * dt);
        const along = geoInterpolate(landing.a, landing.b);
        const arcDeg = distance(landing.a, landing.b);
        const geo = along(landing.f) as [number, number];
        if (!center || distance(center, geo) <= 90) {
          const pr = flightPoint(geo, landing.f, arcDeg);
          if (pr) {
            // A stub of contrail behind it, so it is flying rather than sliding.
            const tail = 0.06;
            ctx!.lineCap = 'round';
            ctx!.lineWidth = 2.4 * dpr;
            for (let i = 1; i <= 6; i++) {
              const back = landing.f - (tail * i) / 6;
              const next = landing.f - (tail * (i - 1)) / 6;
              if (back < 0) break;
              const p1 = flightPoint(along(back) as [number, number], back, arcDeg);
              const p2 = flightPoint(along(next) as [number, number], next, arcDeg);
              if (!p1 || !p2) continue;
              const fade = 1 - i / 6;
              ctx!.strokeStyle = dark
                ? `rgba(186,195,205,${0.4 * fade})`
                : `rgba(128,137,148,${0.4 * fade})`;
              ctx!.beginPath();
              ctx!.moveTo(p1[0], p1[1]);
              ctx!.lineTo(p2[0], p2[1]);
              ctx!.stroke();
            }
            const aheadT = Math.min(1, landing.f + 0.01);
            const behindT = Math.max(0, landing.f - 0.01);
            const ahead = flightPoint(along(aheadT) as [number, number], aheadT, arcDeg);
            const behind = flightPoint(along(behindT) as [number, number], behindT, arcDeg);
            const angle =
              ahead && behind ? Math.atan2(ahead[1] - behind[1], ahead[0] - behind[0]) : 0;
            const ends = Math.min(landing.f, 1 - landing.f);
            drawPlane(
              ctx!,
              pr[0],
              pr[1],
              angle,
              dpr,
              dark,
              0.5 + 0.5 * Math.min(1, ends / 0.2),
              Math.min(1, ends / 0.07),
            );
          }
        }
        if (landing.f >= 1) landing = null;
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
      const showIds = soloRef.current
        ? // A slide about the route has no use for a card naming the sample
          // trip: it lands on top of the very line it is naming.
          new Set<string>()
        : noTourRef.current
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
        // The card sits still; the growth below is what carries it into place.
        const py = Math.max(margin, Math.min(projected[1] - 8 * dpr, h - ph - margin));
        if (next > 0.5) placed.push({ x: px, y: py, w: pw, h: ph });
        if (next > 0.6) labelRects.push({ id: trip.id, x: px, y: py, w: pw, h: ph });
        // Out of the dot itself: the whole card is scaled about the trip's own
        // point on the globe, so it unfolds from there and folds back into it
        // when you tap it away. Rising into place from below made it look like
        // it came from somewhere else entirely.
        const grow = 0.18 + 0.82 * next;
        ctx!.save();
        // Solid a little sooner than it is full size, or the name is still
        // half-transparent by the time it has finished growing.
        ctx!.globalAlpha = Math.min(1, next * 1.5);
        ctx!.translate(projected[0], projected[1]);
        ctx!.scale(grow, grow);
        ctx!.translate(-projected[0], -projected[1]);
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

    /**
     * The loop runs only while somebody can see it.
     *
     * A frame here is a full redraw: coastlines reprojected, every route
     * re-stroked, every label measured and placed. It is the most expensive
     * thing this app does per second, and on a slow phone it was doing it
     * while scrolled far down the trips list, and while the app sat in the
     * background. Nothing about the animation changes - it picks up exactly
     * where it stopped, and `dt` is clamped, so the sweep does not jump.
     */
    let onScreen = true;
    let awake = document.visibilityState !== 'hidden';
    const sync = () => {
      if (onScreen && awake) {
        if (raf) return;
        lastFrame = performance.now();
        raf = requestAnimationFrame(draw);
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
    // The globe scrolls with the page, so a long trips list leaves it behind.
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        sync();
      },
      // A little early on either side: it is already turning by the time it
      // comes back into view, never caught standing still.
      { rootMargin: '120px' },
    );
    io.observe(canvas);
    sync();

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
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
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
  | {
      kind: 'flight';
      a: [number, number];
      b: [number, number];
      len: number;
      /**
       * True when this hop ends at a layover — an airport inside one flight's
       * itinerary, where you change planes. Praag on a Krakau–Praag–Schiphol
       * trip is NOT one of these: it is three separate flights with a stay in
       * between, and the difference is whether the two hops came out of the
       * same itinerary or out of two different stops.
       */
      layoverAfter: boolean;
    };

/** Two points count as the same place when handing one leg over to the next. */
const LEG_JOIN_DEG = 0.8;
/** A hole in a journey wider than this was crossed by air, not by road. */
const FLY_GAP_DEG = 3.5;

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
      const gap = distance(from, to);
      if (gap > FLY_GAP_DEG) {
        // A hole this wide was flown. A city trip's way home is one such hole
        // (the last photo in Rome, then home): bridging it on the ground sent a
        // coloured light gliding back across Europe where a plane belongs.
        out.push({ kind: 'flight', a: from, b: to, len: gap, layoverAfter: false });
      } else if (gap > 0.05) {
        out.push(groundLeg([from, to]));
      }
    }
    out.push(leg);
  }
  return out;
}

/**
 * A flight's path, as points on the sphere.
 *
 * The route itself is the great circle between the two airports — the way the
 * plane went. It used to be a quadratic curve drawn in screen space, bulging to
 * whichever side the maths landed on, which turning the globe eventually
 * flipped across the line in one frame, and which the travelling light copied
 * imperfectly, giving two different arcs between the same two cities.
 */
function greatCircle(a: [number, number], b: [number, number]): [number, number][] {
  const along = geoInterpolate(a, b);
  const steps = Math.max(16, Math.min(64, Math.round(distance(a, b) * 1.4)));
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) points.push(along(i / steps) as [number, number]);
  return points;
}

/**
 * How high above the surface a flight flies, at `t` along its leg.
 *
 * A great circle drawn flat on an orthographic globe is nearly a straight line,
 * which is honest and reads as nothing at all: the flights stopped looking like
 * flights. So the arc is lifted off the surface, highest in the middle, and the
 * projection does the rest — an orthographic point at radius R sits R times as
 * far from the centre of the disc, so height turns into exactly the bow you
 * would see looking at a real one from space. It cannot flip, because there is
 * no side to it: it is up.
 *
 * Longer flights climb higher, the way they do.
 */
function flightLift(t: number, arcDeg: number): number {
  return 1 + (0.05 + 0.13 * Math.min(1, arcDeg / 70)) * Math.sin(Math.PI * t);
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
          ordered.push({
            kind: 'flight',
            a,
            b,
            len: distance(a, b),
            layoverAfter: i < leg.points.length - 1,
          });
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
      legs.push({
        kind: 'flight',
        a,
        b,
        len: distance(a, b),
        layoverAfter: i < itinerary.length - 1,
      });
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
 * The golden angle is the right answer when you do not know how many there
 * will be, but here you do — and for a known count, spreading the hues evenly
 * puts the most possible distance between any two of them. The golden angle was
 * handing near-identical hues to trips that happened to land two apart, which
 * showed up exactly where it hurts: two routes over the same road, in the same
 * colour.
 *
 * `legibleColor` then squeezes saturation and lightness into a narrow band to
 * keep every dot readable on the globe, which pulls neighbouring hues back
 * together again. Cycling saturation and lightness alongside the hue puts that
 * variation back: three bands of each, out of step with the hue, so trips that
 * still land close in hue differ in weight instead.
 */
function autoColor(i: number, count: number): [number, number, number] {
  // Alternating halves of the wheel, so consecutive trips are opposite rather
  // than neighbours — and a trip added later does not reshuffle the rest.
  const step = 360 / Math.max(1, count);
  const hue = (i * step + (i % 2 ? 180 : 0) + 18) % 360;
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
