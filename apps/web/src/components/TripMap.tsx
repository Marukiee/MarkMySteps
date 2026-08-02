import maplibregl, { LngLatBounds, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
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
  onSelfClick,
}: TripMapProps) {
  // Read from a marker listener that is only attached once.
  const onSelfClickRef = useRef(onSelfClick);
  onSelfClickRef.current = onSelfClick;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
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
        map.fitBounds(bounds, {
          // The sheet covers the bottom of the canvas, so padding that ignores
          // it centres the trip behind the sheet instead of in view.
          padding: { top: 60, bottom: 60 + hiddenBottomRef.current, left: 60, right: 60 },
          maxZoom: 13,
          duration: 900,
        });
      }
    };

    if (loadedRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
  }, [routes, media, visibleUsers, stops, themeVersion]);

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
      // so an arc visibly starts and ends somewhere instead of out of nowhere.
      const airportSeen = new Set<string>();
      for (const leg of buildLegs(stops ?? [])) {
        if (!leg.isFlight) continue;
        const coords = (leg.feature.geometry as GeoJSON.LineString)
          .coordinates as [number, number][];
        for (const point of [coords[0], coords[coords.length - 1]]) {
          if (!point) continue;
          const key = `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
          if (airportSeen.has(key)) continue;
          airportSeen.add(key);
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
        map.addSource(id, { type: 'geojson', data: leg.feature });
        if (leg.isFlight) {
          // A flight arc is always dashed. It is a drawn great circle, not a
          // route anybody recorded, and past or future changes nothing about
          // that — the solid/dashed distinction is about the ground.
          map.addLayer({
            id,
            type: 'line',
            source: id,
            paint: {
              'line-color': '#8a94a3',
              'line-width': 2,
              'line-dasharray': [1.4, 2.6],
            },
            layout: { 'line-cap': 'round' },
          });
        } else {
          addPlannedGround(id, 2, future ? [2, 2] : null);
        }
      }
    };

    // isStyleLoaded() goes false again while a style is busy, and by then the
    // map's own 'load' has long fired — waiting on it left the previous legs
    // standing forever. loadedRef is the same signal the route layer uses.
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [stops, routes, media, visibleUsers, themeVersion]);

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
