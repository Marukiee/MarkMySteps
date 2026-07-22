import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { fetchBlobUrl } from '../api/client';
import type { MediaItem, RouteCollection } from '../api/types';
import { colorForUser } from '../lib/colors';
import './tripmap.css';

// Open vector tiles, no API key, no Google — https://openfreemap.org
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

interface TripMapProps {
  routes: RouteCollection | null;
  media: MediaItem[];
  visibleUsers: Set<string>;
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  clickMode?: boolean;
}

export function TripMap({ routes, media, visibleUsers, onMapClick, clickMode }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const loadedRef = useRef(false);
  const clickHandlerRef = useRef(onMapClick);
  clickHandlerRef.current = onMapClick;

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [4.9, 52.37],
      zoom: 3,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      loadedRef.current = true;
      // Trigger a re-render pass by dispatching a resize; route effect below
      // re-runs when props change, and reads loadedRef.
      map.resize();
    });
    map.on('click', (e) => clickHandlerRef.current?.(e.lngLat));
    mapRef.current = map;
    return () => {
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

  // Photo markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    const withGps = media.filter(
      (m) => m.latitude !== null && m.longitude !== null && visibleUsers.has(m.userId),
    );

    for (const item of withGps) {
      const el = document.createElement('div');
      el.className = 'photo-marker';
      el.style.borderColor = colorForUser(item.userId);
      void fetchBlobUrl(`/media/${item.id}/thumbnail`)
        .then((url) => {
          el.style.backgroundImage = `url(${url})`;
        })
        .catch(() => el.classList.add('photo-marker-error'));

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([item.longitude!, item.latitude!])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [media, visibleUsers]);

  return (
    <div
      ref={containerRef}
      className={`trip-map ${clickMode ? 'trip-map-clickmode' : ''}`}
      data-testid="trip-map"
    />
  );
}
