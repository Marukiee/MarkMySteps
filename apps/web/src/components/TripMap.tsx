import maplibregl, { LngLatBounds, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBlobUrl } from '../api/client';
import type { LiveFix } from '../api/types';
import { getMapStyle, getMapStyleId } from '../lib/prefs';
import { setDarkBackdrop } from '../lib/native';
import type { MediaItem, RouteCollection } from '../api/types';
import { buildLegs, flightArc, haversineKm, StopPoint, trimOutlierEnds } from '../lib/arc';
import { colorForUser, formatDate, formatDateRange } from '../lib/colors';
import { useNow } from '../lib/lastSeen';
import './tripmap.css';
import { paintMarker } from './Flag';

/** A single-hop jump longer than this in a route line is treated as a flight. */
const FLIGHT_KM = 400;

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
function legIsRecorded(
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
  // is the city centre and the station may be well outside it.
  const reachKm = Math.min(35, Math.max(12, distKm(from, to) * 0.12));

  let atFrom = false;
  let atTo = false;
  for (const point of points) {
    if (!atFrom && distKm(point, from) <= reachKm) atFrom = true;
    if (!atTo && distKm(point, to) <= reachKm) atTo = true;
    if (atFrom && atTo) return true;
  }
  return false;
}

export interface Waypoint {
  id: string;
  latitude: number;
  longitude: number;
}

interface TripMapProps {
  routes: RouteCollection | null;
  media: MediaItem[];
  stops?: StopPoint[];
  waypoints?: Waypoint[];
  onWaypointDelete?: (id: string) => void;
  visibleUsers: Set<string>;
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  /** Long-press / right-click on the map (used to snap a straight gap to roads). */
  onLongPress?: (lngLat: { lng: number; lat: number }) => void;
  onPhotoOpen?: (mediaId: string) => void;
  onPhotoFocus?: (mediaId: string) => void;
  clickMode?: boolean;
  styleUrl: string | StyleSpecification;
  /** Live device location, shown as a Google-Maps-style dot. */
  currentLocation?: { lat: number; lng: number } | null;
  /** Hide photo markers (e.g. "show only tracked locations" mode). */
  hidePhotos?: boolean;
  /** Latest fix per travelling member — drawn as live avatar markers. */
  liveFixes?: LiveFix[];
  /** The current user's id (their own live dot is the pulsing "me" marker). */
  selfUserId?: string;
  /** Exposes an imperative focus API once the map is ready. */
  onReady?: (api: TripMapApi) => void;
  /** Tapping your own live dot (opens today's recorded points). */
  onSelfClick?: () => void;
  /**
   * Whether a change of data may reframe the camera. Off while the map is
   * showing a single day: the caller has already framed that day, and fitting
   * the trip's own bounds would zoom straight back out to the whole trip.
   */
  autoFit?: boolean;
}

export interface TripMapApi {
  /** Ease the camera to fit the given [lng,lat] points (e.g. a day's photos). */
  focusOn: (coords: [number, number][]) => void;
  /** How many pixels at the bottom of the canvas are hidden behind the sheet,
   *  so the camera centres on what you can actually see. */
  setHiddenBottom: (px: number) => void;
  /** Ease the camera to a single point (e.g. a searched planner place). */
  flyTo: (lng: number, lat: number, zoom?: number) => void;
  /** Frame the whole trip again, as it was when the page opened. */
  resetView: () => void;
  /**
   * Runs a light along the drawn route, the way the home globe lights a trip
   * up when you pick it. Used when a single day is switched on: the map has
   * just become a different, much shorter line, and the light says which one.
   */
  glowRoutes: () => void;
}

export function TripMap({
  routes,
  media,
  stops,
  waypoints,
  onWaypointDelete,
  visibleUsers,
  onMapClick,
  onLongPress,
  onPhotoOpen,
  onPhotoFocus,
  clickMode,
  styleUrl,
  currentLocation,
  hidePhotos,
  liveFixes,
  selfUserId,
  onReady,
  autoFit = true,
  onSelfClick,
}: TripMapProps) {
  // Read from a marker listener that is only attached once.
  const onSelfClickRef = useRef(onSelfClick);
  onSelfClickRef.current = onSelfClick;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const arcCanvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * The ground track of every flight on show, in geographic coordinates.
   *
   * The arc itself is not a line on the map. MapLibre drapes a line layer over
   * the surface, so on a globe a "bowed" flight is a line that curves ALONG
   * the ground — which is what it looked like. A flight is in the air, so it
   * is drawn over the map instead: the track is projected to the screen each
   * frame and lifted off it, exactly the way the home globe does it.
   */
  const flightTracksRef = useRef<[number, number][][]>([]);
  /** Photo markers by cluster cell, so a redraw can keep what has not moved. */
  const photoMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const photoTimersRef = useRef<number[]>([]);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  /** The one open stop label, and the timer that is taking it away again. */
  const stopPopupRef = useRef<maplibregl.Popup | null>(null);
  const stopPopupTimersRef = useRef<number[]>([]);
  const waypointMarkersRef = useRef<maplibregl.Marker[]>([]);
  const meMarkerRef = useRef<maplibregl.Marker | null>(null);
  /** The bounds that framed the whole trip, for resetView. */
  const wholeTripRef = useRef<LngLatBounds | null>(null);
  /** The route lines as last drawn, so the glow can trace exactly those. */
  const glowLinesRef = useRef<[number, number][][]>([]);
  /** Whether a data change may move the camera. Off while a day is framed. */
  const autoFitRef = useRef(true);
  autoFitRef.current = autoFit;
  const liveMarkersRef = useRef<maplibregl.Marker[]>([]);
  // Cache thumbnail object-URLs by media id so re-clustering on zoom reuses the
  // loaded image instead of flashing the empty placeholder white.
  const thumbCacheRef = useRef<Map<string, string>>(new Map());
  // Ages on the live markers are relative, so they need their own clock.
  const liveTick = useNow(5_000);
  const waypointDeleteRef = useRef(onWaypointDelete);
  waypointDeleteRef.current = onWaypointDelete;

  /**
   * Takes the open stop label away.
   *
   * MapLibre's own popup drops out of the DOM the instant it is closed, which
   * is why the label used to vanish rather than leave. So the element gets a
   * class, plays its exit, and is only then removed — each removal on its own
   * timer, so closing one while opening the next can't strand either of them.
   */
  const closeStopPopup = (immediate = false): void => {
    const popup = stopPopupRef.current;
    stopPopupRef.current = null;
    if (!popup) return;
    const el = popup.getElement();
    if (immediate || !el) {
      popup.remove();
      return;
    }
    el.classList.add('closing');
    const timer = window.setTimeout(() => {
      popup.remove();
      stopPopupTimersRef.current = stopPopupTimersRef.current.filter((t) => t !== timer);
    }, 200);
    stopPopupTimersRef.current.push(timer);
  };

  /** The label above a stop: its name, when you were there, and a way out. */
  const openStopPopup = (map: MapLibreMap, stop: StopPoint): void => {
    closeStopPopup();
    const body = document.createElement('div');
    body.className = 'stop-popup-body';

    const name = document.createElement('strong');
    name.className = 'stop-popup-name';
    name.textContent = stop.name;
    body.appendChild(name);

    const day = stop.dayTripDate ?? stop.arrivalDate;
    const when = stop.parentStopId
      ? `Dagtrip · ${formatDate(day)}`
      : stop.arrivalDate.slice(0, 10) === stop.departureDate.slice(0, 10)
        ? formatDate(stop.arrivalDate)
        : formatDateRange(stop.arrivalDate, stop.departureDate);
    if (when) {
      const meta = document.createElement('span');
      meta.className = 'stop-popup-meta';
      meta.textContent = when;
      body.appendChild(meta);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'stop-popup-close';
    close.setAttribute('aria-label', 'Sluiten');
    close.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeStopPopup();
    });
    body.appendChild(close);

    stopPopupRef.current = new maplibregl.Popup({
      offset: 20,
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      className: 'stop-popup',
      maxWidth: '230px',
    })
      .setLngLat([stop.longitude!, stop.latitude!])
      .setDOMContent(body)
      .addTo(map);
  };
  const loadedRef = useRef(false);
  /** Pixels of canvas hidden behind the bottom sheet — every camera move has to
   *  compensate, including the automatic "frame the whole trip" below. */
  const hiddenBottomRef = useRef(0);
  // Bumped after a live theme swap re-loads the style, so the layer-adding
  // effects re-run and re-add their sources (setStyle wipes them).
  const [themeVersion, setThemeVersion] = useState(0);
  const clickHandlerRef = useRef(onMapClick);
  clickHandlerRef.current = onMapClick;
  const longPressRef = useRef(onLongPress);
  longPressRef.current = onLongPress;
  const photoOpenRef = useRef(onPhotoOpen);
  photoOpenRef.current = onPhotoOpen;
  const photoFocusRef = useRef(onPhotoFocus);
  photoFocusRef.current = onPhotoFocus;

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [4.9, 52.37],
      zoom: 3,
      attributionControl: { compact: true },
    });
    map.on('style.load', () => {
      // Globe projection: zoomed out shows a 3D globe, zooming in eases to a
      // flat map — MapLibre handles the transition natively.
      map.setProjection({ type: 'globe' });
    });
    map.on('load', () => {
      loadedRef.current = true;
      // Trigger a re-render pass by dispatching a resize; route effect below
      // re-runs when props change, and reads loadedRef.
      map.resize();
    });
    map.on('click', (e) => {
      closeStopPopup();
      clickHandlerRef.current?.(e.lngLat);
    });
    // Right-click (desktop) + long-press (touch) → onLongPress at that point.
    map.on('contextmenu', (e) => longPressRef.current?.(e.lngLat));
    const container = containerRef.current;
    let lpTimer = 0;
    let lpStart: { x: number; y: number } | null = null;
    const cancelLp = () => {
      window.clearTimeout(lpTimer);
      lpStart = null;
    };
    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length !== 1) return cancelLp();
      const t = ev.touches[0]!;
      lpStart = { x: t.clientX, y: t.clientY };
      lpTimer = window.setTimeout(() => {
        const rect = container.getBoundingClientRect();
        const p = map.unproject([t.clientX - rect.left, t.clientY - rect.top]);
        longPressRef.current?.({ lng: p.lng, lat: p.lat });
      }, 600);
    };
    const onTouchMove = (ev: TouchEvent) => {
      if (!lpStart) return;
      const t = ev.touches[0]!;
      if (Math.hypot(t.clientX - lpStart.x, t.clientY - lpStart.y) > 10) cancelLp();
    };
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', cancelLp);
    container.addEventListener('touchcancel', cancelLp);
    mapRef.current = map;

    // The mobile panel clips the bottom of a fixed-height canvas, so the
    // canvas centre is NOT the centre of what's on screen. Everything that
    // moves the camera compensates with this.
    const camPadding = () => ({
      top: 50,
      bottom: 50 + hiddenBottomRef.current,
      left: 50,
      right: 50,
    });

    onReady?.({
      focusOn: (coords) => {
        if (coords.length === 0) return;
        const b = new LngLatBounds();
        for (const c of coords) b.extend(c);
        map.fitBounds(b, { padding: camPadding(), maxZoom: 12, duration: 700 });
      },
      flyTo: (lng, lat, zoom = 8) =>
        map.easeTo({
          center: [lng, lat],
          zoom,
          padding: { top: 0, bottom: hiddenBottomRef.current, left: 0, right: 0 },
          duration: 700,
        }),
      setHiddenBottom: (px) => {
        hiddenBottomRef.current = Math.max(0, Math.round(px));
      },
      resetView: () => {
        const bounds = wholeTripRef.current;
        if (!bounds) return;
        map.fitBounds(bounds, { padding: camPadding(), maxZoom: 13, duration: 700 });
      },
      glowRoutes: () => runGlow(map, glowLinesRef.current),
    });

    // Keep the canvas matched to its container. The bottom-sheet layout
    // resizes this panel (fixed height, sheet sliding over it); without this
    // the GL canvas keeps its initial size and renders as a thin sliver.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', cancelLp);
      container.removeEventListener('touchcancel', cancelLp);
      for (const timer of stopPopupTimersRef.current) window.clearTimeout(timer);
      stopPopupTimersRef.current = [];
      stopPopupRef.current = null;
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Satellite imagery is dark whatever the app theme is, and the map runs up
  // under the transparent status bar — so its icons have to go light or they
  // vanish into the aerial photo.
  useEffect(() => {
    const apply = () => setDarkBackdrop(getMapStyleId() === 'satellite');
    apply();
    window.addEventListener('mms-theme', apply);
    return () => {
      window.removeEventListener('mms-theme', apply);
      setDarkBackdrop(false);
    };
  }, [styleUrl]);

  // Follow the app's light/dark theme live: swap the map style, then re-add the
  // route/stop layers once the new style has loaded.
  useEffect(() => {
    const onTheme = () => {
      const map = mapRef.current;
      if (!map) return;
      loadedRef.current = false;
      map.setStyle(getMapStyle());
      map.once('style.load', () => {
        map.setProjection({ type: 'globe' });
        loadedRef.current = true;
        setThemeVersion((v) => v + 1);
      });
    };
    window.addEventListener('mms-theme', onTheme);
    return () => window.removeEventListener('mms-theme', onTheme);
  }, []);

  // Draw routes whenever data or filters change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Flight legs (from the planned stops) — used to cut the tracked/photo line
    // exactly where a flight happens, so a flight is never a straight coloured
    // line (the arc represents it) and long ground legs stay connected.
    const flightEndpoints = buildLegs(stops ?? [])
      .filter((l) => l.isFlight)
      .map((l) => {
        const c = (l.feature.geometry as GeoJSON.LineString).coordinates as [number, number][];
        return { from: c[0]!, to: c[c.length - 1]! };
      });

    const apply = () => {
      // A light still running belongs to the line that is about to be replaced.
      stopGlow(map);
      // Remove previous route layers/sources.
      for (const layerId of map.getLayersOrder().filter((l) => l.startsWith('route-'))) {
        map.removeLayer(layerId);
      }
      for (const sourceId of Object.keys(map.getStyle().sources).filter((s) =>
        s.startsWith('route-'),
      )) {
        map.removeSource(sourceId);
      }

      const bounds = new LngLatBounds();
      let hasPoints = false;
      const glowLines: [number, number][][] = [];

      const near = (a: [number, number], b: [number, number]) => haversineKm(a, b) <= 250;
      const isExplicitFlight = (a: [number, number], b: [number, number]) =>
        flightEndpoints.some(
          (f) => (near(a, f.from) && near(b, f.to)) || (near(a, f.to) && near(b, f.from)),
        );

      for (const feature of routes?.features ?? []) {
        const { userId } = feature.properties;
        if (!visibleUsers.has(userId)) continue;
        const id = `route-${userId}`;
        // Trim a few stray home snaps (before leaving / after returning) so the
        // route doesn't run a long line from home to the first real stop.
        const coords = trimOutlierEnds(feature.geometry.coordinates as [number, number][]);

        // Split into ground runs; a break is an explicit flight or a big jump.
        // Big unmarked jumps (e.g. photos NL→Rome) become dashed flight arcs so
        // they never read as a straight coloured line.
        const ground: [number, number][][] = [];
        const implicitFlights: [number, number][][] = [];
        let run: [number, number][] = coords.length ? [coords[0]!] : [];
        for (let i = 1; i < coords.length; i++) {
          const a = coords[i - 1]!;
          const b = coords[i]!;
          const longJump = haversineKm(a, b) > FLIGHT_KM;
          const explicit = isExplicitFlight(a, b);
          if (longJump || explicit) {
            if (run.length >= 2) ground.push(run);
            if (longJump && !explicit) implicitFlights.push(flightArc(a, b));
            run = [b];
          } else {
            run.push(b);
          }
        }
        if (run.length >= 2) ground.push(run);

        glowLines.push(...ground);
        map.addSource(id, {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: ground }, properties: {} },
        });
        map.addLayer({
          id: `${id}-line`,
          type: 'line',
          source: id,
          paint: { 'line-color': colorForUser(userId), 'line-width': 2.5 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });

        if (implicitFlights.length > 0) {
          const fid = `route-${userId}-flights`;
          map.addSource(fid, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: { type: 'MultiLineString', coordinates: implicitFlights },
              properties: {},
            },
          });
          map.addLayer({
            id: `${fid}-line`,
            type: 'line',
            source: fid,
            // Dashed like every other flight: the arc is drawn, not recorded.
            paint: { 'line-color': '#8a94a3', 'line-width': 2, 'line-dasharray': [1.4, 2.6] },
            layout: { 'line-cap': 'round' },
          });
        }

        for (const coordinate of coords) {
          bounds.extend(coordinate);
          hasPoints = true;
        }
      }

      glowLinesRef.current = glowLines;

      for (const item of media) {
        if (item.latitude !== null && item.longitude !== null && visibleUsers.has(item.userId)) {
          bounds.extend([item.longitude, item.latitude]);
          hasPoints = true;
        }
      }

      // A trip that hasn't happened yet has no track and no photos, only the
      // places it is going to. Without these it framed nothing and the map sat
      // on its default world view.
      for (const stop of stops ?? []) {
        if (stop.latitude === null || stop.longitude === null) continue;
        bounds.extend([stop.longitude, stop.latitude]);
        hasPoints = true;
      }

      if (hasPoints) {
        // Remembered so the camera can be sent back here — scrolling the
        // timeline walks it away from the trip as a whole.
        wholeTripRef.current = bounds;
        // Filtered down to one day, the caller frames that day itself; fitting
        // the trip's own bounds here would zoom straight back out again.
        if (autoFitRef.current) {
          map.fitBounds(bounds, {
            // The sheet covers the bottom of the canvas, so padding that
            // ignores it centres the trip behind the sheet instead of in view.
            padding: { top: 60, bottom: 60 + hiddenBottomRef.current, left: 60, right: 60 },
            maxZoom: 13,
            duration: 900,
          });
        }
      }
    };

    if (loadedRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
  }, [routes, media, visibleUsers, stops, themeVersion]);

  /**
   * Paints the flight arcs over the map.
   *
   * Each track is projected point by point, then every point is pushed away
   * from the straight line between the two airports by sin(pi·t) — highest in
   * the middle, nothing at the ends — in SCREEN pixels, so the arc keeps its
   * shape however the globe is turned. Longer flights climb higher, the way
   * they do.
   */
  const drawArcs = useCallback(() => {
    const map = mapRef.current;
    const canvas = arcCanvasRef.current;
    if (!map || !canvas) return;
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

    // A light grey dashed line, and nothing else: the halo under it was
    // meant to hold the line together over a pale satellite map and mostly
    // made it look smudged.
    ctx.lineCap = 'round';
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(206, 214, 224, 0.92)';

    for (const track of flightTracksRef.current) {
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
      // A point the projection cannot place comes back as NaN, and one NaN in
      // a path takes the whole path with it — which is why an arc would
      // sometimes vanish outright on the way in.
      const ok = lifted.map((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      // Round the back of a turned globe a point projects to the far side of
      // the canvas, and a line across it looks like a fold. Caught by comparing
      // each step with the typical one rather than with the canvas: zoomed in,
      // every step is hundreds of pixels, and a fixed threshold took the whole
      // arc away.
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
  }, []);

  /**
   * Repainted with the map: `render` fires for every frame of a pan, a zoom
   * and the globe's own easing, which is exactly when the arcs have moved.
   *
   * The canvas is a child of the map's own container rather than a sibling —
   * the trip page positions `.trip-map` by hand, and a wrapper around it would
   * have changed what that positioning is measured against.
   */
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'trip-map-arcs';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    arcCanvasRef.current = canvas;
    drawArcs();
    map.on('render', drawArcs);
    const ro = new ResizeObserver(drawArcs);
    ro.observe(container);
    return () => {
      map.off('render', drawArcs);
      ro.disconnect();
      canvas.remove();
      arcCanvasRef.current = null;
    };
  }, [drawArcs]);

  // Photo markers — clustered per zoom level so hundreds of photos never
  // become hundreds of DOM nodes (each with its own thumbnail fetch).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    /**
     * Rebuilds only what changed.
     *
     * Every marker used to be torn down and built again on each pass, so the
     * whole layer blinked: thumbnails were re-attached, entry animations
     * replayed, and clusters appeared to merge and split even where nothing
     * about them had moved. Markers are keyed by their cluster cell now, so a
     * pass keeps the ones that still exist, adds the new ones and fades out
     * only the ones that really went.
     */
    const draw = () => {
      const live = photoMarkersRef.current;
      if (hidePhotos) {
        for (const [, marker] of live) marker.remove();
        live.clear();
        return;
      }

      const withGps = media.filter(
        (m) => m.latitude !== null && m.longitude !== null && visibleUsers.has(m.userId),
      );

      // Grid-cluster: cell size shrinks as you zoom in. The LEVEL is rounded,
      // so the grid only changes on a real step of zoom — a two-finger pan
      // wobbles the zoom by a hundredth, and that used to regroup every photo
      // on the map halfway through the gesture.
      const level = Math.round(map.getZoom());
      const cell = 40 / 2 ** level;
      const clusters = new Map<string, MediaItem[]>();
      for (const item of withGps) {
        const key = `${Math.round(item.latitude! / cell)}:${Math.round(item.longitude! / cell)}`;
        const list = clusters.get(key) ?? [];
        list.push(item);
        clusters.set(key, list);
      }

      // Gone: fade out where it stood, then take it off the map.
      for (const [key, marker] of live) {
        if (clusters.has(key)) continue;
        live.delete(key);
        marker.getElement().classList.add('leaving');
        const timer = window.setTimeout(() => {
          marker.remove();
          photoTimersRef.current = photoTimersRef.current.filter((t) => t !== timer);
        }, 200);
        photoTimersRef.current.push(timer);
      }

      for (const [key, items] of clusters) {
        if (live.has(key)) continue;
        const representative = items[0]!;
        const el = document.createElement('div');
        el.className = 'photo-marker';
        el.style.borderColor = colorForUser(representative.userId);
        if (items.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'photo-marker-count';
          badge.textContent = items.length > 99 ? '99+' : String(items.length);
          el.appendChild(badge);
        }
        const cached = thumbCacheRef.current.get(representative.id);
        if (cached) {
          // Instant — no white placeholder, and skip the fade-in so re-cluster
          // on zoom doesn't blink.
          el.style.backgroundImage = `url(${cached})`;
          el.style.animation = 'none';
        } else {
          void fetchBlobUrl(`/media/${representative.id}/thumbnail`)
            .then((url) => {
              thumbCacheRef.current.set(representative.id, url);
              el.style.backgroundImage = `url(${url})`;
            })
            .catch(() => el.classList.add('photo-marker-error'));
        }

        // Single photo → open it; a cluster → zoom in to split it.
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (items.length > 1) {
            map.easeTo({
              center: [representative.longitude!, representative.latitude!],
              zoom: Math.min(map.getZoom() + 2.5, 16),
            });
            photoFocusRef.current?.(representative.id);
          } else {
            photoOpenRef.current?.(representative.id);
          }
        });

        // Anchor on the representative photo's own location (a real point on
        // the route) — averaging pulls markers off the travelled line.
        live.set(
          key,
          new maplibregl.Marker({ element: el })
            .setLngLat([representative.longitude!, representative.latitude!])
            .addTo(map),
        );
      }
    };

    draw();
    // Only when the rounded zoom actually changes: zoomend fires for the
    // hundredth of a level a pinch-pan leaves behind, and regrouping there is
    // both pointless and visible.
    let lastLevel = Math.round(map.getZoom());
    const onZoom = () => {
      const level = Math.round(map.getZoom());
      if (level === lastLevel) return;
      lastLevel = level;
      draw();
    };
    map.on('zoomend', onZoom);
    return () => {
      map.off('zoomend', onZoom);
    };
  }, [media, visibleUsers, hidePhotos]);

  // Planned stops: numbered/flag markers + connecting legs (flights as arcs).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old stop markers immediately (not only inside the deferred `apply`),
    // so a stop deleted in the planner always drops its flag/emoji at once, even
    // if the style isn't ready this tick.
    for (const marker of stopMarkersRef.current) marker.remove();
    stopMarkersRef.current = [];
    // The label belongs to a marker that is about to be replaced; leaving it
    // hanging over the map would point at nothing.
    closeStopPopup(true);

    const apply = () => {
      try {
        applyLayers();
      } catch (err) {
        // MapLibre throws if the style is mid-swap when a source is added, and
        // a throw here used to take the whole page down with it — adding a day
        // trip, of all things, could leave you looking at a blank screen. A
        // missing line until the next change is the better failure.
        console.warn('Kon de routelagen niet tekenen', err);
      }
    };

    const applyLayers = () => {
      for (const marker of stopMarkersRef.current) marker.remove();
      stopMarkersRef.current = [];
      for (const layerId of map.getLayersOrder().filter((l) => l.startsWith('leg-'))) {
        map.removeLayer(layerId);
      }
      for (const sourceId of Object.keys(map.getStyle().sources).filter((s) =>
        s.startsWith('leg-'),
      )) {
        map.removeSource(sourceId);
      }

      // Everything that actually happened, in one list: the tracked fixes and
      // the places photos were taken. A planned leg is measured against it.
      const realPoints: [number, number][] = [];
      for (const feature of routes?.features ?? []) {
        if (!visibleUsers.has(feature.properties.userId)) continue;
        for (const c of feature.geometry.coordinates as [number, number][]) realPoints.push(c);
      }
      for (const item of media) {
        if (item.latitude === null || item.longitude === null) continue;
        if (!visibleUsers.has(item.userId)) continue;
        realPoints.push([item.longitude, item.latitude]);
      }

      /**
       * A planned ground leg: a dark casing under a light dashed line. Beige on
       * its own vanished into satellite imagery; the casing is what keeps it
       * readable over both an aerial photo and a pale street map.
       */
      /**
       * The colour a planned ground leg is drawn in.
       *
       * Beige on a trip nobody recorded — it is a plan, and it should look
       * like one. But once there IS a recorded line, the planned bits are the
       * gaps in it (tracking switched on a day late, a battery that died), and
       * drawing those in a different colour broke one journey into two. They
       * take the traveller's own colour instead, so the whole thing reads as
       * one line that happens to be dashed where nobody was recording.
       */
      const firstVisible = [...visibleUsers][0];
      const gapColour =
        realPoints.length > 0 && firstVisible ? colorForUser(firstVisible) : '#ffc46b';

      const addPlannedGround = (id: string, width: number, dash: [number, number] | null) => {
        // Wide and blurred, so it reads as the line's own shadow rather than as
        // a black outline drawn around it — a tight, hard casing looked like a
        // border somebody had put there on purpose.
        const casing = width + 5;
        // A dash is measured in line widths, so the wider casing needs the
        // pattern scaled down or its dashes run past the ones they sit under.
        const scale = width / casing;
        map.addLayer({
          id: `${id}-casing`,
          type: 'line',
          source: id,
          paint: {
            'line-color': 'rgba(16, 18, 24, 0.34)',
            'line-width': casing,
            'line-blur': 3.5,
            ...(dash ? { 'line-dasharray': [dash[0] * scale, dash[1] * scale] } : {}),
          },
          layout: { 'line-cap': 'round' },
        });
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
       * The planned line is a guess either way, but a leg whose day has been
       * and gone was actually travelled — drawing it as a plan made a finished
       * trip look like it never happened. Legs from today onwards keep the
       * dashes; everything behind us is a solid line.
       */
      const todayKey = new Date().toISOString().slice(0, 10);
      const isFuture = (day?: string | null): boolean => !!day && day.slice(0, 10) > todayKey;
      const stopById = new Map((stops ?? []).map((s) => [s.id, s]));

      // Markers only for real places (cities); a standalone heen-/terugreis leg
      // may carry an origin/destination coordinate (for its km) but is NOT a
      // place, so it gets no pin.
      const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);
      for (const stop of stops ?? []) {
        if (stop.latitude === null || stop.longitude === null) continue;
        if (LEG_NAMES.has(stop.name)) continue;
        const el = document.createElement('div');
        // A day trip is a place you visited, but not a stop on the route — a
        // smaller marker keeps the itinerary readable.
        el.className = stop.parentStopId ? 'stop-marker stop-marker-day' : 'stop-marker';
        paintMarker(el, stop.countryCode, stop.orderIndex + 1);
        // Our own label rather than MapLibre's: it has to look like the app,
        // and it has to be able to leave rather than disappear.
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          openStopPopup(map, stop);
        });
        stopMarkersRef.current.push(
          new maplibregl.Marker({ element: el })
            .setLngLat([stop.longitude, stop.latitude])
            .addTo(map),
        );
      }

      // Airports a flight touches get the same small grey dot the globe uses,
      // so an arc visibly starts and ends somewhere instead of out of nowhere —
      // but only where the city itself has not already put a pin there. An
      // airport belongs to the place it serves, and a dot beside every flag was
      // one marker too many on nearly every flight.
      const airportSeen = new Set<string>();
      const pinned = (stops ?? []).filter(
        (s): s is StopPoint & { latitude: number; longitude: number } =>
          s.latitude !== null && s.longitude !== null,
      );
      /** Roughly 55 km — Schiphol to Amsterdam, Budapest to Ferihegy. */
      const AIRPORT_OF_CITY_KM = 55;
      for (const leg of buildLegs(stops ?? [])) {
        if (!leg.isFlight) continue;
        const coords = (leg.feature.geometry as GeoJSON.LineString)
          .coordinates as [number, number][];
        for (const point of [coords[0], coords[coords.length - 1]]) {
          if (!point) continue;
          const key = `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
          if (airportSeen.has(key)) continue;
          airportSeen.add(key);
          if (
            pinned.some(
              (s) => haversineKm([s.longitude, s.latitude], point) <= AIRPORT_OF_CITY_KM,
            )
          ) {
            continue;
          }
          const el = document.createElement('div');
          el.className = 'airport-marker';
          stopMarkersRef.current.push(
            new maplibregl.Marker({ element: el }).setLngLat(point).addTo(map),
          );
        }
      }

      // Day trips as a spur off the stop you slept at — dropped as soon as the
      // real data covers that drive, exactly like the planned ground legs.
      const byId = new Map((stops ?? []).map((s) => [s.id, s]));
      for (const stop of stops ?? []) {
        if (!stop.parentStopId || stop.latitude === null || stop.longitude === null) continue;
        const parent = byId.get(stop.parentStopId);
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
        addPlannedGround(id, 1.6, isFuture(stop.dayTripDate ?? stop.arrivalDate) ? [1, 2.4] : null);
      }

      // Legs. Flights are deduped by coarse endpoints so a there-and-back on the same
      // route (or two nearby airports) draws one dashed line, not two overlapping
      // ones that fill each other's gaps and read as solid.
      const seenFlights = new Set<string>();
      // Collected as we go and handed to the canvas overlay at the end.
      const tracks: [number, number][][] = [];
      const roundPt = (c: number) => Math.round(c / 0.8);
      for (const leg of buildLegs(stops ?? [])) {
        const legCoords = (leg.feature.geometry as GeoJSON.LineString)
          .coordinates as [number, number][];
        // A planned ground leg only survives where nothing recorded the way for
        // real. Flight arcs always show — they're never in the tracked ground
        // line, and they bridge the gap it leaves open.
        if (
          !leg.isFlight &&
          legIsRecorded(legCoords[0]!, legCoords[legCoords.length - 1]!, realPoints)
        ) {
          continue;
        }
        if (leg.isFlight) {
          const c = (leg.feature.geometry as GeoJSON.LineString).coordinates as [number, number][];
          const a = c[0]!;
          const b = c[c.length - 1]!;
          const key = [`${roundPt(a[0])},${roundPt(a[1])}`, `${roundPt(b[0])},${roundPt(b[1])}`]
            .sort()
            .join('|');
          if (seenFlights.has(key)) continue;
          seenFlights.add(key);
        }
        const id = `leg-${leg.id}`;
        // A leg is the arrival at its stop, so that stop's date is the day it
        // was travelled.
        const future = isFuture(stopById.get(leg.id)?.arrivalDate);
        if (leg.isFlight) {
          // Nothing on the map itself: a line layer is draped over the surface,
          // and a flight is in the air. Its hops go to the canvas overlay, one
          // arc each, so a stopover touches down where it should.
          if (leg.hops) tracks.push(...leg.hops);
        } else {
          map.addSource(id, { type: 'geojson', data: leg.feature });
          addPlannedGround(id, 2, future ? [2, 2] : null);
        }
      }

      // Whatever is in the air now, for the overlay to paint every frame.
      flightTracksRef.current = tracks;
      drawArcs();
    };

    // isStyleLoaded() goes false again while a style is busy, and by then the
    // map's own 'load' has long fired — waiting on it left the previous legs
    // standing forever. loadedRef is the same signal the route layer uses.
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [stops, routes, media, visibleUsers, themeVersion, drawArcs]);

  // Live "you are here" dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!currentLocation) {
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      return;
    }
    if (!meMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'me-marker';
      el.innerHTML = '<span class="me-marker-pulse"></span><span class="me-marker-dot"></span>';
      // Tapping yourself opens today's raw fixes — the natural question to ask
      // of the dot that says where the tracker thinks you are.
      el.title = 'Punten van vandaag';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelfClickRef.current?.();
      });
      meMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([
        currentLocation.lng,
        currentLocation.lat,
      ]).addTo(map);
    } else {
      meMarkerRef.current.setLngLat([currentLocation.lng, currentLocation.lat]);
    }
  }, [currentLocation]);

  // Live markers for other travellers are switched off for now: the avatar sat
  // off-centre from its own pointer and the marker jumped on every poll. The
  // data still flows (the people menu shows each traveller's last-seen time),
  // so turning this back on is a matter of flipping the flag once the marker
  // itself is rebuilt.
  useEffect(() => {
    for (const m of liveMarkersRef.current) m.remove();
    liveMarkersRef.current = [];
  }, [liveFixes, visibleUsers, selfUserId, liveTick]);

  // Manual waypoints as small dots; click to delete when editing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of waypointMarkersRef.current) marker.remove();
    waypointMarkersRef.current = [];
    for (const wp of waypoints ?? []) {
      const el = document.createElement('div');
      el.className = 'waypoint-dot';
      if (waypointDeleteRef.current) {
        el.classList.add('deletable');
        el.title = 'Klik om te verwijderen';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          waypointDeleteRef.current?.(wp.id);
        });
      }
      waypointMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([wp.longitude, wp.latitude]).addTo(map),
      );
    }
  }, [waypoints]);

  return (
    <div
      ref={containerRef}
      className={`trip-map ${clickMode ? 'trip-map-clickmode' : ''}`}
      data-testid="trip-map"
    />
  );
}

/* ---- The travelling light ------------------------------------------------
 *
 * The home globe lights a trip up by running a ribbon of light along it:
 * brightest at the head, fading out behind, a beat at the end, then again.
 * Switching the map to a single day changes the line under you, so the same
 * light runs the new route and keeps running while that day is the one you
 * are looking at.
 */

const GLOW_SOURCE = 'trip-glow';
const GLOW_HALO = 'trip-glow-halo';
const GLOW_CORE = 'trip-glow-core';
const HEAD_SOURCE = 'trip-glow-head';
const HEAD_GLOW = 'trip-glow-head-glow';
const HEAD_DOT = 'trip-glow-head-dot';
/** How much of the line the light's tail covers, as on the globe. */
const GLOW_TAIL = 0.22;
/**
 * How fast the light travels, in degrees of the map per second.
 *
 * A pass used to take the same time whatever it was tracing, which made an
 * afternoon's walk crawl and a flight across a continent flash past. Speed is
 * the thing that should be constant, as it is on the globe.
 */
const GLOW_DEG_PER_S = 1.7;
/** Even so, a pass is never over in a blink or long enough to be forgotten. */
const GLOW_MIN_MS = 4500;
const GLOW_MAX_MS = 16_000;
/** A beat at the end, so two passes read as two rather than one long one. */
const GLOW_PAUSE_MS = 900;
/** The gradient is rebuilt per frame; 30 is plenty for a light this soft. */
const GLOW_FPS = 30;

/** One running animation per map, so a second call replaces the first. */
const glowFrames = new WeakMap<MapLibreMap, number>();

function runGlow(map: MapLibreMap, lines: [number, number][][]): void {
  stopGlow(map);
  const usable = lines.filter((line) => line.length >= 2);
  if (usable.length === 0) return;

  const colour =
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8613c';
  // The head runs along the longest line — the route proper, rather than a
  // stray hop out to an airport.
  const path = usable.reduce((longest, line) =>
    lineLengthDeg([line]) > lineLengthDeg([longest]) ? line : longest,
  );
  const walk = measureLine(path);

  try {
    map.addSource(GLOW_SOURCE, {
      type: 'geojson',
      // The gradient is expressed in "how far along this line are we", which
      // only exists when the source measures its lines.
      lineMetrics: true,
      data: {
        type: 'FeatureCollection',
        features: usable.map((coordinates) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'LineString' as const, coordinates },
        })),
      },
    });
    // Two passes of the same ribbon: a wide soft halo carrying the colour into
    // the map around it, and a narrow core that is the trail itself.
    map.addLayer({
      id: GLOW_HALO,
      type: 'line',
      source: GLOW_SOURCE,
      paint: {
        'line-width': 16,
        'line-blur': 10,
        'line-opacity': 0.45,
        'line-gradient': glowGradient(-GLOW_TAIL, colour) as never,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    map.addLayer({
      id: GLOW_CORE,
      type: 'line',
      source: GLOW_SOURCE,
      paint: {
        'line-width': 4.5,
        'line-blur': 1.2,
        'line-opacity': 0.95,
        'line-gradient': glowGradient(-GLOW_TAIL, colour) as never,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    // The light itself: a dot with a halo around it, which is what the home
    // globe draws. A gradient alone reads as a stripe sliding along; the dot
    // is the thing your eye follows.
    map.addSource(HEAD_SOURCE, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: path[0]! } },
    });
    map.addLayer({
      id: HEAD_GLOW,
      type: 'circle',
      source: HEAD_SOURCE,
      paint: {
        'circle-radius': 14,
        'circle-color': colour,
        'circle-blur': 1,
        'circle-opacity': 0.55,
      },
    });
    map.addLayer({
      id: HEAD_DOT,
      type: 'circle',
      source: HEAD_SOURCE,
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': colour,
      },
    });
  } catch {
    // Style swapped mid-call (theme change): nothing to light up.
    return;
  }

  // The route's own length decides how long a pass takes, so the light moves
  // at the same speed over a day in one town as over a trip across Europe.
  const runMs = Math.min(
    GLOW_MAX_MS,
    Math.max(GLOW_MIN_MS, (lineLengthDeg(usable) / GLOW_DEG_PER_S) * 1000),
  );
  const cycle = runMs + GLOW_PAUSE_MS;
  const started = performance.now();
  let painted = 0;

  const step = () => {
    if (!map.getLayer(GLOW_CORE)) {
      glowFrames.delete(map);
      return;
    }
    const now = performance.now();
    // A page in the background gets no light: the frames are wasted and the
    // phone pays for them.
    if (document.hidden) {
      glowFrames.set(map, requestAnimationFrame(step));
      return;
    }
    if (now - painted >= 1000 / GLOW_FPS) {
      painted = now;
      const within = (now - started) % cycle;
      const t = Math.min(1, within / runMs);
      // The head leaves past the end and the tail follows it off, so the
      // ribbon empties instead of parking itself on the last stretch.
      const p = t * (1 + GLOW_TAIL) ;
      const gradient = glowGradient(p, colour) as never;
      map.setPaintProperty(GLOW_HALO, 'line-gradient', gradient);
      map.setPaintProperty(GLOW_CORE, 'line-gradient', gradient);

      const source = map.getSource(HEAD_SOURCE) as
        | { setData: (data: GeoJSON.Feature) => void }
        | undefined;
      if (source) {
        const visible = p <= 1;
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: pointAt(walk, Math.min(1, p)) },
        });
        // Past the end there is nothing left to lead; the dot goes out and the
        // trail runs off after it.
        map.setPaintProperty(HEAD_DOT, 'circle-opacity', visible ? 1 : 0);
        map.setPaintProperty(HEAD_DOT, 'circle-stroke-opacity', visible ? 1 : 0);
        map.setPaintProperty(HEAD_GLOW, 'circle-opacity', visible ? 0.55 : 0);
      }
    }
    glowFrames.set(map, requestAnimationFrame(step));
  };
  glowFrames.set(map, requestAnimationFrame(step));
}

function stopGlow(map: MapLibreMap): void {
  const frame = glowFrames.get(map);
  if (frame !== undefined) cancelAnimationFrame(frame);
  glowFrames.delete(map);
  for (const layer of [HEAD_DOT, HEAD_GLOW, GLOW_CORE, GLOW_HALO]) {
    if (map.getLayer(layer)) map.removeLayer(layer);
  }
  for (const source of [HEAD_SOURCE, GLOW_SOURCE]) {
    if (map.getSource(source)) map.removeSource(source);
  }
}

/**
 * A bright head at `p` with a fading ribbon behind it, as a line-gradient.
 *
 * `p` may run past the end of the line: the head leaves first and the tail
 * follows it off, which is what stops the last stretch keeping a lit tail
 * until the next pass starts.
 *
 * Stops have to climb, and the first one has to sit at 0, so they are built in
 * order and anything that would repeat a position is dropped.
 */
function glowGradient(p: number, colour: string): unknown[] {
  const clear = withAlpha(colour, 0);
  const start = p - GLOW_TAIL;

  const expression: unknown[] = ['interpolate', ['linear'], ['line-progress']];
  let last = -1;
  const push = (at: number, c: string) => {
    if (at <= last || at < 0 || at > 1) return;
    last = at;
    expression.push(at, c);
  };

  push(0, start <= 0 && p >= 0 ? withAlpha(colour, 0.28 + 0.42 * Math.min(1, p / GLOW_TAIL)) : clear);
  push(Math.max(0, start), clear);
  // The ribbon brightens along its length rather than in one step, which is
  // what makes it read as a comet instead of a moving stripe.
  push(start + GLOW_TAIL * 0.55, withAlpha(colour, 0.28));
  push(start + GLOW_TAIL * 0.85, withAlpha(colour, 0.7));
  push(p, '#ffffff');
  push(p + 0.012, clear);
  push(1, clear);
  // A gradient needs at least two stops; off the line entirely, it is empty.
  if (expression.length < 5) {
    return ['interpolate', ['linear'], ['line-progress'], 0, clear, 1, clear];
  }
  return expression;
}

/** Cumulative lengths along a line, so a fraction can become a position. */
function measureLine(line: [number, number][]): { points: [number, number][]; at: number[] } {
  const at = [0];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1]!;
    const [x2, y2] = line[i]!;
    const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * (Math.PI / 180));
    total += Math.hypot(dx, y2 - y1);
    at.push(total);
  }
  return { points: line, at: at.map((value) => (total > 0 ? value / total : 0)) };
}

/** Where along the measured line a fraction lands. */
function pointAt(
  walk: { points: [number, number][]; at: number[] },
  fraction: number,
): [number, number] {
  const { points, at } = walk;
  if (points.length === 0) return [0, 0];
  if (fraction <= 0) return points[0]!;
  if (fraction >= 1) return points[points.length - 1]!;
  let i = 1;
  while (i < at.length && at[i]! < fraction) i++;
  const before = points[i - 1]!;
  const after = points[i] ?? before;
  const span = (at[i] ?? 1) - at[i - 1]!;
  const f = span > 0 ? (fraction - at[i - 1]!) / span : 0;
  return [before[0] + (after[0] - before[0]) * f, before[1] + (after[1] - before[1]) * f];
}

/** Rough length of everything being lit, in degrees — good enough for a pace. */
function lineLengthDeg(lines: [number, number][][]): number {
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [x1, y1] = line[i - 1]!;
      const [x2, y2] = line[i]!;
      // Longitudes converge towards the poles; without this a route in Norway
      // measures far longer than the same distance at the equator.
      const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * (Math.PI / 180));
      total += Math.hypot(dx, y2 - y1);
    }
  }
  return total;
}

/** `#rrggbb` with an alpha, since the gradient needs a colour it can fade. */
function withAlpha(colour: string, alpha: number): string {
  const hex = colour.replace('#', '');
  if (hex.length !== 6) return colour;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
