import { DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { CityThumb } from './CityThumb';
import { FlightEditor } from './FlightEditor';
import { Icon, MODE_ICON } from './Icon';
import { WeatherBadge } from './WeatherBadge';
import {
  estimateDuration,
  haversineKm,
  MODE_LABEL,
  PlannedStop,
  TRAVEL_MODES,
  TravelMode,
} from '../lib/arc';
import { flagEmoji, formatDate } from '../lib/colors';
import { PlaceSuggestion, searchPlaces } from '../lib/geocode';
import '../pages/plan.css';

// Names used for the standalone outbound/return legs (any travel mode).
const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

interface TripPlannerProps {
  tripId: string;
  trip: Trip | null;
  stops: PlannedStop[];
  /** Push the edited stop list up so the shared map redraws. */
  onStopsChange: (stops: PlannedStop[]) => void;
  /** Let the parent refresh trip-level data (end date may shift with the plan). */
  onChanged?: () => void;
  /** A location tapped on the shared map, used for the next stop. */
  pickedCoords: { lat: number; lng: number } | null;
  onPickConsumed: () => void;
  /** Ease the shared map to a searched place. */
  onFlyTo: (lng: number, lat: number) => void;
}

/**
 * Inline route planner: the same stop list / flight legs as the standalone page
 * but driven by the trip detail map (no second map instance to reload).
 */
export function TripPlanner({
  tripId,
  trip,
  stops,
  onStopsChange,
  onChanged,
  pickedCoords,
  onPickConsumed,
  onFlyTo,
}: TripPlannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newNights, setNewNights] = useState(2);
  const [newCountry, setNewCountry] = useState<string | undefined>();
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<number | null>(null);

  const plannedNights = stops.reduce((sum, s) => sum + s.nights, 0);
  const tripNights = trip
    ? Math.round(
        (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86_400_000,
      )
    : 0;

  // A standalone heen-/terugreis leg has no city of its own (any travel mode).
  const isStandaloneLeg = (s?: PlannedStop) =>
    !!s && s.latitude === null && s.longitude === null && LEG_NAMES.has(s.name);
  const hasOutbound = isStandaloneLeg(stops[0]);
  const hasReturn = isStandaloneLeg(stops[stops.length - 1]);

  const refresh = (updated: PlannedStop[]) => {
    onStopsChange(updated);
    onChanged?.();
  };

  function onNameInput(value: string) {
    setNewName(value);
    setNewCountry(undefined);
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      searchPlaces(value, controller.signal).then(setSuggestions).catch(() => undefined);
    }, 280);
  }

  function pickSuggestion(place: PlaceSuggestion) {
    setNewName(place.name);
    setNewCountry(place.countryCode);
    setSuggestions([]);
    onFlyTo(place.longitude, place.latitude);
    // Reuse the map-pick channel so the coordinate is attached to the new stop.
    pickedForNext.current = { lat: place.latitude, lng: place.longitude };
  }

  // A suggestion carries its own coordinate; a map tap carries one too. Whichever
  // came last wins for the next stop.
  const pickedForNext = useRef<{ lat: number; lng: number } | null>(null);
  const effectivePick = pickedCoords ?? pickedForNext.current;

  async function addStop(event: FormEvent) {
    event.preventDefault();
    try {
      const updated = await api<PlannedStop[]>(`/trips/${tripId}/stops`, {
        method: 'POST',
        body: {
          name: newName,
          nights: newNights,
          latitude: effectivePick?.lat,
          longitude: effectivePick?.lng,
          countryCode: newCountry,
        },
      });
      refresh(updated);
      setNewName('');
      setNewNights(2);
      setNewCountry(undefined);
      setSuggestions([]);
      pickedForNext.current = null;
      onPickConsumed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stop toevoegen mislukt');
    }
  }

  async function saveFlight(
    stop: PlannedStop,
    data: { flightNumber?: string; fromAirport?: string; toAirport?: string; viaAirports?: string[] },
  ) {
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/${stop.id}`, { method: 'PATCH', body: data }),
    );
  }

  async function changeNights(stop: PlannedStop, delta: number) {
    const nights = Math.max(0, stop.nights + delta);
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/${stop.id}`, {
        method: 'PATCH',
        body: { nights },
      }),
    );
  }

  async function removeStop(stop: PlannedStop) {
    refresh(await api<PlannedStop[]>(`/trips/${tripId}/stops/${stop.id}`, { method: 'DELETE' }));
  }

  async function addReturnLeg(mode: TravelMode) {
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops`, {
        method: 'POST',
        body: { name: 'Terugreis', nights: 0, travelMode: mode },
      }),
    );
  }

  async function addOutboundLeg(mode: TravelMode) {
    const created = await api<PlannedStop[]>(`/trips/${tripId}/stops`, {
      method: 'POST',
      body: { name: 'Heenreis', nights: 0, travelMode: mode },
    });
    const added = created[created.length - 1];
    if (!added) return refresh(created);
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/order`, {
        method: 'PUT',
        body: { stopIds: [added.id, ...created.filter((s) => s.id !== added.id).map((s) => s.id)] },
      }),
    );
  }

  async function setStopMode(stop: PlannedStop, mode: TravelMode) {
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/${stop.id}`, {
        method: 'PATCH',
        body: { travelMode: mode },
      }),
    );
  }

  function onDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    if (index !== overIndex) setOverIndex(index);
  }

  async function onDrop() {
    const from = dragIndex;
    const to = overIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || to === null || from === to) return;
    const next = [...stops];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onStopsChange(next); // optimistic
    refresh(
      await api<PlannedStop[]>(`/trips/${tripId}/stops/order`, {
        method: 'PUT',
        body: { stopIds: next.map((s) => s.id) },
      }),
    );
  }

  return (
    <div className="trip-planner">
      {trip && (
        <div className="nights-planned">
          <span className="nights-ring" data-full={plannedNights >= tripNights}>
            ●
          </span>
          {plannedNights}/{tripNights} nachten gepland
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {stops.length === 0 && (
        <div className="plan-empty">
          <span className="plan-empty-icon">
            <Icon name="compass" size={30} />
          </span>
          <p className="muted">
            Nog geen stops. Zoek hieronder een stad en bouw je route op — versleep om te herordenen.
            Tik het vervoer-pilletje bij een stop om te wisselen tussen auto, trein, bus, boot of
            vlucht.
          </p>
        </div>
      )}

      {!hasOutbound && (
        <ModeMenu label="Heenreis" onPick={(m) => void addOutboundLeg(m)} />
      )}

      <ol className="stop-list">
        {stops.map((stop, index) => {
          if (isStandaloneLeg(stop)) {
            return (
              <li key={stop.id} className="stop-row">
                <div className="flight-leg card">
                  <div className="flight-leg-head">
                    <strong className="flight-leg-name">{stop.name}</strong>
                    {stop.travelMode === 'FLIGHT' && (
                      <FlightEditor
                        flightNumber={stop.flightNumber}
                        fromAirport={stop.fromAirport}
                        toAirport={stop.toAirport}
                        viaAirports={stop.viaAirports}
                        onSave={(data) => void saveFlight(stop, data)}
                      />
                    )}
                    <ModeMenu
                      current={stop.travelMode}
                      compact
                      align="right"
                      onPick={(m) => void setStopMode(stop, m)}
                    />
                  </div>
                  <button
                    className="stop-delete"
                    onClick={() => removeStop(stop)}
                    aria-label="Reis verwijderen"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              </li>
            );
          }
          const prev = index > 0 ? stops[index - 1] : null;
          const prevIsStandalone = isStandaloneLeg(prev ?? undefined);
          const isFlight = stop.travelMode === 'FLIGHT';
          const legKm =
            prev &&
            prev.latitude !== null &&
            prev.longitude !== null &&
            stop.latitude !== null &&
            stop.longitude !== null
              ? haversineKm([prev.longitude, prev.latitude], [stop.longitude, stop.latitude])
              : null;
          return (
            <li key={stop.id} className="stop-row">
              {/* Incoming leg: a mode dropdown (same as heenreis), plus the
                  flight editor when it's a flight. Only from the 2nd stop on —
                  the first stop's arrival is the heenreis. */}
              {index > 0 && !prevIsStandalone && (
                <div className="leg-connector">
                  <div className="leg-connector-row">
                    <ModeMenu
                      current={stop.travelMode}
                      compact
                      onPick={(m) => void setStopMode(stop, m)}
                    />
                    {legKm !== null && (
                      <span className="leg-dur">
                        {legKm.toLocaleString('nl-NL')} km · {estimateDuration(legKm, stop.travelMode)}
                      </span>
                    )}
                  </div>
                  {isFlight && (
                    <FlightEditor
                      flightNumber={stop.flightNumber}
                      fromAirport={stop.fromAirport}
                      toAirport={stop.toAirport}
                      viaAirports={stop.viaAirports}
                      onSave={(data) => void saveFlight(stop, data)}
                    />
                  )}
                </div>
              )}
              <div
                className={`card stop-item ${dragIndex === index ? 'dragging' : ''} ${
                  overIndex === index && dragIndex !== null && dragIndex !== index
                    ? dragIndex < index
                      ? 'drop-after'
                      : 'drop-before'
                    : ''
                }`}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDragEnd={onDrop}
                onDrop={onDrop}
              >
                <CityThumb name={stop.name} index={index} countryCode={stop.countryCode} />
                <div className="stop-info">
                  <strong>{stop.name}</strong>
                  <span className="muted">
                    {formatDate(stop.arrivalDate)}
                    {stop.nights > 0 && ` – ${formatDate(stop.departureDate)}`}
                    {stop.latitude !== null && stop.longitude !== null && (
                      <>
                        {' · '}
                        <WeatherBadge lat={stop.latitude} lon={stop.longitude} day={stop.arrivalDate} />
                      </>
                    )}
                  </span>
                </div>
                <div className="stop-nights">
                  <div className="nights-buttons">
                    <button
                      className="nights-btn"
                      onClick={() => changeNights(stop, -1)}
                      aria-label="Minder nachten"
                    >
                      <Icon name="minus" size={16} />
                    </button>
                    <span className="nights-count">
                      {stop.nights}
                      <small>{stop.nights === 1 ? 'nacht' : 'nachten'}</small>
                    </span>
                    <button
                      className="nights-btn"
                      onClick={() => changeNights(stop, 1)}
                      aria-label="Meer nachten"
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                </div>
                <button
                  className="stop-delete"
                  onClick={() => removeStop(stop)}
                  aria-label="Stop verwijderen"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {!hasReturn && <ModeMenu label="Terugreis" onPick={(m) => void addReturnLeg(m)} />}

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
          {effectivePick
            ? `Locatie: ${effectivePick.lat.toFixed(4)}, ${effectivePick.lng.toFixed(4)}`
            : 'Tik op de kaart voor de locatie (optioneel)'}
        </span>
        <button className="btn btn-primary">Stop toevoegen</button>
      </form>
    </div>
  );
}

/** A pill with a dropdown to pick a travel mode (car/train/bus/boat/flight).
 *  Used to add an outbound/return leg, and to change a standalone leg's mode. */
function ModeMenu({
  label,
  current,
  compact,
  align = 'left',
  onPick,
}: {
  label?: string;
  current?: TravelMode;
  compact?: boolean;
  align?: 'left' | 'right';
  onPick: (mode: TravelMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 140);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const icon = current ? MODE_ICON[current] ?? 'car' : 'plus';
  const text = label ?? MODE_LABEL[current!];

  return (
    <div className={`mode-menu ${compact ? 'mode-menu-compact' : ''}`} ref={ref}>
      <button
        type="button"
        className="mode-menu-pill"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name={icon} size={compact ? 14 : 16} />
        <span>{text}</span>
        <Icon name="chevron-down" size={13} className="mode-menu-caret" />
      </button>
      {open && (
        <div className={`mode-menu-drop card mode-menu-${align} ${closing ? 'closing' : ''}`}>
          {TRAVEL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={current === m ? 'active' : ''}
              onClick={() => {
                onPick(m);
                setOpen(false);
              }}
            >
              <Icon name={MODE_ICON[m] ?? 'car'} size={16} />
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
