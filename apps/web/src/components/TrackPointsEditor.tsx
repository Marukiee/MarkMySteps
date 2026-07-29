import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { getMapStyle } from '../lib/prefs';
import { Icon } from './Icon';
import './trackedit.css';

export interface TrackedPoint {
  id: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracy: number | null;
  source: 'TRACKED' | 'MANUAL' | 'ROUTE_FILL' | 'IMPORTED';
}

interface TrackedDay {
  day: string;
  count: number;
}

const SOURCE_LABEL: Record<TrackedPoint['source'], string> = {
  TRACKED: 'GPS',
  MANUAL: 'Handmatig',
  ROUTE_FILL: 'Wegroute',
  IMPORTED: 'Import',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Check-and-fix view for one day of tracking.
 *
 * Shows the raw fixes in time order — not the smoothed line the trip map draws
 * — because the point of this screen is to see exactly what was recorded: where
 * a gap left a long straight stretch, and which fix landed in the wrong street.
 * Markers are draggable, tapping the map inserts a point into the nearest gap.
 */
export function TrackPointsEditor({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const [day, setDay] = useState(todayIso());
  const [days, setDays] = useState<TrackedDay[]>([]);
  const [points, setPoints] = useState<TrackedPoint[]>([]);
  const [selected, setSelected] = useState<TrackedPoint | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const fittedDay = useRef<string | null>(null);
  // Read inside map callbacks, which are registered once.
  const addingRef = useRef(adding);
  addingRef.current = adding;
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  }, [onClose]);

  // Back gesture closes the editor instead of leaving the settings page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    window.history.pushState({ mmsTrackEdit: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      close();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      if (!popped) window.history.back();
    };
  }, [close]);

  const load = useCallback(
    async (which: string) => {
      try {
        const list = await api<TrackedPoint[]>(
          `/trips/${tripId}/points/day?day=${encodeURIComponent(which)}`,
        );
        setPoints(list);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Punten laden mislukt');
      }
    },
    [tripId],
  );

  useEffect(() => {
    api<TrackedDay[]>(`/trips/${tripId}/points/days`)
      .then((list) => {
        setDays(list);
        // Nothing recorded today? Then open on the most recent day that has
        // something, so the screen is never pointlessly empty.
        if (list.length > 0 && !list.some((d) => d.day === todayIso())) {
          setDay(list[0]!.day);
        }
      })
      .catch(() => undefined);
  }, [tripId]);

  useEffect(() => {
    void load(day);
    setSelected(null);
  }, [day, load]);

  // --- Map ---------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(),
      center: [4.9, 52.37],
      zoom: 4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on('click', (e) => {
      if (!addingRef.current) return;
      void insertPoint(e.lngLat.lng, e.lngLat.lat);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw the line + markers whenever the day's points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

      const coords = points.map((p) => [p.longitude, p.latitude] as [number, number]);
      const data: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      };
      const existing = map.getSource('te-line') as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource('te-line', { type: 'geojson', data });
        map.addLayer({
          id: 'te-line',
          type: 'line',
          source: 'te-line',
          paint: { 'line-color': '#3884ff', 'line-width': 3 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }

      points.forEach((point, index) => {
        const el = document.createElement('div');
        el.className = `te-dot te-dot-${point.source.toLowerCase()}`;
        if (index === 0) el.classList.add('te-dot-first');
        if (index === points.length - 1) el.classList.add('te-dot-last');
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([point.longitude, point.latitude])
          .addTo(map);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelected(point);
        });
        marker.on('dragstart', () => el.classList.add('dragging'));
        marker.on('dragend', () => {
          el.classList.remove('dragging');
          const { lng, lat } = marker.getLngLat();
          void movePoint(point, lng, lat);
        });
        markersRef.current.push(marker);
      });

      // Frame the day once — later edits must not yank the camera away.
      if (coords.length > 0 && fittedDay.current !== day) {
        fittedDay.current = day;
        const bounds = new LngLatBounds();
        for (const c of coords) bounds.extend(c);
        map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 600 });
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, day]);

  // --- Editing -----------------------------------------------------------

  async function movePoint(point: TrackedPoint, lng: number, lat: number) {
    setPoints((list) =>
      list.map((p) => (p.id === point.id ? { ...p, latitude: lat, longitude: lng } : p)),
    );
    try {
      await api(`/trips/${tripId}/points/${point.id}`, {
        method: 'PATCH',
        body: { latitude: lat, longitude: lng },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Punt verplaatsen mislukt');
      void load(day);
    }
  }

  /**
   * Adds a point where you tapped. Its timestamp is the middle of the gap it
   * lands in, so the new point slots into the route at the right place instead
   * of being tacked onto the end of the day.
   */
  async function insertPoint(lng: number, lat: number) {
    const list = pointsRef.current;
    let recordedAt = `${day}T12:00:00.000Z`;
    if (list.length === 1) {
      recordedAt = new Date(new Date(list[0]!.recordedAt).getTime() + 60_000).toISOString();
    } else if (list.length > 1) {
      let best = { index: 1, distance: Number.POSITIVE_INFINITY };
      for (let i = 1; i < list.length; i++) {
        const d = pointToSegment(
          [lng, lat],
          [list[i - 1]!.longitude, list[i - 1]!.latitude],
          [list[i]!.longitude, list[i]!.latitude],
        );
        if (d < best.distance) best = { index: i, distance: d };
      }
      const a = new Date(list[best.index - 1]!.recordedAt).getTime();
      const b = new Date(list[best.index]!.recordedAt).getTime();
      recordedAt = new Date((a + b) / 2).toISOString();
    }

    setBusy(true);
    try {
      await api(`/trips/${tripId}/points`, {
        method: 'POST',
        body: { latitude: lat, longitude: lng, recordedAt },
      });
      await load(day);
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Punt toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/trips/${tripId}/points/${selected.id}`, { method: 'DELETE' });
      setSelected(null);
      await load(day);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Punt verwijderen mislukt');
    } finally {
      setBusy(false);
    }
  }

  const dayOptions = days.some((d) => d.day === todayIso())
    ? days
    : [{ day: todayIso(), count: 0 }, ...days];

  return createPortal(
    <div className={`te-layer ${closing ? 'closing' : ''}`}>
      <header className="te-head">
        <button type="button" className="te-icon-btn" aria-label="Sluiten" onClick={close}>
          <Icon name="close" size={20} />
        </button>
        <div className="te-title">
          <strong>Punten van {day === todayIso() ? 'vandaag' : day}</strong>
          <small>
            {points.length} {points.length === 1 ? 'punt' : 'punten'}
          </small>
        </div>
      </header>

      <div className="te-days">
        {dayOptions.map((d) => (
          <button
            key={d.day}
            type="button"
            className={`te-day ${d.day === day ? 'active' : ''}`}
            onClick={() => setDay(d.day)}
          >
            {d.day === todayIso() ? 'Vandaag' : d.day.slice(8) + '-' + d.day.slice(5, 7)}
            <small>{d.count}</small>
          </button>
        ))}
      </div>

      <div className="te-map">
        <div ref={containerRef} className="te-map-inner" />
        {adding && <div className="te-hint">Tik op de kaart om een punt toe te voegen</div>}
      </div>

      {error && <p className="error-text te-error">{error}</p>}

      {/* The detail bar slides up when a point is selected and takes the
          toolbar's place, so the two never fight for the same strip. */}
      <div className="te-bar" data-mode={selected ? 'point' : 'tools'}>
        <div className="te-bar-tools">
          <button
            type="button"
            className={`btn ${adding ? 'btn-primary' : 'btn-ghost'}`}
            disabled={busy}
            onClick={() => setAdding((v) => !v)}
          >
            <Icon name="plus" size={16} /> {adding ? 'Klaar' : 'Punt toevoegen'}
          </button>
          <span className="muted te-legend">Sleep een punt om de route te corrigeren</span>
        </div>
        <div className="te-bar-point">
          {selected && (
            <>
              <span className="te-point-info">
                <strong>{clock(selected.recordedAt)}</strong>
                <small>
                  {SOURCE_LABEL[selected.source]}
                  {selected.accuracy != null && ` · ±${Math.round(selected.accuracy)} m`}
                </small>
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
                Sluiten
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void removeSelected()}
              >
                <Icon name="trash" size={15} /> Verwijderen
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Rough planar distance from p to segment a→b, in degrees. Good enough to
 *  decide which gap a tap belongs to. */
function pointToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
