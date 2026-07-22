import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { CityThumb } from '../components/CityThumb';
import { FlightEditor } from '../components/FlightEditor';
import { WeatherBadge } from '../components/WeatherBadge';
import { airportByCode } from '../lib/airports';
import { estimateDuration, greatCircleArc, haversineKm } from '../lib/arc';
import { flagEmoji, formatDate } from '../lib/colors';
import { PlaceSuggestion, searchPlaces } from '../lib/geocode';
import { getMapStyle } from '../lib/prefs';
import './plan.css';

const MAP_STYLE = getMapStyle();

interface PlannedStop {
  id: string;
  name: string;
  notes: string | null;
  nights: number;
  orderIndex: number;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  travelMode: 'GROUND' | 'FLIGHT';
  flightNumber: string | null;
  fromAirport: string | null;
  toAirport: string | null;
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

  const plannedNights = stops.reduce((sum, s) => sum + s.nights, 0);
  const tripNights = trip
    ? Math.round(
        (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86_400_000,
      )
    : 0;

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
    map.on('style.load', () => map.setProjection({ type: 'globe' }));
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

      // Legs: one line feature per pair, flights as great-circle arcs.
      const legFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      for (let i = 1; i < located.length; i++) {
        const prev = located[i - 1]!;
        const cur = located[i]!;
        const depAp = airportByCode(cur.fromAirport);
        const arrAp = airportByCode(cur.toAirport);
        const from: [number, number] = depAp
          ? [depAp.lon, depAp.lat]
          : [prev.longitude!, prev.latitude!];
        const to: [number, number] = arrAp
          ? [arrAp.lon, arrAp.lat]
          : [cur.longitude!, cur.latitude!];
        const feature =
          cur.travelMode === 'FLIGHT'
            ? greatCircleArc(from, to)
            : ({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [from, to] },
                properties: {},
              } as GeoJSON.Feature<GeoJSON.LineString>);
        feature.properties = { flight: cur.travelMode === 'FLIGHT' };
        legFeatures.push(feature);
      }
      const legData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: legFeatures,
      };
      const existing = map.getSource('plan-line') as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(legData);
      } else if (located.length >= 2) {
        map.addSource('plan-line', { type: 'geojson', data: legData });
        map.addLayer({
          id: 'plan-line',
          type: 'line',
          source: 'plan-line',
          paint: {
            'line-color': ['case', ['get', 'flight'], '#5b6ee1', '#e8613c'],
            'line-width': 2.5,
            'line-dasharray': [1, 1.6],
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

  async function toggleMode(stop: PlannedStop) {
    if (!tripId) return;
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/${stop.id}`, {
        method: 'PATCH',
        body: { travelMode: stop.travelMode === 'FLIGHT' ? 'GROUND' : 'FLIGHT' },
      }),
    );
  }

  async function saveFlight(
    stop: PlannedStop,
    data: { flightNumber?: string; fromAirport?: string; toAirport?: string },
  ) {
    if (!tripId) return;
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/${stop.id}`, {
        method: 'PATCH',
        body: data,
      }),
    );
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
        <div className="plan-head">
          <Link to={`/trips/${tripId}`} className="muted plan-back">
            ← Terug naar de reis
          </Link>
          <h1>Routeplanner</h1>
          {trip && (
            <p className="muted">
              {trip.title} · {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
            </p>
          )}
          {trip && (
            <div className="nights-planned">
              <span className="nights-ring" data-full={plannedNights >= tripNights}>
                ●
              </span>
              {plannedNights}/{tripNights} nachten gepland
            </div>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}

        {stops.length === 0 && (
          <div className="plan-empty">
            <span>🧭</span>
            <p className="muted">
              Nog geen stops. Zoek hieronder een stad en bouw je route op — versleep om te
              herordenen, tik het icoontje tussen stops voor een vlucht.
            </p>
          </div>
        )}

        <ol className="stop-list">
          {stops.map((stop, index) => {
            const prev = index > 0 ? stops[index - 1] : null;
            const legKm =
              prev &&
              prev.latitude !== null &&
              prev.longitude !== null &&
              stop.latitude !== null &&
              stop.longitude !== null
                ? haversineKm(
                    [prev.longitude, prev.latitude],
                    [stop.longitude, stop.latitude],
                  )
                : null;
            return (
            <li key={stop.id} className="stop-row">
              {index > 0 && (
                <button
                  className={`leg-toggle ${stop.travelMode === 'FLIGHT' ? 'flight' : ''}`}
                  onClick={() => toggleMode(stop)}
                  title="Klik om te wisselen tussen over land en vlucht"
                >
                  <span className="leg-icon">{stop.travelMode === 'FLIGHT' ? '✈' : '🚗'}</span>
                  {legKm !== null ? (
                    <>
                      {legKm.toLocaleString('nl-NL')} km
                      <span className="leg-dur">· {estimateDuration(legKm, stop.travelMode)}</span>
                    </>
                  ) : stop.travelMode === 'FLIGHT' ? (
                    'Vlucht'
                  ) : (
                    'Over land'
                  )}
                </button>
              )}
              {index > 0 && stop.travelMode === 'FLIGHT' && (
                <FlightEditor
                  flightNumber={stop.flightNumber}
                  fromAirport={stop.fromAirport}
                  toAirport={stop.toAirport}
                  onSave={(data) => void saveFlight(stop, data)}
                />
              )}
              <div
                className={`card stop-item ${dragIndex === index ? 'dragging' : ''}`}
                draggable
                onDragStart={() => onDragStart(index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDragEnd={onDrop}
              >
                <CityThumb name={stop.name} index={index} countryCode={stop.countryCode} />
                <div className="stop-info">
                  <strong>{stop.name}</strong>
                  <span className="muted">
                    {formatDate(stop.arrivalDate)}
                    {stop.nights > 0 && ` → ${formatDate(stop.departureDate)}`}
                    {stop.latitude !== null && stop.longitude !== null && (
                      <>
                        {' · '}
                        <WeatherBadge
                          lat={stop.latitude}
                          lon={stop.longitude}
                          day={stop.arrivalDate}
                        />
                      </>
                    )}
                  </span>
                </div>
                <div className="stop-nights">
                  <span className="nights-count">
                    {stop.nights} {stop.nights === 1 ? 'nacht' : 'nachten'}
                  </span>
                  <div className="nights-buttons">
                    <button className="nights-btn" onClick={() => changeNights(stop, -1)}>
                      −
                    </button>
                    <button className="nights-btn" onClick={() => changeNights(stop, 1)}>
                      +
                    </button>
                  </div>
                </div>
                <button className="stop-delete" onClick={() => removeStop(stop)} title="Verwijderen">
                  ✕
                </button>
              </div>
            </li>
            );
          })}
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
