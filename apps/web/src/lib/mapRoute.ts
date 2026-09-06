import maplibregl, { Map as MapLibreMap } from './mapgl';
import { paintMarker } from '../components/Flag';
import { buildLegs, flightArc, haversineKm, StopPoint, trimOutlierEnds } from './arc';

/**
 * Everything both maps draw the same way.
 *
 * The trip page's map and a share link's map used to be two drawings of one
 * route, and they drifted: the shared one put a straight coloured line across
 * every gap in the track, knew nothing about flights, and left the plan off
 * altogether. This is that drawing, once, so a link you send someone shows the
 * map the app shows.
 */

/** A single-hop jump longer than this in a route line is a hole the tracker
 *  left, whatever it was that made it. */
export const FLIGHT_KM = 400;

/**
 * And this far is a hole nothing on the ground could have made.
 *
 * The plan says which legs were flown, and that is the answer wherever there is
 * one. This is the backstop for a trip with no plan at all: no train or car
 * covers eighteen hundred kilometres in a single unrecorded hop, so that one
 * gets its arc without being asked.
 */
const INTERCONTINENTAL_KM = 1800;

/**
 * Was this leg part of a journey that was actually recorded?
 *
 * The question used to be asked of the corridor between A and B, which was
 * wrong twice over. A recorded route rarely follows the straight line — it
 * goes round the mountain, takes the ferry, sits on a train through Denmark —
 * so a leg that really was travelled kept its planned line drawn over the top.
 * And where a real gap DID exist, that same test could still call it covered.
 *
 * What matters is the ends. If there are real fixes at both stops, the drawn
 * route already runs from one to the other (a straight hop where the tracker
 * was off, the real shape where it was on), and a second line over it says
 * nothing. If one end has nothing — tracking switched on a day after leaving
 * home — the route never reaches it, and the planned line is the only thing
 * that shows where you came from.
 */
export function legIsRecorded(
  from: [number, number],
  to: [number, number],
  points: [number, number][],
): boolean {
  // Flat approximation in kilometres — legs are short enough for this, and it
  // keeps the check to plain arithmetic per point.
  const ky = 110.57;
  const kx = 111.32 * Math.cos((((from[1] + to[1]) / 2) * Math.PI) / 180);
  const distKm = (a: [number, number], b: [number, number]) =>
    Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky);
  // City-sized: a fix anywhere in or around the place counts as "you were
  // here", and on a long leg a little more slack, because a stop's coordinate
  // is the city centre and the station may be well outside it. The ceiling used
  // to be 35 km, which is smaller than that slack was ever allowed to grow —
  // and on a leg drawn over the rails it left the planned line lying on top of
  // the route that had just replaced it.
  const reachKm = Math.min(60, Math.max(12, distKm(from, to) * 0.12));

  let atFrom = false;
  let atTo = false;
  for (const point of points) {
    if (!atFrom && distKm(point, from) <= reachKm) atFrom = true;
    if (!atTo && distKm(point, to) <= reachKm) atTo = true;
    if (atFrom && atTo) return true;
  }
  return false;
}

/** Where the plan says a flight happened, as pairs of end coordinates. */
export function flightEndpoints(stops: StopPoint[]): { from: [number, number]; to: [number, number] }[] {
  return buildLegs(stops)
    .filter((leg) => leg.isFlight)
    .map((leg) => {
      const c = (leg.feature.geometry as GeoJSON.LineString).coordinates as [number, number][];
      return { from: c[0]!, to: c[c.length - 1]! };
    });
}

/**
 * The recorded line, cut into the bits that were actually travelled on the
 * ground and the jumps between them.
 *
 * A tracker leaves a gap whenever it was off, and a flight leaves the biggest
 * gap of all. Drawn as one line, every one of those is a straight coloured
 * stripe across the map that says a journey happened where none was recorded.
 *
 * What bridges the gap depends on the plan, not on its length. Only a leg the
 * route itself calls a flight gets an arc; a high-speed train through a tunnel
 * leaves the same three-hundred-kilometre hole in the track and is still a
 * journey over the ground, so it gets a straight dashed line instead of a bow
 * over Spain.
 */
export function splitTrack(
  coords: [number, number][],
  isFlightHop: (a: [number, number], b: [number, number]) => boolean,
): { ground: [number, number][][]; gaps: [number, number][][]; flights: [number, number][][] } {
  const ground: [number, number][][] = [];
  const gaps: [number, number][][] = [];
  const flights: [number, number][][] = [];
  let run: [number, number][] = coords.length ? [coords[0]!] : [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const km = haversineKm(a, b);
    const explicit = isFlightHop(a, b);
    if (km > FLIGHT_KM || explicit) {
      if (run.length >= 2) ground.push(run);
      // A flight the plan knows about already has its arc drawn over it. A hole
      // too big to be anything but a flight gets one here. Everything else is
      // ground that nobody recorded: shown as it is, straight and dashed, so
      // the line still runs from one end to the other.
      if (explicit) {
        // Nothing: the plan draws this one.
      } else if (km > INTERCONTINENTAL_KM) {
        flights.push(flightArc(a, b));
      } else {
        gaps.push([a, b]);
      }
      run = [b];
    } else {
      run.push(b);
    }
  }
  if (run.length >= 2) ground.push(run);
  return { ground, gaps, flights };
}

/** The recorded track of one traveller, ready to draw. */
export function groundRuns(
  coords: [number, number][],
  stops: StopPoint[],
): {
  ground: [number, number][][];
  gaps: [number, number][][];
  flights: [number, number][][];
  trimmed: [number, number][];
} {
  // Trim a few stray home snaps (before leaving / after returning) so the route
  // doesn't run a long line from home to the first real stop.
  const trimmed = trimOutlierEnds(coords);
  const ends = flightEndpoints(stops);
  const near = (a: [number, number], b: [number, number]) => haversineKm(a, b) <= 250;
  const isFlightHop = (a: [number, number], b: [number, number]) =>
    ends.some((f) => (near(a, f.from) && near(b, f.to)) || (near(a, f.to) && near(b, f.from)));
  return { ...splitTrack(trimmed, isFlightHop), trimmed };
}

/** Route legs are the line between places, not places themselves. */
const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

/** Roughly 55 km — Schiphol to Amsterdam, Budapest to Ferihegy. */
const AIRPORT_OF_CITY_KM = 55;

export interface PlannedStopsResult {
  /** Every marker put on the map, for the caller to take off again. */
  markers: maplibregl.Marker[];
  /** The ground track of each flight, for the arc overlay to paint. */
  tracks: [number, number][][];
}

/**
 * The plan on the map: a pin per place, and a line to each one that nothing
 * recorded. Legs still to come are dashed; legs already travelled are solid.
 */
export function drawPlannedStops(
  map: MapLibreMap,
  {
    stops,
    realPoints,
    gapColour,
    onStopClick,
  }: {
    stops: StopPoint[];
    /** Every fix and photo actually on the map, to measure a leg against. */
    realPoints: [number, number][];
    gapColour: string;
    onStopClick?: (stop: StopPoint) => void;
  },
): PlannedStopsResult {
  const markers: maplibregl.Marker[] = [];
  const tracks: [number, number][][] = [];

  for (const layerId of map.getLayersOrder().filter((l) => l.startsWith('leg-'))) {
    map.removeLayer(layerId);
  }
  for (const sourceId of Object.keys(map.getStyle().sources).filter((s) => s.startsWith('leg-'))) {
    map.removeSource(sourceId);
  }

  /**
   * One line, nothing under it.
   *
   * A planned leg used to be drawn twice: the dashes, and a wide blurred dark
   * copy beneath them meant to keep beige readable over satellite imagery.
   * What it actually read as was a shadow the line was casting.
   */
  const addPlannedGround = (id: string, width: number, dash: [number, number] | null) => {
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: {
        'line-color': gapColour,
        'line-width': width,
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
      layout: { 'line-cap': 'round' },
    });
  };

  /**
   * A dash means "still to come".
   *
   * The planned line is a guess either way, but a leg whose day has been and
   * gone was actually travelled — drawing it as a plan made a finished trip
   * look like it never happened.
   */
  const todayKey = new Date().toISOString().slice(0, 10);
  const isFuture = (day?: string | null): boolean => !!day && day.slice(0, 10) > todayKey;
  const stopById = new Map(stops.map((s) => [s.id, s]));

  // Markers only for real places (cities); a standalone heen-/terugreis leg may
  // carry an origin/destination coordinate (for its km) but is NOT a place.
  //
  // And one pin per place, not per visit. A city you pass through four times —
  // Amsterdam on the way to every train — is four stops at the same coordinate,
  // and four pins stacked on the exact same pixel took it in turns to be the
  // one on top, which reads as a marker flickering between colours.
  const placeSeen = new Set<string>();
  for (const stop of stops) {
    if (stop.latitude === null || stop.longitude === null) continue;
    if (LEG_NAMES.has(stop.name)) continue;
    // Three decimals is about a hundred metres: the same place, not a
    // neighbouring one.
    const placeKey = `${stop.latitude.toFixed(3)},${stop.longitude.toFixed(3)}`;
    if (placeSeen.has(placeKey)) continue;
    placeSeen.add(placeKey);
    const el = document.createElement('div');
    // A day trip is a place you visited, but not a stop on the route — a
    // smaller marker keeps the itinerary readable.
    el.className = stop.parentStopId ? 'stop-marker stop-marker-day' : 'stop-marker';
    paintMarker(el, stop.countryCode, stop.orderIndex + 1);
    if (onStopClick) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onStopClick(stop);
      });
    }
    markers.push(
      new maplibregl.Marker({ element: el }).setLngLat([stop.longitude, stop.latitude]).addTo(map),
    );
  }

  // Airports a flight touches get a small grey dot, so an arc visibly starts
  // and ends somewhere — but only where the city itself has not already put a
  // pin there.
  const airportSeen = new Set<string>();
  const pinned = stops.filter(
    (s): s is StopPoint & { latitude: number; longitude: number } =>
      s.latitude !== null && s.longitude !== null,
  );
  for (const leg of buildLegs(stops)) {
    if (!leg.isFlight) continue;
    const coords = (leg.feature.geometry as GeoJSON.LineString).coordinates as [number, number][];
    for (const point of [coords[0], coords[coords.length - 1]]) {
      if (!point) continue;
      const key = `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
      if (airportSeen.has(key)) continue;
      airportSeen.add(key);
      if (pinned.some((s) => haversineKm([s.longitude, s.latitude], point) <= AIRPORT_OF_CITY_KM)) {
        continue;
      }
      const el = document.createElement('div');
      el.className = 'airport-marker';
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(point).addTo(map));
    }
  }

  // Day trips as a spur off the stop you slept at — dropped as soon as the real
  // data covers that drive, exactly like the planned ground legs.
  for (const stop of stops) {
    if (!stop.parentStopId || stop.latitude === null || stop.longitude === null) continue;
    const parent = stopById.get(stop.parentStopId);
    if (!parent || parent.latitude === null || parent.longitude === null) continue;
    const from: [number, number] = [parent.longitude, parent.latitude];
    const to: [number, number] = [stop.longitude, stop.latitude];
    if (legIsRecorded(from, to, realPoints)) continue;
    const id = `leg-day-${stop.id}`;
    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [from, to] },
      },
    });
    // A spur, not a leg of the route: thinner than the line it hangs off.
    addPlannedGround(id, 2, isFuture(stop.dayTripDate ?? stop.arrivalDate) ? [1.4, 2.6] : null);
  }

  // Legs. Flights are deduped by coarse endpoints so a there-and-back on the
  // same route draws one dashed line, not two overlapping ones that fill each
  // other's gaps and read as solid.
  const seenFlights = new Set<string>();
  const roundPt = (c: number) => Math.round(c / 0.8);
  for (const leg of buildLegs(stops)) {
    const legCoords = (leg.feature.geometry as GeoJSON.LineString).coordinates as [number, number][];
    // A planned ground leg only survives where nothing recorded the way for
    // real. Flight arcs always show — they're never in the tracked ground line,
    // and they bridge the gap it leaves open.
    if (!leg.isFlight && legIsRecorded(legCoords[0]!, legCoords[legCoords.length - 1]!, realPoints)) {
      continue;
    }
    if (leg.isFlight) {
      const a = legCoords[0]!;
      const b = legCoords[legCoords.length - 1]!;
      const key = [`${roundPt(a[0])},${roundPt(a[1])}`, `${roundPt(b[0])},${roundPt(b[1])}`]
        .sort()
        .join('|');
      if (seenFlights.has(key)) continue;
      seenFlights.add(key);
    }
    const id = `leg-${leg.id}`;
    // A leg is the arrival at its stop, so that stop's date is the day it was
    // travelled.
    const future = isFuture(stopById.get(leg.id)?.arrivalDate);
    if (leg.isFlight) {
      // Nothing on the map itself: a line layer is draped over the surface, and
      // a flight is in the air. Its hops go to the canvas overlay.
      if (leg.hops) tracks.push(...leg.hops);
    } else {
      map.addSource(id, { type: 'geojson', data: leg.feature });
      // The recorded route's own width (2.5): a planned leg and a walked one
      // are the same journey, and only the dashes should say which.
      addPlannedGround(id, 2.5, future ? [2, 2] : null);
    }
  }

  return { markers, tracks };
}

export interface ArcOverlay {
  /** The ground track of every flight to paint, in geographic coordinates. */
  setTracks(tracks: [number, number][][]): void;
  redraw(): void;
  destroy(): void;
}

/**
 * The flights, painted over the map rather than onto it.
 *
 * MapLibre drapes a line layer over the surface, so a "bowed" flight is a line
 * that curves ALONG the ground. A flight is in the air, so the track is
 * projected to the screen each frame and lifted off it, exactly the way the
 * home globe does it.
 */
export function createArcOverlay(map: MapLibreMap, container: HTMLElement): ArcOverlay {
  const canvas = document.createElement('canvas');
  canvas.className = 'trip-map-arcs';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  let tracks: [number, number][][] = [];

  const draw = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // A light grey dashed line, and nothing else: the halo under it was meant
    // to hold the line together over a pale satellite map and mostly made it
    // look smudged.
    ctx.lineCap = 'round';
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(206, 214, 224, 0.92)';

    for (const track of tracks) {
      if (track.length < 2) continue;
      const pts = track.map((p) => map.project(p));
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      if (!Number.isFinite(chord) || chord < 4) continue;
      // Perpendicular to the chord, always the one pointing up the screen.
      let nx = -(b.y - a.y) / chord;
      let ny = (b.x - a.x) / chord;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      // How far apart they are on the ground decides how high it climbs; the
      // cap keeps a long-haul arc from leaving the top of the screen.
      const spanKm = haversineKm(track[0]!, track[track.length - 1]!);
      const climb = Math.min(chord * (0.1 + 0.22 * Math.min(1, spanKm / 8000)), h * 0.42);

      const lifted = pts.map((p, i) => {
        const k = climb * Math.sin((Math.PI * i) / (pts.length - 1));
        return { x: p.x + nx * k, y: p.y + ny * k };
      });
      // A point the projection cannot place comes back as NaN, and one NaN in a
      // path takes the whole path with it.
      const ok = lifted.map((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      // Round the back of a turned globe a point projects to the far side of
      // the canvas, and a line across it looks like a fold.
      const steps: number[] = [];
      for (let i = 1; i < lifted.length; i++) {
        steps.push(Math.hypot(lifted[i]!.x - lifted[i - 1]!.x, lifted[i]!.y - lifted[i - 1]!.y));
      }
      const finite = steps.filter((v) => Number.isFinite(v)).sort((p, q) => p - q);
      const typical = finite[Math.floor(finite.length / 2)] ?? 0;
      const breakAt = Math.max(typical * 8, 60);

      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < lifted.length; i++) {
        if (!ok[i]) {
          pen = false;
          continue;
        }
        if (i > 0 && (!ok[i - 1] || steps[i - 1]! > breakAt)) pen = false;
        if (pen) ctx.lineTo(lifted[i]!.x, lifted[i]!.y);
        else ctx.moveTo(lifted[i]!.x, lifted[i]!.y);
        pen = true;
      }
      ctx.stroke();
    }
  };

  // Repainted with the map: `render` fires for every frame of a pan, a zoom and
  // the globe's own easing, which is exactly when the arcs have moved.
  map.on('render', draw);
  const ro = new ResizeObserver(draw);
  ro.observe(container);
  draw();

  return {
    setTracks(next) {
      tracks = next;
      draw();
    },
    redraw: draw,
    destroy() {
      map.off('render', draw);
      ro.disconnect();
      canvas.remove();
    },
  };
}
