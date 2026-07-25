import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import type { RouteCollection } from '../api/types';
import { colorForUser } from '../lib/colors';
import { getMapStyle } from '../lib/prefs';

/**
 * Mini map for placing a trip's globe marker: shows the route and a draggable
 * pin. Handy for a loop/interrail trip whose start≈end — drop the single dot (and
 * its name badge) wherever it reads best. Dragging saves immediately.
 */
export function TripMarkerPicker({
  tripId,
  initial,
  onChange,
}: {
  tripId: string;
  initial: [number, number] | null;
  onChange: (pos: [number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(),
      center: initial ?? [4.9, 52.37],
      zoom: initial ? 5 : 3,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const marker = new maplibregl.Marker({ color: '#e8613c', draggable: true });
    markerRef.current = marker;
    if (initial) marker.setLngLat(initial).addTo(map);
    marker.on('dragend', () => {
      const { lng, lat } = marker.getLngLat();
      onChangeRef.current([lng, lat]);
    });

    void api<RouteCollection>(`/trips/${tripId}/route`)
      .then((routes) => {
        const draw = () => {
          const bounds = new LngLatBounds();
          for (const feature of routes.features) {
            const id = `mp-${feature.properties.userId}`;
            if (map.getSource(id)) continue;
            map.addSource(id, { type: 'geojson', data: feature });
            map.addLayer({
              id,
              type: 'line',
              source: id,
              paint: { 'line-color': colorForUser(feature.properties.userId), 'line-width': 3 },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            });
            for (const c of feature.geometry.coordinates as [number, number][]) bounds.extend(c);
          }
          // Drop the pin on the route's midpoint if it has none yet.
          if (!initial) {
            const first = routes.features[0]?.geometry.coordinates as [number, number][] | undefined;
            if (first && first.length > 0) {
              const mid = first[Math.floor(first.length / 2)]!;
              marker.setLngLat(mid).addTo(map);
              onChangeRef.current(mid);
            }
          }
          if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 9, duration: 0 });
        };
        if (map.isStyleLoaded()) draw();
        else map.once('load', draw);
      })
      .catch(() => undefined);

    // Tap the map to move the pin too (easier than grabbing it).
    map.on('click', (e) => {
      marker.setLngLat(e.lngLat).addTo(map);
      onChangeRef.current([e.lngLat.lng, e.lngLat.lat]);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  return <div ref={containerRef} className="ts-marker-map" />;
}
