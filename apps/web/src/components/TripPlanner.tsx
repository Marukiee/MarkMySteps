import {
  CSSProperties,
  DragEvent,
  FormEvent,
  ReactNode,
  TouchEvent as ReactTouchEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { CityThumb } from './CityThumb';
import { DateField } from './DatePicker';
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
import { flagEmoji, formatDate, formatDateRange } from '../lib/colors';
import { PlaceSuggestion, searchPlaces } from '../lib/geocode';
import { cachePutJson } from '../lib/offlineCache';
import { enqueueWrite, onPendingChange } from '../lib/pendingWrites';
import {
  localCreate,
  localDelete,
  localReorder,
  localUpdate,
} from '../lib/plannerLocal';
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

  // Day trips hang off a stop; they are not rows of the route, so everything
  // that walks the itinerary (numbering, legs, dragging) uses `route`.
  const route = stops.filter((s) => !s.parentStopId);
  const dayTripsByParent = new Map<string, PlannedStop[]>();
  for (const s of stops) {
    if (!s.parentStopId) continue;
    dayTripsByParent.set(s.parentStopId, [...(dayTripsByParent.get(s.parentStopId) ?? []), s]);
  }

  const plannedNights = route.reduce((sum, s) => sum + s.nights, 0);
  const tripNights = trip
    ? Math.round(
        (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86_400_000,
      )
    : 0;

  // A standalone heen-/terugreis leg is identified by its name ALONE. It may
  // well carry a coordinate (the begin/end point you picked); that must not turn
  // it back into a normal stop row — it stays the slim leg bar.
  const isStandaloneLeg = (s?: PlannedStop) => !!s && LEG_NAMES.has(s.name);
  const hasOutbound = isStandaloneLeg(route[0]);
  const hasReturn = isStandaloneLeg(route[route.length - 1]);

  // First/last real city (with coordinates) — used to auto-fill airports on the
  // outbound/return flight legs.
  const cityCoord = (s?: PlannedStop | null): [number, number] | null =>
    s && !isStandaloneLeg(s) && s.latitude !== null && s.longitude !== null
      ? [s.longitude, s.latitude]
      : null;
  const firstCity = cityCoord(route.find((s) => cityCoord(s)));
  const lastCity = cityCoord([...route].reverse().find((s) => cityCoord(s)));

  const refresh = (updated: PlannedStop[]) => {
    onStopsChange(updated);
    onChanged?.();
  };

  /**
   * Every planner edit goes through here.
   *
   * With a connection it is a plain API call and the server answers with the
   * recomputed list. Without one the same rules are applied locally, the list
   * is written to the read cache so it survives a restart, and the request is
   * queued to be replayed once there is a network again.
   */
  const tripStart = trip?.startDate ?? route[0]?.arrivalDate ?? new Date().toISOString();

  async function mutate(
    path: string,
    method: string,
    body: unknown,
    local: (current: PlannedStop[]) => PlannedStop[],
  ): Promise<PlannedStop[]> {
    try {
      return await api<PlannedStop[]>(path, { method, body });
    } catch (err) {
      // A status means the server answered and refused; only a missing network
      // is worth queueing.
      if (typeof (err as { status?: number }).status === 'number') throw err;
      enqueueWrite({ path, method, body });
      const next = local(stops);
      void cachePutJson(`/trips/${tripId}/stops`, next);
      return next;
    }
  }

  const stopsPath = `/trips/${tripId}/stops`;

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
      const body = {
        id: crypto.randomUUID(),
        name: newName,
        nights: newNights,
        latitude: effectivePick?.lat,
        longitude: effectivePick?.lng,
        countryCode: newCountry,
      };
      const updated = await mutate(stopsPath, 'POST', body, (current) =>
        localCreate(current, tripStart, body),
      );
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
      await mutate(`${stopsPath}/${stop.id}`, 'PATCH', data, (current) =>
        localUpdate(current, tripStart, stop.id, data),
      ),
    );
  }

  // Give a standalone heen-/terugreis leg an origin/destination coordinate, so
  // its driven kilometres get counted toward the trip distance.
  async function saveLegLocation(
    stop: PlannedStop,
    data: { latitude: number; longitude: number; countryCode?: string; notes?: string },
  ) {
    refresh(
      await mutate(`${stopsPath}/${stop.id}`, 'PATCH', data, (current) =>
        localUpdate(current, tripStart, stop.id, data),
      ),
    );
  }

  async function changeNights(stop: PlannedStop, delta: number) {
    const nights = Math.max(0, stop.nights + delta);
    refresh(
      await mutate(`${stopsPath}/${stop.id}`, 'PATCH', { nights }, (current) =>
        localUpdate(current, tripStart, stop.id, { nights }),
      ),
    );
  }

  // How many edits are still waiting for a connection, so it's clear the plan
  // is saved on the device rather than lost.
  const [pending, setPending] = useState(0);
  useEffect(() => onPendingChange((list) => setPending(list.length)), []);

  // Which stop currently has its "add a day trip" panel expanded.
  const [dayTripFor, setDayTripFor] = useState<string | null>(null);

  /** An excursion from `parent` and back the same day (Saltsjöbaden → Stockholm). */
  async function addDayTrip(parent: PlannedStop, place: PlaceSuggestion, day: string) {
    try {
      const body = {
        id: crypto.randomUUID(),
        name: place.name,
        nights: 0,
        latitude: place.latitude,
        longitude: place.longitude,
        countryCode: place.countryCode,
        parentStopId: parent.id,
        dayTripDate: day,
      };
      refresh(
        await mutate(stopsPath, 'POST', body, (current) => localCreate(current, tripStart, body)),
      );
      onFlyTo(place.longitude, place.latitude);
      setDayTripFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dagtrip toevoegen mislukt');
    }
  }

  async function setDayTripDate(dayTrip: PlannedStop, day: string) {
    refresh(
      await mutate(`${stopsPath}/${dayTrip.id}`, 'PATCH', { dayTripDate: day }, (current) =>
        localUpdate(current, tripStart, dayTrip.id, { dayTripDate: day }),
      ),
    );
  }

  // Deleting plays a collapse animation first, then hits the API — otherwise the
  // row (a leg bar especially) just blinks out of existence.
  const [removingId, setRemovingId] = useState<string | null>(null);

  /** What the last delete removed, so it can be put back. Deleting a stop takes
   *  its day trips with it, so those are remembered too. */
  const [undo, setUndo] = useState<{
    stop: PlannedStop;
    dayTrips: PlannedStop[];
    afterId: string | null;
  } | null>(null);
  const undoTimer = useRef<number | null>(null);

  const offerUndo = (entry: NonNullable<typeof undo>) => {
    setUndo(entry);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
  };

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  async function removeStop(stop: PlannedStop) {
    // Captured before the delete, because that is when the route still knows
    // where this stop sat and which day trips hung off it.
    const previous = stop.parentStopId
      ? null
      : route[route.findIndex((s) => s.id === stop.id) - 1]?.id ?? null;
    const children = stop.parentStopId ? [] : dayTripsByParent.get(stop.id) ?? [];

    setRemovingId(stop.id);
    await new Promise((r) => window.setTimeout(r, 240));
    try {
      refresh(
        await mutate(`${stopsPath}/${stop.id}`, 'DELETE', undefined, (current) =>
          localDelete(current, tripStart, stop.id),
        ),
      );
      offerUndo({ stop, dayTrips: children, afterId: previous });
    } finally {
      setRemovingId(null);
    }
  }

  /** Re-creates the deleted stop where it was, with its day trips. */
  async function undoDelete() {
    if (!undo) return;
    const { stop, dayTrips, afterId } = undo;
    setUndo(null);
    try {
      // Re-created with its ORIGINAL id: nothing else refers to it any more,
      // and keeping it means the day trips can be hung back on it without
      // having to work out which row is the new one.
      const body = {
        id: stop.id,
        name: stop.name,
        nights: stop.nights,
        latitude: stop.latitude ?? undefined,
        longitude: stop.longitude ?? undefined,
        countryCode: stop.countryCode ?? undefined,
        travelMode: stop.travelMode,
        flightNumber: stop.flightNumber ?? undefined,
        fromAirport: stop.fromAirport ?? undefined,
        toAirport: stop.toAirport ?? undefined,
        viaAirports: stop.viaAirports?.length ? stop.viaAirports : undefined,
        notes: stop.notes ?? undefined,
        parentStopId: stop.parentStopId ?? undefined,
        dayTripDate: stop.parentStopId ? stop.arrivalDate.slice(0, 10) : undefined,
        afterStopId: afterId ?? undefined,
      };
      let list = await mutate(stopsPath, 'POST', body, (current) =>
        localCreate(current, tripStart, body),
      );

      for (const child of dayTrips) {
        const childBody = {
          id: child.id,
          name: child.name,
          nights: 0,
          latitude: child.latitude ?? undefined,
          longitude: child.longitude ?? undefined,
          countryCode: child.countryCode ?? undefined,
          parentStopId: stop.id,
          dayTripDate: child.arrivalDate.slice(0, 10),
        };
        list = await mutate(stopsPath, 'POST', childBody, (current) =>
          localCreate(current, tripStart, childBody),
        );
      }

      // afterStopId has no way to say "at the very front", so a stop that was
      // first is put back there with an explicit reorder.
      if (!stop.parentStopId && afterId === null) {
        const order = [
          stop.id,
          ...list.filter((s) => !s.parentStopId && s.id !== stop.id).map((s) => s.id),
        ];
        list = await mutate(`${stopsPath}/order`, 'PUT', { stopIds: order }, (current) =>
          localReorder(current, tripStart, order),
        );
      }
      refresh(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terugzetten mislukt');
    }
  }

  async function addReturnLeg(mode: TravelMode) {
    const body = { id: crypto.randomUUID(), name: 'Terugreis', nights: 0, travelMode: mode };
    refresh(
      await mutate(stopsPath, 'POST', body, (current) => localCreate(current, tripStart, body)),
    );
  }

  async function addOutboundLeg(mode: TravelMode) {
    const body = { id: crypto.randomUUID(), name: 'Heenreis', nights: 0, travelMode: mode };
    const created = await mutate(stopsPath, 'POST', body, (current) =>
      localCreate(current, tripStart, body),
    );
    // It has to lead the route, and afterStopId cannot express "at the front".
    const order = [body.id, ...created.filter((s) => !s.parentStopId && s.id !== body.id).map((s) => s.id)];
    refresh(
      await mutate(`${stopsPath}/order`, 'PUT', { stopIds: order }, (current) =>
        localReorder(current, tripStart, order),
      ),
    );
  }

  async function setStopMode(stop: PlannedStop, mode: TravelMode) {
    refresh(
      await mutate(`${stopsPath}/${stop.id}`, 'PATCH', { travelMode: mode }, (current) =>
        localUpdate(current, tripStart, stop.id, { travelMode: mode }),
      ),
    );
  }

  /* ---- Touch reordering -------------------------------------------------
     HTML5 drag and drop does not exist on a phone, so a long press picks the
     row up and the rows around it slide out of the way live, showing exactly
     where it will land. */
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [touchDrag, setTouchDrag] = useState<{
    id: string;
    from: number;
    to: number;
    dy: number;
    height: number;
  } | null>(null);
  /** Row boxes as they were when the drag began; the maths stays stable even
   *  while everything is being translated around. */
  const dragRects = useRef<{ top: number; height: number }[]>([]);
  const dragScrollY = useRef(0);
  /** Vertical spacing between rows (the .stop-row margin). */
  const ROW_GAP = 8;

  function beginTouchDrag(stop: PlannedStop, index: number) {
    const rects = route.map((s) => {
      const el = rowRefs.current.get(s.id);
      const box = el?.getBoundingClientRect();
      return { top: box?.top ?? 0, height: box?.height ?? 0 };
    });
    dragRects.current = rects;
    dragScrollY.current = window.scrollY;
    setTouchDrag({
      id: stop.id,
      from: index,
      to: index,
      dy: 0,
      height: rects[index]?.height ?? 0,
    });
    // A short buzz is the only signal that the row has come loose.
    navigator.vibrate?.(12);
  }

  function moveTouchDrag(dy: number) {
    setTouchDrag((current) => {
      if (!current) return current;
      const rects = dragRects.current;
      const own = rects[current.from];
      if (!own) return current;
      // The row follows the finger on screen; the page may have scrolled under
      // it in the meantime, and the row moves with the page.
      const shift = dy + (window.scrollY - dragScrollY.current);
      const centre = own.top + own.height / 2 + shift;
      let to = current.from;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]!;
        if (centre >= r.top && centre <= r.top + r.height) {
          to = i;
          break;
        }
        if (i === 0 && centre < r.top) to = 0;
        if (i === rects.length - 1 && centre > r.top + r.height) to = i;
      }
      return { ...current, dy: shift, to };
    });
  }

  async function endTouchDrag() {
    const current = touchDrag;
    setTouchDrag(null);
    if (!current || current.to === current.from) return;
    const next = [...route];
    const [moved] = next.splice(current.from, 1);
    next.splice(current.to, 0, moved!);
    onStopsChange([...next, ...stops.filter((s) => s.parentStopId)]); // optimistic
    const order = next.map((s) => s.id);
    refresh(
      await mutate(`${stopsPath}/order`, 'PUT', { stopIds: order }, (current) =>
        localReorder(current, tripStart, order),
      ),
    );
  }

  /** Transform for one row while a reorder is in progress. */
  function rowStyle(index: number, id: string): CSSProperties | undefined {
    if (!touchDrag) return undefined;
    const offset = touchDrag.id === id ? touchDrag.dy : dragOffset(index);
    return offset === 0 ? undefined : { transform: `translateY(${offset}px)` };
  }

  /** How far row `index` has to step aside to open the gap. */
  function dragOffset(index: number): number {
    if (!touchDrag) return 0;
    const { from, to, height } = touchDrag;
    const step = height + ROW_GAP;
    if (index === from) return 0;
    if (from < to && index > from && index <= to) return -step;
    if (to < from && index >= to && index < from) return step;
    return 0;
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
    const next = [...route];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onStopsChange(next); // optimistic
    const order = next.map((s) => s.id);
    refresh(
      await mutate(`${stopsPath}/order`, 'PUT', { stopIds: order }, (current) =>
        localReorder(current, tripStart, order),
      ),
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
      {pending > 0 && (
        <div className="plan-pending">
          <Icon name="cloud-off" size={14} />
          {pending} {pending === 1 ? 'wijziging wacht' : 'wijzigingen wachten'} op verbinding
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {route.length === 0 && (
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
        {route.map((stop, index) => {
          if (isStandaloneLeg(stop)) {
            const outbound = index === 0;
            const legPt =
              stop.latitude !== null && stop.longitude !== null
                ? ([stop.longitude, stop.latitude] as [number, number])
                : null;
            const otherPt = outbound ? firstCity : lastCity;
            // Driven distance of this leg (origin↔nearest city) — only for a
            // non-flight leg with a set location.
            const legLegKm =
              stop.travelMode !== 'FLIGHT' && legPt && otherPt
                ? haversineKm(legPt, otherPt)
                : null;
            return (
              <li
                key={stop.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(stop.id, el);
                  else rowRefs.current.delete(stop.id);
                }}
                className={`stop-row ${removingId === stop.id ? 'leaving' : ''} ${
                  touchDrag?.id === stop.id ? 'lifted' : ''
                }`}
                style={rowStyle(index, stop.id)}
              >
                <div className="stop-row-inner">
                <SwipeToDelete
                  onDelete={() => removeStop(stop)}
                  label="Reis verwijderen"
                  dragging={touchDrag?.id === stop.id}
                  onDragStart={() => beginTouchDrag(stop, index)}
                  onDragMove={moveTouchDrag}
                  onDragEnd={() => void endTouchDrag()}
                >
                {/* Keyed on the travel mode so switching flight ↔ car/bus
                    remounts the bar and replays its entry animation. */}
                <div className="flight-leg card" key={stop.travelMode}>
                  <div className="flight-leg-head">
                    {/* Just "Heen"/"Terug": the stored name (Heenreis /
                        Heenvlucht) is too long to keep the pills, the distance
                        and the mode menu on one row. */}
                    <strong className="flight-leg-name">
                      {stop.name.startsWith('Heen') ? 'Heen' : 'Terug'}
                    </strong>
                    {stop.travelMode === 'FLIGHT' ? (
                      <FlightEditor
                        flightNumber={stop.flightNumber}
                        fromAirport={stop.fromAirport}
                        toAirport={stop.toAirport}
                        viaAirports={stop.viaAirports}
                        toCity={outbound ? firstCity : null}
                        fromCity={outbound ? null : lastCity}
                        onSave={(data) => void saveFlight(stop, data)}
                      />
                    ) : (
                      <LegLocation
                        outbound={outbound}
                        hasLocation={legPt !== null}
                        savedLabel={stop.notes}
                        onSave={(data) => void saveLegLocation(stop, data)}
                        onFlyTo={onFlyTo}
                      />
                    )}
                    {legLegKm !== null && (
                      <AltMetric km={legLegKm} mode={stop.travelMode} />
                    )}
                    <ModeMenu
                      current={stop.travelMode}
                      compact
                      align="right"
                      onPick={(m) => void setStopMode(stop, m)}
                    />
                  </div>
                </div>
                </SwipeToDelete>
                </div>
              </li>
            );
          }
          const prev = index > 0 ? route[index - 1] : null;
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
            <li
              key={stop.id}
              ref={(el) => {
                if (el) rowRefs.current.set(stop.id, el);
                else rowRefs.current.delete(stop.id);
              }}
              className={`stop-row ${removingId === stop.id ? 'leaving' : ''} ${
                touchDrag?.id === stop.id ? 'lifted' : ''
              }`}
              style={rowStyle(index, stop.id)}
            >
              <div className="stop-row-inner">
              {/* Incoming leg: a mode dropdown (same as heenreis), plus the
                  flight editor when it's a flight. Only from the 2nd stop on —
                  the first stop's arrival is the heenreis. */}
              {index > 0 && !prevIsStandalone && (
                <div className="leg-connector">
                  {/* Every mode looks the same here: the mode pill, and for a
                      flight the airports pill right beside it — no card, no
                      separate treatment. Keyed on the mode so the row replays
                      its swap animation when the flight pill appears or goes. */}
                  <div className="leg-connector-row" key={stop.travelMode}>
                    <ModeMenu
                      current={stop.travelMode}
                      compact
                      onPick={(m) => void setStopMode(stop, m)}
                    />
                    {isFlight && (
                      <FlightEditor
                        flightNumber={stop.flightNumber}
                        fromAirport={stop.fromAirport}
                        toAirport={stop.toAirport}
                        viaAirports={stop.viaAirports}
                        fromCity={prev ? cityCoord(prev) : null}
                        toCity={cityCoord(stop)}
                        onSave={(data) => void saveFlight(stop, data)}
                      />
                    )}
                    {legKm !== null && <AltMetric km={legKm} mode={stop.travelMode} />}
                  </div>
                </div>
              )}
              <SwipeToDelete
                onDelete={() => removeStop(stop)}
                label="Stop verwijderen"
                dragging={touchDrag?.id === stop.id}
                onDragStart={() => beginTouchDrag(stop, index)}
                onDragMove={moveTouchDrag}
                onDragEnd={() => void endTouchDrag()}
              >
              <div
                className={`card stop-item ${dragIndex === index ? 'dragging' : ''} ${
                  overIndex === index && dragIndex !== null && dragIndex !== index
                    ? dragIndex < index
                      ? 'drop-after'
                      : 'drop-before'
                    : ''
                }`}
                draggable
                onDragStart={(e) => {
                  // The whole card is the drag handle, but the day-trip panel
                  // inside it holds a text field — dragging there must type, not
                  // reorder the route.
                  if ((e.target as HTMLElement).closest('.daytrip-panel, .daytrips')) {
                    e.preventDefault();
                    return;
                  }
                  setDragIndex(index);
                }}
                onDragOver={(e) => onDragOver(e, index)}
                onDragEnd={onDrop}
                onDrop={onDrop}
              >
                <div className="stop-main">
                  <CityThumb name={stop.name} index={index} countryCode={stop.countryCode} />
                  <div className="stop-info">
                    <strong>{stop.name}</strong>
                    {/* One line: shortening the range is what keeps the weather
                        beside the dates, so the separator dot is never left
                        dangling at the start of a wrapped line. */}
                    <span className="muted stop-meta">
                      {stop.nights > 0
                        ? formatDateRange(stop.arrivalDate, stop.departureDate)
                        : formatDate(stop.arrivalDate)}
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
                    <button
                      type="button"
                      className={`daytrip-btn ${dayTripFor === stop.id ? 'open' : ''}`}
                      onClick={() => setDayTripFor(dayTripFor === stop.id ? null : stop.id)}
                    >
                      <Icon name="plus" size={13} />
                      Dagtrip
                    </button>
                  </div>
                </div>
                <DayTrips
                  parent={stop}
                  dayTrips={dayTripsByParent.get(stop.id) ?? []}
                  open={dayTripFor === stop.id}
                  removingId={removingId}
                  onClose={() => setDayTripFor(null)}
                  onAdd={(place, date) => addDayTrip(stop, place, date)}
                  onDate={(trip, date) => setDayTripDate(trip, date)}
                  onRemove={removeStop}
                  onFlyTo={onFlyTo}
                />
              </div>
              </SwipeToDelete>
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

      {/* Deleting is one gesture, so there has to be a way back. Sits above the
          tab bar and fades out after a few seconds. */}
      {undo &&
        createPortal(
          <div className="undo-pill">
            <span className="undo-text">
              <strong>{undo.stop.name}</strong> verwijderd
            </span>
            <button type="button" className="undo-btn" onClick={() => void undoDelete()}>
              Ongedaan maken
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * Swipe a row aside to delete it, either direction — the same gesture as a
 * queue item in a music app. It replaces the little × that used to sit in the
 * corner of every card and crowd the row.
 *
 * Only touch is handled: on a desktop the card is still an HTML5 drag handle
 * for reordering, and the two would fight over the pointer.
 */
function SwipeToDelete({
  onDelete,
  label,
  onDragStart,
  onDragMove,
  onDragEnd,
  dragging,
  children,
}: {
  onDelete: () => void;
  label: string;
  /** Long-pressing the row starts a reorder instead of a swipe. */
  onDragStart?: () => void;
  onDragMove?: (dy: number) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  /** Stays true until the card has slid back over the red, so the background is
   *  covered up rather than fading out from under it. */
  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /** Far enough to mean it: a fifth of the row, and never less than 64 px. */
  const threshold = () => Math.max(64, (boxRef.current?.offsetWidth ?? 300) * 0.2);
  const armed = Math.abs(dx) >= threshold();
  // A buzz the moment it comes loose, so "far enough" is something you feel.
  const buzzed = useRef(false);

  /**
   * Finger travel → how far the row actually moves.
   *
   * It resists at first, so a row never comes loose from a stray thumb, and
   * then follows the finger one to one. No jump at the threshold: the haptic
   * tick says you are there, and a row that leaps sideways under your finger
   * reads as a glitch.
   */
  const resist = (raw: number): number => {
    const distance = Math.abs(raw);
    const STICK = 22; // barely moves until you mean it
    if (distance <= STICK) return Math.sign(raw) * distance * 0.4;
    return Math.sign(raw) * (STICK * 0.4 + (distance - STICK));
  };

  const holdTimer = useRef<number | null>(null);
  // Read inside the native listener, which is registered once.
  const mode = useRef<'idle' | 'swipe' | 'drag'>('idle');
  const handlers = useRef({ onDragStart, onDragMove, onDragEnd, onDelete });
  handlers.current = { onDragStart, onDragMove, onDragEnd, onDelete };

  const cancelHold = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const onTouchStart = (e: ReactTouchEvent) => {
    // A day trip's row sits inside its stop's row: without this, swiping the
    // day trip would drag the whole stop along with it.
    e.stopPropagation();
    const t = e.touches[0]!;
    start.current = { x: t.clientX, y: t.clientY, axis: 'none' };
    mode.current = 'idle';
    if (!onDragStart) return;
    // Hold still for a moment and the row comes up for reordering; move first
    // and it is a swipe or a scroll instead.
    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      if (mode.current !== 'idle') return;
      mode.current = 'drag';
      handlers.current.onDragStart?.();
    }, 380);
  };

  const onTouchEnd = (e: ReactTouchEvent) => {
    e.stopPropagation();
    cancelHold();
    const s = start.current;
    start.current = null;
    setSwiping(false);
    if (mode.current === 'drag') {
      mode.current = 'idle';
      handlers.current.onDragEnd?.();
      return;
    }
    mode.current = 'idle';
    if (s?.axis === 'x' && Math.abs(dx) >= threshold()) {
      buzzed.current = false;
      navigator.vibrate?.([0, 18]);
      // Let it fly off in the direction of travel, then delete.
      setDx(Math.sign(dx) * (boxRef.current?.offsetWidth ?? 400));
      window.setTimeout(onDelete, 170);
      return;
    }
    buzzed.current = false;
    setDx(0);
    // Matches the .swipe-fg return transition: the red disappears because the
    // card is in front of it again, not because it faded.
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setRevealed(false), 280);
  };

  // Registered by hand because React's touchmove is passive: without
  // preventDefault the page scrolls away underneath a swipe or a reorder.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      e.stopPropagation();
      const s = start.current;
      if (!s) return;
      const t = e.touches[0]!;
      const moveX = t.clientX - s.x;
      const moveY = t.clientY - s.y;

      if (mode.current === 'drag') {
        e.preventDefault();
        handlers.current.onDragMove?.(moveY);
        return;
      }
      // Decide once whether this is a swipe or a scroll, then stick to it —
      // re-deciding mid-gesture makes the row twitch while you scroll past it.
      if (s.axis === 'none') {
        if (Math.abs(moveX) < 12 && Math.abs(moveY) < 12) return;
        cancelHold();
        s.axis = Math.abs(moveX) > Math.abs(moveY) * 1.4 ? 'x' : 'y';
        if (s.axis === 'x') {
          mode.current = 'swipe';
          setSwiping(true);
          if (hideTimer.current) window.clearTimeout(hideTimer.current);
          setRevealed(true);
        }
      }
      if (s.axis !== 'x') return;
      e.preventDefault();
      const next = resist(moveX);
      // Tick once on the way out, once on the way back in.
      const past = Math.abs(next) >= threshold();
      if (past !== buzzed.current) {
        buzzed.current = past;
        navigator.vibrate?.(past ? 14 : 8);
      }
      setDx(next);
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="swipe-row"
      ref={boxRef}
      data-swiping={swiping}
      data-revealed={revealed}
      data-armed={armed}
      data-dragging={dragging}
      data-dir={dx > 0 ? 'right' : dx < 0 ? 'left' : undefined}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* The label sits against the edge the row is uncovering, so it is the
          first thing you read instead of appearing from the far side. */}
      <div className="swipe-bg" aria-hidden="true">
        <span className="swipe-bg-inner">
          <Icon name="trash" size={17} />
          <span className="swipe-bg-label">{label}</span>
        </span>
      </div>
      <div
        className="swipe-fg"
        style={dx === 0 ? undefined : { transform: `translateX(${dx}px)` }}
      >
        {children}
      </div>
      {/* Mouse-and-keyboard fallback: there is no swipe on a desktop, and the
          card's own drag gesture is already taken by reordering. */}
      <button type="button" className="swipe-x" aria-label={label} onClick={onDelete}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/**
 * The day trips hanging off one stop, plus the panel to add another.
 *
 * Visually it is a branch: a line drops out of the stop's photo and forks right
 * to each day trip, so a second and third excursion simply extend the same
 * line instead of looking like new stops in the route.
 */
function DayTrips({
  parent,
  dayTrips,
  open,
  removingId,
  onClose,
  onAdd,
  onDate,
  onRemove,
  onFlyTo,
}: {
  parent: PlannedStop;
  dayTrips: PlannedStop[];
  open: boolean;
  removingId: string | null;
  onClose: () => void;
  onAdd: (place: PlaceSuggestion, day: string) => void;
  onDate: (dayTrip: PlannedStop, day: string) => void;
  onRemove: (stop: PlannedStop) => void;
  onFlyTo: (lng: number, lat: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [sugg, setSugg] = useState<PlaceSuggestion[]>([]);
  const [picked, setPicked] = useState<PlaceSuggestion | null>(null);
  // Defaults to the day you arrive at the stop — the usual answer, and it opens
  // the calendar on the right month straight away.
  const [day, setDay] = useState(parent.arrivalDate.slice(0, 10));
  const timer = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the form every time the panel opens, and put the caret in the search
  // box so you can start typing right away.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSugg([]);
    setPicked(null);
    setDay(parent.arrivalDate.slice(0, 10));
    // After the 0.32s expander has settled, so the field is where it will stay
    // when the keyboard-scroll handler measures it.
    const t = window.setTimeout(() => inputRef.current?.focus(), 340);
    return () => window.clearTimeout(t);
  }, [open, parent.arrivalDate]);

  function onInput(value: string) {
    setQuery(value);
    setPicked(null);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      searchPlaces(value, controller.signal).then(setSugg).catch(() => undefined);
    }, 280);
  }

  function pick(place: PlaceSuggestion) {
    setPicked(place);
    setQuery(place.name);
    setSugg([]);
    onFlyTo(place.longitude, place.latitude);
  }

  return (
    <>
      {dayTrips.length > 0 && (
        <ul className="daytrips">
          {dayTrips.map((trip) => (
            <li
              key={trip.id}
              className={`daytrip-row ${removingId === trip.id ? 'leaving' : ''}`}
            >
                <div className="daytrip-card">
                  <CityThumb
                    name={trip.name}
                    index={-1}
                    countryCode={trip.countryCode}
                    className="daytrip-thumb"
                  />
                  <div className="daytrip-info">
                    <strong>{trip.name}</strong>
                    <span className="muted daytrip-meta">
                      <DateField
                        value={trip.arrivalDate.slice(0, 10)}
                        nearDate={parent.arrivalDate.slice(0, 10)}
                        onChange={(value) => value && onDate(trip, value)}
                      />
                      {trip.latitude !== null && trip.longitude !== null && (
                        <>
                          <span className="daytrip-sep">·</span>
                          <WeatherBadge
                            lat={trip.latitude}
                            lon={trip.longitude}
                            day={trip.arrivalDate}
                          />
                        </>
                      )}
                    </span>
                  </div>
                  {/* A day trip keeps its cross: the rows are small, and a swipe
                      on something this size is fiddly. */}
                  <button
                    type="button"
                    className="daytrip-delete"
                    onClick={() => onRemove(trip)}
                    aria-label="Dagtrip verwijderen"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
            </li>
          ))}
        </ul>
      )}

      {/* 0fr → 1fr expander: the card itself grows, so the panel unfolds out of
          the stop instead of appearing on top of it. */}
      <div className="daytrip-panel" data-open={open}>
        <div className="daytrip-panel-inner">
          <div className="daytrip-form">
            <div className="daytrip-search searchbox">
              <Icon name="search" size={15} />
              <input
                ref={inputRef}
                value={query}
                placeholder={`Waar ging je heen vanuit ${parent.name}?`}
                onChange={(e) => onInput(e.target.value)}
              />
            </div>
            {sugg.length > 0 && (
              <ul className="daytrip-suggestions">
                {sugg.map((place, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => pick(place)}>
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
            <div className="daytrip-when">
              <DateField
                label="Welke dag?"
                value={day}
                nearDate={parent.arrivalDate.slice(0, 10)}
                onChange={setDay}
              />
            </div>
            <div className="daytrip-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Annuleren
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!picked || !day}
                onClick={() => picked && onAdd(picked, day)}
              >
                Toevoegen
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Origin/destination picker for a standalone heen-/terugreis leg (any non-flight
 *  mode). Purely so the driven kilometres of that leg count toward the trip
 *  distance — the place you leave from / return to. */
function LegLocation({
  outbound,
  hasLocation,
  savedLabel,
  onSave,
  onFlyTo,
}: {
  outbound: boolean;
  hasLocation: boolean;
  savedLabel?: string | null;
  onSave: (data: {
    latitude: number;
    longitude: number;
    countryCode?: string;
    notes?: string;
  }) => void;
  onFlyTo: (lng: number, lat: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  function pick(p: PlaceSuggestion) {
    setLabel(p.name);
    setOpen(false);
    onFlyTo(p.longitude, p.latitude);
    onSave({
      latitude: p.latitude,
      longitude: p.longitude,
      countryCode: p.countryCode,
      notes: p.name, // remembered so the pill shows the place name, not "Ingesteld"
    });
  }

  // The chosen place name (this session), else the persisted one, else a prompt.
  const name = label ?? savedLabel ?? null;
  const text = name ?? (hasLocation ? 'Ingesteld' : outbound ? 'Beginpunt' : 'Eindpunt');
  const isSet = hasLocation || !!label;

  return (
    <>
      <button
        type="button"
        className={`leg-loc-pill ${isSet ? 'set' : ''}`}
        onClick={() => setOpen(true)}
      >
        <Icon name="pin" size={13} />
        <span className="leg-loc-text">{text}</span>
      </button>
      {open && (
        <PlaceSheet
          title={outbound ? 'Vertrek vanaf' : 'Terug naar'}
          placeholder={outbound ? 'Vanaf welke plaats?' : 'Naar welke plaats?'}
          onClose={() => setOpen(false)}
          onPick={pick}
        />
      )}
    </>
  );
}

/** Place search in the same sliding sheet as the flight editor, so it animates
 *  in and out and the keyboard never fights the map behind it. */
function PlaceSheet({
  title,
  placeholder,
  onClose,
  onPick,
}: {
  title: string;
  placeholder: string;
  onClose: () => void;
  onPick: (place: PlaceSuggestion) => void;
}) {
  const [query, setQuery] = useState('');
  const [sugg, setSugg] = useState<PlaceSuggestion[]>([]);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    // Back closes the sheet rather than leaving the planner.
    window.history.pushState({ mmsPlace: true }, '');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onInput(v: string) {
    setQuery(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      abort.current?.abort();
      const c = new AbortController();
      abort.current = c;
      searchPlaces(v, c.signal).then(setSugg).catch(() => undefined);
    }, 280);
  }

  return createPortal(
    <div className={`fe-layer ${closing ? 'closing' : ''}`}>
      <div className="fe-scrim" onClick={close} />
      <div className="fe-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="fe-grab" aria-hidden="true" />
        <header className="fe-head">
          <strong>{title}</strong>
          <button type="button" className="fe-icon-btn" aria-label="Sluiten" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="fe-picker-search searchbox">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={query}
            placeholder={placeholder}
            onChange={(e) => onInput(e.target.value)}
          />
        </div>
        <ul className="fe-picker-list">
          {sugg.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => onPick(p)}>
                <span className="fe-picker-code">{flagEmoji(p.countryCode)}</span>
                <span className="fe-picker-name">
                  <strong>{p.name}</strong>
                  {p.region && <small>{p.region}</small>}
                </span>
              </button>
            </li>
          ))}
          {query.trim() && sugg.length === 0 && (
            <li className="fe-picker-empty">Niets gevonden.</li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Distance + travel time on a leg. Shows them together when they fit; when the
 * pair is too wide for the row it falls back to alternating between the two
 * every few seconds. Fit is measured with a hidden probe carrying the full
 * text, so the check doesn't flip-flop once the short version is displayed.
 */
function AltMetric({ km, mode }: { km: number; mode: TravelMode }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [alternate, setAlternate] = useState(false);
  const [showDur, setShowDur] = useState(false);

  const distance = `${km.toLocaleString('nl-NL')} km`;
  const duration = estimateDuration(km, mode);
  const full = `${distance} · ${duration}`;

  useEffect(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;
    const measure = () => setAlternate(probe.offsetWidth > box.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [full]);

  useEffect(() => {
    if (!alternate) return;
    const t = window.setInterval(() => setShowDur((v) => !v), 3000);
    return () => window.clearInterval(t);
  }, [alternate]);

  return (
    <span className="leg-alt-metric" ref={boxRef} title={full}>
      <span className="leg-alt-metric-probe" ref={probeRef} aria-hidden="true">
        {full}
      </span>
      <span key={alternate ? (showDur ? 'd' : 'k') : 'full'} className="leg-alt-metric-val">
        {alternate ? (showDur ? duration : distance) : full}
      </span>
    </span>
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
        {/* Keyed on the mode so picking another one cross-fades icon + label
            instead of swapping them instantly. */}
        <span className="mode-menu-face" key={current ?? 'new'}>
          <Icon name={icon} size={compact ? 14 : 16} />
          <span>{text}</span>
        </span>
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
