import maplibregl, { LngLatBounds, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { fetchBlobUrl } from '../api/client';
import type { MediaItem, RouteCollection } from '../api/types';
import { buildLegs, flightArc, haversineKm, StopPoint } from '../lib/arc';
import { colorForUser, flagEmoji } from '../lib/colors';
import './tripmap.css';

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
  onPhotoOpen?: (mediaId: string) => void;
  onPhotoFocus?: (mediaId: string) => void;
  clickMode?: boolean;
  styleUrl: string | StyleSpecification;
  /** Live device location, shown as a Google-Maps-style dot. */
  currentLocation?: { lat: number; lng: number } | null;
  /** Hide photo markers (e.g. "show only tracked locations" mode). */
  hidePhotos?: boolean;
  /** Exposes an imperative focus API once the map is ready. */
  onReady?: (api: TripMapApi) => void;
}

export interface TripMapApi {
  /** Ease the camera to fit the given [lng,lat] points (e.g. a day's photos). */
  focusOn: (coords: [number, number][]) => void;
  /** Ease the camera to a single point (e.g. a searched planner place). */
  flyTo: (lng: number, lat: number, zoom?: number) => void;
}

export function TripMap({
  routes,
  media,
  stops,
  waypoints,
  onWaypointDelete,
  visibleUsers,
  onMapClick,
  onPhotoOpen,
  onPhotoFocus,
  clickMode,
  styleUrl,
  currentLocation,
  hidePhotos,
  onReady,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const waypointMarkersRef = useRef<maplibregl.Marker[]>([]);
  const meMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Cache thumbnail object-URLs by media id so re-clustering on zoom reuses the
  // loaded image instead of flashing the empty placeholder white.
  const thumbCacheRef = useRef<Map<string, string>>(new Map());
  const waypointDeleteRef = useRef(onWaypointDelete);
  waypointDeleteRef.current = onWaypointDelete;
  const loadedRef = useRef(false);
  const clickHandlerRef = useRef(onMapClick);
  clickHandlerRef.current = onMapClick;
  const photoOpenRef = useRef(onPhotoOpen);
  photoOpenRef.current = onPhotoOpen;
  const photoFocusRef = useRef(onPhotoFocus);
  photoFocusRef.current = onPhotoFocus;
  // Once a trip has real tracked GPS, the planned dashed legs are noise — show
  // only the tracked line (the stop markers still stand).
  const hasTracked = !!routes?.features.some((f) => f.geometry.coordinates.length >= 2);
  const hasTrackedRef = useRef(hasTracked);
  hasTrackedRef.current = hasTracked;

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
    mapRef.current = map;

    onReady?.({
      focusOn: (coords) => {
        if (coords.length === 0) return;
        const b = new LngLatBounds();
        for (const c of coords) b.extend(c);
        map.fitBounds(b, {
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          maxZoom: 12,
          duration: 700,
        });
      },
      flyTo: (lng, lat, zoom = 8) => map.easeTo({ center: [lng, lat], zoom, duration: 700 }),
    });

    // Keep the canvas matched to its container. The bottom-sheet layout
    // resizes this panel (fixed height, sheet sliding over it); without this
    // the GL canvas keeps its initial size and renders as a thin sliver.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
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
        const coords = feature.geometry.coordinates as [number, number][];

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
        map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 900 });
      }
    };

    if (loadedRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
  }, [routes, media, visibleUsers, stops]);

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

      // Markers only for real places (cities); standalone flights have none.
      for (const stop of stops ?? []) {
        if (stop.latitude === null || stop.longitude === null) continue;
        const el = document.createElement('div');
        el.className = 'stop-marker';
        el.textContent = flagEmoji(stop.countryCode) || String(stop.orderIndex + 1);
        stopMarkersRef.current.push(
          new maplibregl.Marker({ element: el })
            .setLngLat([stop.longitude, stop.latitude])
            .setPopup(new maplibregl.Popup({ offset: 18 }).setText(stop.name))
            .addTo(map),
        );
      }

      // Legs. Flight arcs always show (they bridge gaps the tracked line leaves
      // open). Ground legs are hidden once real tracked GPS tells the story.
      // Flights are deduped by coarse endpoints so a there-and-back on the same
      // route (or two nearby airports) draws one dashed line, not two overlapping
      // ones that fill each other's gaps and read as solid.
      const seenFlights = new Set<string>();
      const roundPt = (c: number) => Math.round(c / 0.8);
      for (const leg of buildLegs(stops ?? [])) {
        if (!leg.isFlight && hasTrackedRef.current) continue;
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
  }, [stops, hasTracked]);

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
      meMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([
        currentLocation.lng,
        currentLocation.lat,
      ]).addTo(map);
    } else {
      meMarkerRef.current.setLngLat([currentLocation.lng, currentLocation.lat]);
    }
  }, [currentLocation]);

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
