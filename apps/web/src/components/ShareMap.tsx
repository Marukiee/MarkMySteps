import maplibregl, { LngLatBounds, Map as MapLibreMap } from '../lib/mapgl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RouteCollection } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import { ArcOverlay, createArcOverlay, drawPlannedStops, groundRuns } from '../lib/mapRoute';
import { colorForUser } from '../lib/colors';
import { getMapStyle } from '../lib/prefs';
import { Icon } from './Icon';
import { t } from '../i18n';

/** Enough of a photo to put it on the map. */
export interface ShareMapPhoto {
  id: string;
  userId: string;
  latitude: number | null;
  longitude: number | null;
}

interface ShareMapProps {
  stops: PlannedStop[];
  routes: RouteCollection | null;
  /** In the order the timeline and the viewer use. */
  photos: ShareMapPhoto[];
  thumbFor: (id: string) => string;
  onOpenPhoto: (id: string) => void;
}

const FIT = { padding: 70, maxZoom: 12 };

/**
 * The map of a shared trip.
 *
 * Its own chunk: MapLibre is the heaviest thing on the page by a distance, and
 * a guest opening a link on a phone should see the cover and the photos while
 * it is still on its way. The page holds the map's box at its full size, so
 * nothing moves when this arrives.
 *
 * It is only mounted once the trip's places, route and photos are all in, so
 * it is built already framed on the trip: no flight in from a default view,
 * and no second and third jump as each piece of data lands.
 */
export default function ShareMap({ stops, routes, photos, thumbFor, onOpenPhoto }: ShareMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const arcsRef = useRef<ArcOverlay | null>(null);
  // Keyed by cluster cell so a redraw can keep the markers that did not move.
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [ready, setReady] = useState(false);
  // The click handlers live on DOM nodes MapLibre owns; they read the latest
  // callback from here instead of being rebuilt with it.
  const openRef = useRef(onOpenPhoto);
  openRef.current = onOpenPhoto;

  /**
   * The route, cut up the way the app cuts it, and the frame the whole trip
   * fits in. The recorded line is trimmed of stray home fixes first, so a
   * point at the front door does not drag the frame across a continent.
   */
  const drawn = useMemo(() => {
    const bounds = new LngLatBounds();
    let framed = false;
    const lines = (routes?.features ?? []).map((feature) => {
      const runs = groundRuns(feature.geometry.coordinates as [number, number][], stops);
      for (const coordinate of runs.trimmed) {
        bounds.extend(coordinate);
        framed = true;
      }
      return { userId: feature.properties.userId, ...runs };
    });
    for (const stop of stops) {
      if (stop.latitude === null || stop.longitude === null) continue;
      bounds.extend([stop.longitude, stop.latitude]);
      framed = true;
    }
    // Only photos: frame those, rather than show a map of nowhere.
    if (!framed) {
      for (const photo of photos) {
        if (photo.latitude === null || photo.longitude === null) continue;
        bounds.extend([photo.longitude, photo.latitude]);
        framed = true;
      }
    }
    return { lines, bounds: framed ? bounds : null };
  }, [routes, stops, photos]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: getMapStyle(),
      ...(drawn.bounds
        ? { bounds: drawn.bounds, fitBoundsOptions: FIT }
        : { center: [4.9, 52.37] as [number, number], zoom: 3 }),
      attributionControl: { compact: true },
      /*
       * The page scrolls, and the map is a panel in the middle of it. A thumb
       * dragged upwards over that panel was panning the map instead of the
       * page, so reading the trip meant fighting it. Two fingers move the map
       * now, one finger scrolls past it, and MapLibre says so on the map the
       * moment somebody tries with one.
       */
      cooperativeGestures: true,
      locale: {
        'CooperativeGesturesHandler.MobileHelpText': t('share.page.twoFingers'),
        'CooperativeGesturesHandler.WindowsHelpText': t('share.page.ctrlScroll'),
        'CooperativeGesturesHandler.MacHelpText': t('share.page.cmdScroll'),
      },
    });
    mapRef.current = map;
    // The flights are painted over the map rather than onto it, by the same
    // overlay the app's map uses.
    const overlay = createArcOverlay(map, container);
    arcsRef.current = overlay;
    if (map.isStyleLoaded()) setReady(true);
    else map.once('load', () => setReady(true));
    // Folded shut, like the app's map: a compact attribution control still
    // starts expanded, and "Imagery (c) Esri" over the corner of the picture
    // is not what anybody opened the link for. The (i) stays.
    map.once('idle', () => {
      container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      container.classList.add('is-drawn');
    });

    const live = markersRef.current;
    return () => {
      for (const marker of live.values()) marker.remove();
      live.clear();
      overlay.destroy();
      arcsRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Built once: the page mounts this only when the data is complete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The route, drawn the way the app draws it: the recorded line cut at every
   * long jump, a line over each gap (a bow only where the plan says a
   * flight), and the plan itself underneath: a pin per place, a line to each
   * one nothing recorded, dashed where the day is still to come.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const layerId of map.getLayersOrder().filter((l) => l.startsWith('share-route-'))) {
      map.removeLayer(layerId);
    }
    for (const sourceId of Object.keys(map.getStyle().sources)) {
      if (sourceId.startsWith('share-route-')) map.removeSource(sourceId);
    }

    // Everything that actually happened, for a planned leg to be measured
    // against: the tracked fixes and the places photos were taken.
    const realPoints: [number, number][] = [];

    for (const { userId, ground, gaps, flights, trimmed } of drawn.lines) {
      const id = `share-route-${userId}`;
      realPoints.push(...trimmed);
      const colour = colorForUser(userId);
      addLines(map, id, ground, { 'line-color': colour, 'line-width': 3 });
      // Drawn like the line either side of it: a journey that happened is
      // solid, whether or not the tracker was awake for it. Dashes are for
      // what is still to come.
      if (gaps.length > 0) addLines(map, `${id}-gaps`, gaps, { 'line-color': colour, 'line-width': 3 });
      // Dashed, and grey: the arc is drawn, not recorded.
      if (flights.length > 0) {
        addLines(map, `${id}-flights`, flights, {
          'line-color': '#8a94a3',
          'line-width': 2,
          'line-dasharray': [1.4, 2.6],
        });
      }
    }

    for (const photo of photos) {
      if (photo.latitude === null || photo.longitude === null) continue;
      realPoints.push([photo.longitude, photo.latitude]);
    }

    // The traveller's own colour where there is a track to join up with, beige
    // where the trip is still only a plan.
    const firstUser = drawn.lines[0]?.userId;
    const gapColour = realPoints.length > 0 && firstUser ? colorForUser(firstUser) : '#ffc46b';

    let markers: maplibregl.Marker[] = [];
    try {
      const planned = drawPlannedStops(map, { stops, realPoints, gapColour });
      markers = planned.markers;
      arcsRef.current?.setTracks(planned.tracks);
    } catch {
      // A style mid-swap refuses a new source; a missing line beats taking the
      // page down with it.
    }
    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [ready, drawn, stops, photos]);

  // Photo markers, clustered per zoom level exactly like the app's map. Placing
  // one marker per photo piles hundreds of DOM nodes on top of each other,
  // which is both unreadable and slow on a phone.
  //
  // Markers are kept between redraws and keyed by their cluster cell.
  // Rebuilding the whole set on every zoom meant every visible thumbnail was
  // requested again, mid-gesture, which is what made panning stutter.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const live = markersRef.current;
    const withGps = photos.filter((m) => m.latitude !== null && m.longitude !== null);

    const draw = () => {
      // The LEVEL is rounded, so the grid only changes on a real step of zoom.
      const level = Math.round(map.getZoom());
      const cell = 40 / 2 ** level;

      // Only what is on screen, plus a screen's worth of margin so a pan does
      // not arrive at empty map.
      const view = map.getBounds();
      const padLng = (view.getEast() - view.getWest()) / 2;
      const padLat = (view.getNorth() - view.getSouth()) / 2;
      const inView = (lat: number, lon: number) =>
        lon >= view.getWest() - padLng &&
        lon <= view.getEast() + padLng &&
        lat >= view.getSouth() - padLat &&
        lat <= view.getNorth() + padLat;

      const clusters = new Map<string, ShareMapPhoto[]>();
      for (const item of withGps) {
        if (!inView(item.latitude!, item.longitude!)) continue;
        const key = `${Math.round(item.latitude! / cell)}:${Math.round(item.longitude! / cell)}`;
        const list = clusters.get(key) ?? [];
        list.push(item);
        clusters.set(key, list);
      }

      for (const [key, marker] of live) {
        if (clusters.has(key)) continue;
        marker.remove();
        live.delete(key);
      }

      for (const [key, items] of clusters) {
        if (live.has(key)) continue;
        const rep = items[0]!;
        const el = document.createElement('div');
        el.className = 'photo-marker';
        el.style.borderColor = colorForUser(rep.userId);
        el.style.backgroundImage = `url(${thumbFor(rep.id)})`;
        if (items.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'photo-marker-count';
          badge.textContent = items.length > 99 ? '99+' : String(items.length);
          el.appendChild(badge);
        }
        // A single photo opens; a cluster zooms in until it splits.
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (items.length > 1) {
            map.easeTo({
              center: [rep.longitude!, rep.latitude!],
              zoom: Math.min(map.getZoom() + 2.5, 16),
            });
          } else {
            openRef.current(rep.id);
          }
        });
        live.set(
          key,
          new maplibregl.Marker({ element: el }).setLngLat([rep.longitude!, rep.latitude!]).addTo(map),
        );
      }
    };

    // Redraws land on a frame of their own, and never more than one per frame:
    // moveend after a fling fires alongside zoomend, and doing the work twice
    // in the same tick is a visible hitch.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };

    draw();
    map.on('moveend', schedule);
    return () => {
      map.off('moveend', schedule);
      cancelAnimationFrame(frame);
    };
  }, [ready, photos, thumbFor]);

  return (
    <>
      <div ref={containerRef} className="share-map-inner" />
      {/* Back to the whole trip. Panning and pinching a map is how you get
          lost on one, and a map you cannot get back from is a map you stop
          touching. Only where there is a whole trip to go back to. */}
      {ready && drawn.bounds && (
        <button
          type="button"
          className="share-map-recenter"
          aria-label={t('share.page.recenter')}
          title={t('share.page.recenter')}
          onClick={() => {
            if (drawn.bounds) mapRef.current?.fitBounds(drawn.bounds, { ...FIT, duration: 700 });
          }}
        >
          <Icon name="reload" size={17} />
        </button>
      )}
    </>
  );
}

/** One line layer over its own source, both under the same `share-route-` id. */
function addLines(
  map: MapLibreMap,
  id: string,
  coordinates: [number, number][][],
  paint: Record<string, unknown>,
): void {
  map.addSource(id, {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates }, properties: {} },
  });
  map.addLayer({
    id: `${id}-line`,
    type: 'line',
    source: id,
    paint,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  } as maplibregl.LayerSpecification);
}
