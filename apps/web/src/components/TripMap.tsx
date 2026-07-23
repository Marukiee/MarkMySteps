import maplibregl, { LngLatBounds, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { fetchBlobUrl } from '../api/client';
import type { MediaItem, RouteCollection } from '../api/types';
import { airportByCode } from '../lib/airports';
import { greatCircleArc, StopPoint } from '../lib/arc';
import { colorForUser, flagEmoji } from '../lib/colors';
import './tripmap.css';

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
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const waypointMarkersRef = useRef<maplibregl.Marker[]>([]);
  const waypointDeleteRef = useRef(onWaypointDelete);
  waypointDeleteRef.current = onWaypointDelete;
  const loadedRef = useRef(false);
  const clickHandlerRef = useRef(onMapClick);
  clickHandlerRef.current = onMapClick;
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
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

      for (const feature of routes.features) {
        const { userId } = feature.properties;
        if (!visibleUsers.has(userId)) continue;
        const id = `route-${userId}`;
        map.addSource(id, { type: 'geojson', data: feature });
        // Soft halo under the line for the hand-drawn journal look.
        map.addLayer({
          id: `${id}-halo`,
          type: 'line',
          source: id,
          paint: {
            'line-color': '#ffffff',
            'line-width': 7,
            'line-opacity': 0.7,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        map.addLayer({
          id: `${id}-line`,
          type: 'line',
          source: id,
          paint: {
            'line-color': colorForUser(userId),
            'line-width': 3.5,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        for (const coordinate of feature.geometry.coordinates) {
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
  }, [routes, media, visibleUsers]);

  // Photo markers — clustered per zoom level so hundreds of photos never
  // become hundreds of DOM nodes (each with its own thumbnail fetch).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

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
        void fetchBlobUrl(`/media/${representative.id}/thumbnail`)
          .then((url) => {
            el.style.backgroundImage = `url(${url})`;
          })
          .catch(() => el.classList.add('photo-marker-error'));

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
  }, [media, visibleUsers]);

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

      const located = (stops ?? []).filter(
        (s) => s.latitude !== null && s.longitude !== null,
      );

      for (let i = 0; i < located.length; i++) {
        const stop = located[i]!;
        const el = document.createElement('div');
        el.className = 'stop-marker';
        el.textContent = flagEmoji(stop.countryCode) || String(stop.orderIndex + 1);
        stopMarkersRef.current.push(
          new maplibregl.Marker({ element: el })
            .setLngLat([stop.longitude!, stop.latitude!])
            .setPopup(new maplibregl.Popup({ offset: 18 }).setText(stop.name))
            .addTo(map),
        );

        // Leg to this stop (from the previous stop, or a departure airport for
        // an arrival flight into the very first stop).
        {
          const prev = i > 0 ? located[i - 1]! : null;
          const isFlight = stop.travelMode === 'FLIGHT';
          const depAp = airportByCode(stop.fromAirport);
          const arrAp = airportByCode(stop.toAirport);
          const from: [number, number] | null = depAp
            ? [depAp.lon, depAp.lat]
            : prev
              ? [prev.longitude!, prev.latitude!]
              : null;
          const to: [number, number] = arrAp
            ? [arrAp.lon, arrAp.lat]
            : [stop.longitude!, stop.latitude!];
          if (!from) continue;
          const id = `leg-${stop.id}`;
          map.addSource(id, {
            type: 'geojson',
            data: isFlight
              ? greatCircleArc(from, to)
              : { type: 'Feature', geometry: { type: 'LineString', coordinates: [from, to] }, properties: {} },
          });
          map.addLayer({
            id,
            type: 'line',
            source: id,
            paint: {
              'line-color': isFlight ? '#5b6ee1' : '#8a94a3',
              'line-width': isFlight ? 2.5 : 2,
              'line-dasharray': isFlight ? [1, 1.5] : [2, 2],
            },
            layout: { 'line-cap': 'round' },
          });
        }
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [stops]);

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
