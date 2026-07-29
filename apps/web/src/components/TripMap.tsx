import maplibregl, { LngLatBounds, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { fetchBlobUrl } from '../api/client';
import type { LiveFix } from '../api/types';
import { getMapStyle, getMapStyleId } from '../lib/prefs';
import { setDarkBackdrop } from '../lib/native';
import type { MediaItem, RouteCollection } from '../api/types';
import { buildLegs, flightArc, haversineKm, StopPoint, trimOutlierEnds } from '../lib/arc';
import { colorForUser } from '../lib/colors';
import { useNow } from '../lib/lastSeen';
import './tripmap.css';
import { paintMarker } from './Flag';

/** A single-hop jump longer than this in a route line is treated as a flight. */
const FLIGHT_KM = 400;

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
  /** True once the trip has started (ongoing or finished): the planned dashed
   *  ground route is then hidden — the real (photo/GPS) route tells the story. */
  tripStarted?: boolean;
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
  tripStarted,
  onReady,
  onSelfClick,
}: TripMapProps) {
  // Read from a marker listener that is only attached once.
  const onSelfClickRef = useRef(onSelfClick);
  onSelfClickRef.current = onSelfClick;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
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
  const loadedRef = useRef(false);
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
  // Once a trip has real tracked GPS, the planned dashed legs are noise — show
  // only the tracked line (the stop markers still stand).
  const hasTracked = !!routes?.features.some((f) => f.geometry.coordinates.length >= 2);
  const hasTrackedRef = useRef(hasTracked);
  hasTrackedRef.current = hasTracked;
  // Once a trip is underway (or over), the planned dashed ground route is no
  // longer "the plan" — hide it so only the real route (photos/GPS) shows.
  const tripStartedRef = useRef(tripStarted);
  tripStartedRef.current = tripStarted;

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
    map.on('click', (e) => clickHandlerRef.current?.(e.lngLat));
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
    let hiddenBottom = 0;
    const camPadding = () => ({
      top: 50,
      bottom: 50 + hiddenBottom,
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
          padding: { top: 0, bottom: hiddenBottom, left: 0, right: 0 },
          duration: 700,
        }),
      setHiddenBottom: (px) => {
        hiddenBottom = Math.max(0, Math.round(px));
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
    if (!map || !routes) return;

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

      for (const feature of routes.features) {
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

      if (hasPoints) {
        // Remembered so the camera can be sent back here — scrolling the
        // timeline walks it away from the trip as a whole.
        wholeTripRef.current = bounds;
        map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 900 });
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

    const draw = () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      if (hidePhotos) return; // "tracked only" mode

      const withGps = media.filter(
        (m) => m.latitude !== null && m.longitude !== null && visibleUsers.has(m.userId),
      );

      // Grid-cluster: cell size shrinks as you zoom in. Small enough that
      // photo spots along the route stay individually visible.
      const zoom = map.getZoom();
      const cell = 40 / 2 ** zoom; // degrees per cluster cell
      const clusters = new Map<string, MediaItem[]>();
      for (const item of withGps) {
        const key = `${Math.round(item.latitude! / cell)}:${Math.round(item.longitude! / cell)}`;
        const list = clusters.get(key) ?? [];
        list.push(item);
        clusters.set(key, list);
      }

      for (const items of clusters.values()) {
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
              zoom: Math.min(zoom + 2.5, 16),
            });
            photoFocusRef.current?.(representative.id);
          } else {
            photoOpenRef.current?.(representative.id);
          }
        });

        // Anchor on the representative photo's own location (a real point on
        // the route) — averaging pulls markers off the travelled line.
        markersRef.current.push(
          new maplibregl.Marker({ element: el })
            .setLngLat([representative.longitude!, representative.latitude!])
            .addTo(map),
        );
      }
    };

    draw();
    map.on('zoomend', draw);
    return () => {
      map.off('zoomend', draw);
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

    const apply = () => {
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
        stopMarkersRef.current.push(
          new maplibregl.Marker({ element: el })
            .setLngLat([stop.longitude, stop.latitude])
            .setPopup(new maplibregl.Popup({ offset: 18 }).setText(stop.name))
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

      // Day trips as a spur off the stop you slept at. Hidden once real GPS
      // exists, exactly like the planned ground legs — the track already
      // contains the drive.
      if (!hasTrackedRef.current && !tripStartedRef.current) {
        const byId = new Map((stops ?? []).map((s) => [s.id, s]));
        for (const stop of stops ?? []) {
          if (!stop.parentStopId || stop.latitude === null || stop.longitude === null) continue;
          const parent = byId.get(stop.parentStopId);
          if (!parent || parent.latitude === null || parent.longitude === null) continue;
          const id = `leg-day-${stop.id}`;
          map.addSource(id, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  [parent.longitude, parent.latitude],
                  [stop.longitude, stop.latitude],
                ],
              },
            },
          });
          map.addLayer({
            id,
            type: 'line',
            source: id,
            paint: { 'line-color': '#a9846a', 'line-width': 1.6, 'line-dasharray': [1, 2.4] },
            layout: { 'line-cap': 'round' },
          });
        }
      }

      // Legs. Flight arcs always show (they bridge gaps the tracked line leaves
      // open). Ground legs are hidden once real tracked GPS tells the story.
      // Flights are deduped by coarse endpoints so a there-and-back on the same
      // route (or two nearby airports) draws one dashed line, not two overlapping
      // ones that fill each other's gaps and read as solid.
      const seenFlights = new Set<string>();
      const roundPt = (c: number) => Math.round(c / 0.8);
      for (const leg of buildLegs(stops ?? [])) {
        // Hide only the planned GROUND legs once a route is tracked (they'd
        // double up the real line). Flight arcs always show — they're never in
        // the tracked ground line.
        if (!leg.isFlight && (hasTrackedRef.current || tripStartedRef.current)) continue;
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
        map.addSource(id, { type: 'geojson', data: leg.feature });
        map.addLayer({
          id,
          type: 'line',
          source: id,
          paint: {
            'line-color': leg.isFlight ? '#8a94a3' : '#a9846a',
            'line-width': leg.isFlight ? 2 : 2,
            'line-dasharray': leg.isFlight ? [1.4, 2.6] : [2, 2],
          },
          layout: { 'line-cap': 'round' },
        });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [stops, hasTracked, tripStarted, themeVersion]);

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
