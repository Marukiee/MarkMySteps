import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { flagEmoji, formatDate } from '../lib/colors';
import { PlaceSuggestion, searchPlaces } from '../lib/geocode';
import './plan.css';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

interface PlannedStop {
  id: string;
  name: string;
  notes: string | null;
  nights: number;
  orderIndex: number;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  arrivalDate: string;
  departureDate: string;
}

export function PlanPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<PlannedStop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newNights, setNewNights] = useState(2);
  const [newCountry, setNewCountry] = useState<string | undefined>();
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<number | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pendingMarkerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!tripId) return;
    api<Trip>(`/trips/${tripId}`).then(setTrip).catch((e: Error) => setError(e.message));
    api<PlannedStop[]>(`/trips/${tripId}/stops`).then(setStops).catch(() => undefined);
  }, [tripId]);

  // Map init + click-to-place.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [4.9, 52.37],
      zoom: 3,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (e) => {
      setPendingCoords(e.lngLat);
      pendingMarkerRef.current?.remove();
      const el = document.createElement('div');
      el.className = 'stop-marker stop-marker-pending';
      el.textContent = '+';
      pendingMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(e.lngLat)
        .addTo(map);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Numbered stop markers + connecting line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

      const located = stops.filter((s) => s.latitude !== null && s.longitude !== null);
      const bounds = new LngLatBounds();

      for (const stop of located) {
        const el = document.createElement('div');
        el.className = 'stop-marker';
        const flag = flagEmoji(stop.countryCode);
        el.textContent = flag || String(stop.orderIndex + 1);
        markersRef.current.push(
          new maplibregl.Marker({ element: el })
            .setLngLat([stop.longitude!, stop.latitude!])
            .setPopup(new maplibregl.Popup({ offset: 18 }).setText(stop.name))
            .addTo(map),
        );
        bounds.extend([stop.longitude!, stop.latitude!]);
      }

      const lineData = {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: located.map((s) => [s.longitude!, s.latitude!]),
        },
        properties: {},
      };
      const existing = map.getSource('plan-line') as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(lineData);
      } else if (located.length >= 2) {
        map.addSource('plan-line', { type: 'geojson', data: lineData });
        map.addLayer({
          id: 'plan-line',
          type: 'line',
          source: 'plan-line',
          paint: {
            'line-color': '#e8613c',
            'line-width': 2.5,
            'line-dasharray': [0.5, 1.8],
          },
          layout: { 'line-cap': 'round' },
        });
      }

      if (located.length > 0) {
        map.fitBounds(bounds, { padding: 90, maxZoom: 10, duration: 700 });
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [stops]);

  const refresh = useCallback(
    (updated: PlannedStop[]) => {
      setStops(updated);
      // Trip end date may have shifted with the plan.
      if (tripId) api<Trip>(`/trips/${tripId}`).then(setTrip).catch(() => undefined);
    },
    [tripId],
  );

  /** Debounced place search (Photon/OSM) while typing the stop name. */
  function onNameInput(value: string) {
    setNewName(value);
    setNewCountry(undefined);
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      searchPlaces(value, controller.signal)
        .then(setSuggestions)
        .catch(() => undefined);
    }, 280);
  }

  function pickSuggestion(place: PlaceSuggestion) {
    setNewName(place.name);
    setNewCountry(place.countryCode);
    setPendingCoords({ lat: place.latitude, lng: place.longitude });
    setSuggestions([]);
    mapRef.current?.easeTo({ center: [place.longitude, place.latitude], zoom: 8 });
  }

  async function addStop(event: FormEvent) {
    event.preventDefault();
    if (!tripId) return;
    try {
      const updated = await api<PlannedStop[]>(`/trips/${tripId}/stops`, {
        method: 'POST',
        body: {
          name: newName,
          nights: newNights,
          latitude: pendingCoords?.lat,
          longitude: pendingCoords?.lng,
          countryCode: newCountry,
        },
      });
      refresh(updated);
      setNewName('');
      setNewNights(2);
      setNewCountry(undefined);
      setSuggestions([]);
      setPendingCoords(null);
      pendingMarkerRef.current?.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stop toevoegen mislukt');
    }
  }

  async function changeNights(stop: PlannedStop, delta: number) {
    if (!tripId) return;
    const nights = Math.max(0, stop.nights + delta);
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/${stop.id}`, {
        method: 'PATCH',
        body: { nights },
      }),
    );
  }

  async function removeStop(stop: PlannedStop) {
    if (!tripId) return;
    refresh(await api<PlannedStop[]>(`/trips/${tripId}/stops/${stop.id}`, { method: 'DELETE' }));
  }

  function onDragStart(index: number) {
    setDragIndex(index);
  }

  function onDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setStops((current) => {
      const next = [...current];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved!);
      return next;
    });
    setDragIndex(index);
  }

  async function onDrop() {
    setDragIndex(null);
    if (!tripId) return;
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/order`, {
        method: 'PUT',
        body: { stopIds: stops.map((s) => s.id) },
      }),
    );
  }

  return (
    <main className="plan-page fade-in">
      <aside className="plan-side">
        <Link to={`/trips/${tripId}`} className="muted plan-back">
          ← Terug naar de reis
        </Link>
        <h1>{trip?.title ?? '…'} — planning</h1>
        {trip && (
          <p className="muted">
            {formatDate(trip.startDate)} — {formatDate(trip.endDate)} · versleep stops om te
            herordenen
          </p>
        )}
        {error && <p className="error-text">{error}</p>}

        <ol className="stop-list">
          {stops.map((stop, index) => (
            <li
              key={stop.id}
              className={`card stop-item ${dragIndex === index ? 'dragging' : ''}`}
              draggable
              onDragStart={() => onDragStart(index)}
              onDragOver={(e) => onDragOver(e, index)}
              onDragEnd={onDrop}
            >
              <span className="stop-number">{index + 1}</span>
              <div className="stop-info">
                <strong>
                  {flagEmoji(stop.countryCode)} {stop.name}
                </strong>
                <span className="muted">
                  {formatDate(stop.arrivalDate)} → {formatDate(stop.departureDate)}
                </span>
              </div>
              <div className="stop-nights">
                <button className="nights-btn" onClick={() => changeNights(stop, -1)}>
                  −
                </button>
                <span>
                  {stop.nights} <small>nacht{stop.nights === 1 ? '' : 'en'}</small>
                </span>
                <button className="nights-btn" onClick={() => changeNights(stop, 1)}>
                  +
                </button>
              </div>
              <button className="stop-delete" onClick={() => removeStop(stop)} title="Verwijderen">
                ✕
              </button>
            </li>
          ))}
        </ol>

        <form className="card stop-add" onSubmit={addStop}>
          <div className="field stop-search">
            <label htmlFor="st-name">Nieuwe stop</label>
            <input
              id="st-name"
              required
              autoComplete="off"
              placeholder="Zoek een stad, bijv. Hanoi"
              value={newName}
              onChange={(e) => onNameInput(e.target.value)}
            />
            {suggestions.length > 0 && (
              <ul className="stop-suggestions card">
                {suggestions.map((place, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => pickSuggestion(place)}>
                      <span>{flagEmoji(place.countryCode)}</span>
                      <span>
                        <strong>{place.name}</strong>
                        {place.region && <small> {place.region}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="field">
            <label htmlFor="st-nights">Nachten</label>
            <input
              id="st-nights"
              type="number"
              min={0}
              max={365}
              value={newNights}
              onChange={(e) => setNewNights(Number(e.target.value))}
            />
          </div>
          <span className="muted">
            {pendingCoords
              ? `Locatie: ${pendingCoords.lat.toFixed(4)}, ${pendingCoords.lng.toFixed(4)}`
              : 'Klik op de kaart voor de locatie (optioneel)'}
          </span>
          <button className="btn btn-primary">Stop toevoegen</button>
        </form>
      </aside>

      <div className="plan-map card">
        <div ref={mapContainerRef} className="plan-map-inner" />
      </div>
    </main>
  );
}
