import {
  CSSProperties,
  DragEvent,
  FormEvent,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { useBackToClose } from '../lib/backStack';
import type { Trip } from '../api/types';
import { CityThumb } from './CityThumb';
import { DateField } from './DatePicker';
import { FlightEditor } from './FlightEditor';
import { Icon, MODE_ICON, type IconName } from './Icon';
import { WeatherBadge } from './WeatherBadge';
import {
  estimateDuration,
  haversineKm,
  MODE_LABEL,
  PlannedStop,
  TRAVEL_MODES,
  TravelMode,
} from '../lib/arc';
import { airportByCode } from '../lib/airports';
import { formatDate, formatDateRange } from '../lib/colors';
import { PlaceSuggestion, searchPlaces } from '../lib/geocode';
import { StopSuggestions, type StaySuggestion } from './StopSuggestions';
import { haptic } from '../lib/haptics';
import { isIosApp } from '../lib/native';
import { nativeMenusAvailable, showNativeMenu } from '../lib/nativeMenu';
import { IosSwipeToDelete, type SwipeRowProps } from './IosSwipeToDelete';
import { useExit } from '../lib/useExit';
import { cachePutJson } from '../lib/offlineCache';
import { enqueueWrite, onPendingChange } from '../lib/pendingWrites';
import {
  localCreate,
  localDelete,
  localReorder,
  localUpdate,
} from '../lib/plannerLocal';
import '../pages/plan.css';
import { Flag } from './Flag';
import { NightsStepper } from './NightsStepper';
import { t, intlLocale } from '../i18n';
import { tr } from '../i18n/rich';
import { legTitle } from '../lib/legs';

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
  /** Guest view: the same itinerary, with nothing to press. */
  readOnly?: boolean;
  /**
   * Draw the rails of a train leg. A train is the one mode the tracker cannot
   * follow — tunnels, cuttings, a steel carriage — so the planner offers to
   * fill the leg in from the two stations instead.
   */
  onDrawTrain?: (leg: {
    from: string;
    to: string;
    at: { lng: number; lat: number };
  }) => void;
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
  readOnly = false,
  onDrawTrain,
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
      setError(err instanceof Error ? err.message : t('planner.error.addStop'));
    }
  }

  /**
   * A stay the track found, accepted as a stop.
   *
   * It lands at the end of the route like any new stop; the nights come from
   * how long you actually stayed, which is what makes this worth a press
   * rather than a form.
   */
  async function addSuggestedStop(stay: StaySuggestion, name: string, countryCode?: string) {
    const body = {
      id: crypto.randomUUID(),
      name,
      nights: stay.nights,
      latitude: stay.latitude,
      longitude: stay.longitude,
      countryCode,
    };
    refresh(
      await mutate(stopsPath, 'POST', body, (current) => localCreate(current, tripStart, body)),
    );
    onChanged?.();
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
    // Each step clicks like a dial; past the end it says no, and nothing moves.
    if (stop.nights + delta < 0) {
      haptic('end');
      return;
    }
    haptic('light');
    const nights = stop.nights + delta;
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
  // Both of these disappear on their own, so they need to be held on screen
  // long enough to animate out — and to keep their text while they do.
  const [pendingShown, pendingClosing] = useExit(pending > 0, 240);
  const lastPendingRef = useRef(pending);
  if (pending > 0) lastPendingRef.current = pending;
  const lastPending = lastPendingRef.current;

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
      setError(err instanceof Error ? err.message : t('planner.error.addDayTrip'));
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
  const [undoShown, undoClosing] = useExit(undo !== null, 240);
  const lastUndoNameRef = useRef('');
  if (undo) lastUndoNameRef.current = undo.stop.name;
  const lastUndoName = lastUndoNameRef.current;

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
      setError(err instanceof Error ? err.message : t('planner.error.restore'));
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
     stop up. Only the stop itself lifts (a little larger, slightly tilted);
     the line and mode pill above it stay where they are and fade. It follows
     the finger, swaps when it is half over its neighbour (with some slack so
     it never flips back), the neighbours glide aside, and on letting go it
     glides into its place before the new order is saved. Positions are
     measured on the cards themselves. */
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [touchDrag, setTouchDrag] = useState<{
    id: string;
    from: number;
    to: number;
    dy: number;
    height: number;
    settling?: boolean;
  } | null>(null);
  /** Row and card boxes as they were when the drag began; the maths stays
   *  stable even while everything is being translated around. */
  const dragRects = useRef<{ top: number; bottom: number; height: number }[]>([]);
  const dragCards = useRef<{ top: number; height: number }[]>([]);
  const dragScrollY = useRef(0);
  /** Set for the one frame in which the new order lands, so nothing glides
   *  back from the offsets the drag left behind. */
  const [dropFrame, setDropFrame] = useState(false);
  /** Vertical spacing between rows (the .stop-row margin). */
  const ROW_GAP = 8;
  /** How far back past the half-way line a swap has to go to undo itself. */
  const SWAP_SLACK = 14;

  function beginTouchDrag(stop: PlannedStop, index: number) {
    const rows = route.map((s) => rowRefs.current.get(s.id));
    dragRects.current = rows.map((el) => {
      const box = el?.getBoundingClientRect();
      return { top: box?.top ?? 0, bottom: box?.bottom ?? 0, height: box?.height ?? 0 };
    });
    dragCards.current = rows.map((el) => {
      const box = el?.querySelector('.stop-item, .flight-leg')?.getBoundingClientRect();
      return { top: box?.top ?? 0, height: box?.height ?? 0 };
    });
    dragScrollY.current = window.scrollY;
    setTouchDrag({
      id: stop.id,
      from: index,
      to: index,
      dy: 0,
      height: dragRects.current[index]?.height ?? 0,
    });
  }

  function moveTouchDrag(dy: number) {
    setTouchDrag((current) => {
      if (!current || current.settling) return current;
      const cards = dragCards.current;
      const own = cards[current.from];
      if (!own) return current;
      // The stop follows the finger on screen; the page may have scrolled
      // under it in the meantime, and the stop moves with the page.
      const shift = dy + (window.scrollY - dragScrollY.current);
      const top = own.top + shift;
      const bottom = top + own.height;
      let to = current.from;
      // Downwards: past the middle of the card below, which then makes way.
      for (let j = current.from + 1; j < cards.length; j++) {
        const mid = cards[j]!.top + cards[j]!.height / 2;
        const swapped = current.to >= j;
        if (bottom > mid - (swapped ? SWAP_SLACK : 0)) to = j;
        else break;
      }
      // Upwards, the same the other way round.
      if (to === current.from) {
        for (let j = current.from - 1; j >= 0; j--) {
          const mid = cards[j]!.top + cards[j]!.height / 2;
          const swapped = current.to <= j;
          if (top < mid + (swapped ? SWAP_SLACK : 0)) to = j;
          else break;
        }
      }
      if (to !== current.to) haptic('light');
      return { ...current, dy: shift, to };
    });
  }

  function endTouchDrag() {
    const current = touchDrag;
    if (!current || current.settling) return;
    if (current.to === current.from) {
      // Glides back into its own place.
      setTouchDrag({ ...current, dy: 0, settling: true });
      window.setTimeout(() => setTouchDrag(null), 240);
      return;
    }
    const rects = dragRects.current;
    const from = rects[current.from]!;
    const target = rects[current.to]!;
    const offset = current.to > current.from ? target.bottom - from.bottom : target.top - from.top;
    setTouchDrag({ ...current, dy: offset, settling: true });
    window.setTimeout(() => void commitTouchDrag(current.from, current.to), 240);
  }

  async function commitTouchDrag(fromIndex: number, toIndex: number) {
    const next = [...route];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved!);
    setDropFrame(true);
    setTouchDrag(null);
    onStopsChange([...next, ...stops.filter((s) => s.parentStopId)]); // optimistic
    requestAnimationFrame(() => requestAnimationFrame(() => setDropFrame(false)));
    const order = next.map((s) => s.id);
    refresh(
      await mutate(`${stopsPath}/order`, 'PUT', { stopIds: order }, (current) =>
        localReorder(current, tripStart, order),
      ),
    );
  }

  /** Transform for one row while a reorder is in progress: the rows around
   *  the lifted stop step aside; the lifted row itself stays (its stop moves,
   *  see liftStyle). */
  function rowStyle(index: number, id: string): CSSProperties | undefined {
    if (!touchDrag || touchDrag.id === id) return undefined;
    const offset = dragOffset(index);
    return offset === 0 ? undefined : { transform: `translateY(${offset}px)` };
  }

  /** The lifted stop under the finger. */
  function liftStyle(id: string): CSSProperties | undefined {
    if (!touchDrag || touchDrag.id !== id) return undefined;
    return { transform: `translateY(${touchDrag.dy}px)` };
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
    <div
      className={`trip-planner ${readOnly ? 'trip-planner-read' : ''}`}
      // The trip's own colour for the badges, pills, line and ring, as the app's planner.
      style={{ '--trip': trip?.color ?? 'var(--accent)' } as CSSProperties}
    >
      {trip && (
        <div className="nights-planned">
          <span
            className="nights-ring"
            data-full={plannedNights >= tripNights}
            style={{ '--p': tripNights > 0 ? Math.min(1, plannedNights / tripNights) : 0 } as CSSProperties}
            aria-hidden
          />
          {t('planner.nightsPlanned', { planned: plannedNights, total: tripNights })}
        </div>
      )}
      {pendingShown && (
        <div className={`plan-pending ${pendingClosing ? 'leaving' : ''}`}>
          <Icon name="cloud-off" size={14} />
          {t('planner.pending', { count: lastPending })}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {route.length === 0 && (
        <div className="plan-empty">
          <span className="plan-empty-icon">
            <Icon name="compass" size={30} />
          </span>
          <p className="muted">
            {readOnly
              ? t('planner.emptyReadOnly')
              : t('planner.empty')}
          </p>
        </div>
      )}

      {!hasOutbound && !readOnly && (
        <ModeMenu label={t('planner.outboundTrip')} onPick={(m) => void addOutboundLeg(m)} />
      )}

      <ol
        className={`stop-list ${touchDrag ? 'reordering' : ''} ${dropFrame ? 'drop-frame' : ''}`}
      >
        {route.map((stop, index) => {
          if (isStandaloneLeg(stop)) {
            const outbound = index === 0;
            const legPt =
              stop.latitude !== null && stop.longitude !== null
                ? ([stop.longitude, stop.latitude] as [number, number])
                : null;
            const otherPt = outbound ? firstCity : lastCity;
            // How far this leg goes. On the ground that is origin to the
            // nearest city; in the air it is airport to airport, which the
            // flight pill knows but never said — the row simply had a hole
            // where its distance belonged.
            const legFrom = airportByCode(stop.fromAirport);
            const legTo = airportByCode(stop.toAirport);
            const legLegKm =
              stop.travelMode === 'FLIGHT'
                ? legFrom && legTo
                  ? haversineKm([legFrom.lon, legFrom.lat], [legTo.lon, legTo.lat])
                  : null
                : legPt && otherPt
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
                } ${touchDrag?.id === stop.id && touchDrag.settling ? 'settling' : ''}`}
                style={rowStyle(index, stop.id)}
              >
                <div className="stop-row-inner">
                <div className="stop-lift" style={liftStyle(stop.id)}>
                <SwipeToDelete
                  disabled={readOnly}
                  onDelete={() => removeStop(stop)}
                  label={t('planner.deleteLeg')}
                  removing={removingId === stop.id}
                  dragging={touchDrag?.id === stop.id}
                  onDragStart={() => beginTouchDrag(stop, index)}
                  onDragMove={moveTouchDrag}
                  onDragEnd={endTouchDrag}
                >
                {/* Keyed on the travel mode so switching flight ↔ car/bus
                    remounts the bar and replays its entry animation. */}
                <div className="flight-leg card" key={stop.travelMode}>
                  <div className="flight-leg-head">
                    {/* Just "Heen"/"Terug": the stored name (Heenreis /
                        Heenvlucht) is too long to keep the pills, the distance
                        and the mode menu on one row. */}
                    <strong className="flight-leg-name">
                      {stop.name.startsWith('Heen') ? t('planner.leg.out') : t('planner.leg.back')}
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
                        readOnly={readOnly}
                      />
                    ) : (
                      <LegLocation
                        outbound={outbound}
                        hasLocation={legPt !== null}
                        savedLabel={stop.notes}
                        onSave={(data) => void saveLegLocation(stop, data)}
                        onFlyTo={onFlyTo}
                        readOnly={readOnly}
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
                      readOnly={readOnly}
                    />
                  </div>
                </div>
                </SwipeToDelete>
                </div>
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
              } ${touchDrag?.id === stop.id && touchDrag.settling ? 'settling' : ''}`}
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
                      readOnly={readOnly}
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
                        readOnly={readOnly}
                      />
                    )}
                    {/* A train leg the tracker slept through: offer to draw the
                        rails. The point handed over is the middle of the leg,
                        which is the stretch of straight line the drawing looks
                        for. */}
                    {stop.travelMode === 'TRAIN' &&
                      !readOnly &&
                      onDrawTrain &&
                      prev &&
                      prev.latitude !== null &&
                      prev.longitude !== null &&
                      stop.latitude !== null &&
                      stop.longitude !== null && (
                        <button
                          type="button"
                          className="leg-rail-btn"
                          aria-label={t('planner.drawRails')}
                          title={t('planner.drawRails')}
                          onClick={() =>
                            onDrawTrain({
                              from: prev.name,
                              to: stop.name,
                              at: {
                                lng: (prev.longitude! + stop.longitude!) / 2,
                                lat: (prev.latitude! + stop.latitude!) / 2,
                              },
                            })
                          }
                        >
                          <Icon name="route" size={15} />
                          <span className="leg-rail-label">{t('planner.drawRails')}</span>
                        </button>
                      )}
                    {legKm !== null && <AltMetric km={legKm} mode={stop.travelMode} />}
                  </div>
                </div>
              )}
              <div className="stop-lift" style={liftStyle(stop.id)}>
              <SwipeToDelete
                disabled={readOnly}
                onDelete={() => removeStop(stop)}
                label={t('planner.deleteStop')}
                removing={removingId === stop.id}
                dragging={touchDrag?.id === stop.id}
                onDragStart={() => beginTouchDrag(stop, index)}
                onDragMove={moveTouchDrag}
                onDragEnd={endTouchDrag}
              >
              <div
                className={`card stop-item ${dragIndex === index ? 'dragging' : ''} ${
                  overIndex === index && dragIndex !== null && dragIndex !== index
                    ? dragIndex < index
                      ? 'drop-after'
                      : 'drop-before'
                    : ''
                }`}
                draggable={!readOnly}
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
                onDragOver={readOnly ? undefined : (e) => onDragOver(e, index)}
                onDragEnd={readOnly ? undefined : onDrop}
                onDrop={readOnly ? undefined : onDrop}
              >
                <div className="stop-main">
                  <CityThumb name={stop.name} index={index} countryCode={stop.countryCode} />
                  <div className="stop-info">
                    <strong>{legTitle(stop.name)}</strong>
                    {/* One line: shortening the range is what keeps the weather
                        beside the dates, so the separator dot is never left
                        dangling at the start of a wrapped line. */}
                    <span className="muted stop-meta">
                      {stop.nights > 0
                        ? formatDateRange(stop.arrivalDate, stop.departureDate)
                        : formatDate(stop.arrivalDate)}
                      {stop.latitude !== null && stop.longitude !== null && (
                        <WeatherBadge
                          lat={stop.latitude}
                          lon={stop.longitude}
                          day={stop.arrivalDate}
                          separator
                        />
                      )}
                    </span>
                  </div>
                  <div className="stop-nights">
                    {/* Read-only, the stepper is the wrong shape: a wide tray
                        built to hold two buttons, with one number rattling
                        around in it. A guest gets a plain pill instead. */}
                    {readOnly ? (
                      <span className="nights-static">
                        {stop.nights}
                        <small>{t('planner.nightsUnit', { count: stop.nights })}</small>
                      </span>
                    ) : (
                      <NightsStepper
                        nights={stop.nights}
                        onStep={(by) => void changeNights(stop, by)}
                      />
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className={`daytrip-btn ${dayTripFor === stop.id ? 'open' : ''}`}
                        onClick={() => setDayTripFor(dayTripFor === stop.id ? null : stop.id)}
                      >
                        <Icon name="plus" size={13} />
                        {t('planner.dayTrip')}
                      </button>
                    )}
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
                  readOnly={readOnly}
                />
              </div>
              </SwipeToDelete>
              </div>
              </div>
            </li>
          );
        })}
      </ol>

      {!hasReturn && !readOnly && (
        <ModeMenu label={t('planner.returnTrip')} onPick={(m) => void addReturnLeg(m)} />
      )}

      {/* What the track already knows, before the form where you would have
          typed it in yourself. */}
      {!readOnly && <StopSuggestions tripId={tripId} onAdd={addSuggestedStop} />}

      {!readOnly && (
      <form className="card stop-add" onSubmit={addStop}>
        <div className="field stop-search">
          <label htmlFor="st-name">{t('planner.add.label')}</label>
          <input
            id="st-name"
            required
            autoComplete="off"
            placeholder={t('planner.add.placeholder')}
            value={newName}
            onChange={(e) => onNameInput(e.target.value)}
          />
          {suggestions.length > 0 && (
            <ul className="stop-suggestions card">
              {suggestions.map((place, i) => (
                <li key={i}>
                  <button type="button" onClick={() => pickSuggestion(place)}>
                    <Flag code={place.countryCode} size={17} />
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
          <label htmlFor="st-nights">{t('planner.add.nights')}</label>
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
            ? t('planner.add.location', {
                lat: effectivePick.lat.toFixed(4),
                lng: effectivePick.lng.toFixed(4),
              })
            : t('planner.add.locationHintTap')}
        </span>
        <button className="btn btn-primary">{t('planner.add.submit')}</button>
      </form>
      )}

      {/* Deleting is one gesture, so there has to be a way back. Sits above the
          tab bar and fades out after a few seconds. */}
      {undoShown &&
        createPortal(
          <div className={`undo-pill ${undoClosing ? 'leaving' : ''}`}>
            <span className="undo-text">
              {tr(
                'planner.undo.removed',
                { b: (s) => <strong>{s}</strong> },
                { name: legTitle(lastUndoName) },
              )}
            </span>
            <button type="button" className="undo-btn" onClick={() => void undoDelete()}>
              {t('planner.undo.undo')}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Each phone its own swipe: the one its owner already knows from every other list. */
function SwipeToDelete(props: SwipeRowProps) {
  return isIosApp() ? <IosSwipeToDelete {...props} /> : <ComposeSwipeToDelete {...props} />;
}

/**
 * Swipe a row aside to delete it, either direction. Android, and the web.
 *
 * The feel is ported from a Compose implementation that got it right, and it is
 * worth spelling out because "just follow the finger" is what it is NOT:
 *
 *   tension  the row barely moves (20 px at most) for the first 60 px of
 *            travel, so scrolling a list never nudges rows sideways;
 *   release  past that it springs to catch up with the finger, with a haptic
 *            tick — the moment the row comes loose is something you feel;
 *   free     from there it tracks one to one, ticking again when it crosses
 *            (or leaves) the commit threshold;
 *   commit   letting go past the threshold flings the row off in the direction
 *            of travel while its height collapses in step, so the gap closes
 *            instead of the row blinking out.
 *
 * The reveal grows out of the edge you are uncovering rather than sitting
 * behind the row as a full-width block.
 *
 * Touch only: a desktop has no swipe, and the card's drag gesture there is
 * already reordering the route.
 */
function ComposeSwipeToDelete({
  onDelete,
  label,
  onDragStart,
  onDragMove,
  onDragEnd,
  dragging,
  disabled,
  children,
}: SwipeRowProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  /** Travel before the row comes loose, and how far it may creep in that time. */
  const TENSION_PX = 60;
  const TENSION_MAX_PX = 20;
  /** Past this fraction of the row, letting go deletes. */
  const COMMIT_FRACTION = 0.35;
  /** The reveal's icon has faded fully in by the time it is this wide. */
  const REVEAL_FADE_PX = 56;

  // Everything below runs off the animation loop and writes to the DOM
  // directly. Re-rendering React on every frame of a drag is the one thing
  // guaranteed to make it feel cheap.
  const anim = useRef({
    x: 0,
    v: 0,
    target: 0,
    stiffness: 0,
    damping: 0,
    raf: 0,
    last: 0,
    /** Set while the row is flying off; the spring is not in charge then. */
    fling: null as null | { from: number; to: number; start: number; ms: number },
  });
  const gesture = useRef({
    startX: 0,
    startY: 0,
    axis: 'none' as 'none' | 'x' | 'y',
    acc: 0,
    phase: 'idle' as 'idle' | 'tension' | 'free',
    committed: false,
    mode: 'idle' as 'idle' | 'swipe' | 'drag',
  });
  const holdTimer = useRef<number | null>(null);
  const callbacks = useRef({ onDragStart, onDragMove, onDragEnd, onDelete });
  callbacks.current = { onDragStart, onDragMove, onDragEnd, onDelete };

  const width = () => boxRef.current?.offsetWidth ?? 320;
  const commitPx = () => width() * COMMIT_FRACTION;

  /** Paints the current offset: the row's transform and the reveal's width. */
  const paint = (x: number) => {
    const fg = fgRef.current;
    const bg = bgRef.current;
    if (fg) fg.style.transform = x === 0 ? '' : `translateX(${x}px)`;
    if (!bg) return;
    const shown = Math.abs(x);
    bg.style.width = `${shown}px`;
    if (shown === 0) {
      bg.style.opacity = '0';
      return;
    }
    bg.style.opacity = '1';
    bg.dataset.dir = x > 0 ? 'right' : 'left';
    if (innerRef.current) {
      innerRef.current.style.opacity = String(Math.min(1, shown / REVEAL_FADE_PX));
    }
  };

  const step = () => {
    const a = anim.current;
    const now = performance.now();
    const elapsed = Math.min(64, now - a.last);
    a.last = now;

    if (a.fling) {
      const t = Math.min(1, (now - a.fling.start) / a.fling.ms);
      // Fast-out-slow-in, the same curve the reference tween uses.
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      a.x = a.fling.from + (a.fling.to - a.fling.from) * eased;
      paint(a.x);
      if (t >= 1) {
        a.fling = null;
        a.raf = 0;
        return;
      }
      a.raf = requestAnimationFrame(step);
      return;
    }

    // Semi-implicit Euler, sub-stepped: a stiff spring is unstable at 60 Hz in
    // one go, and "stiff" is exactly what a 1:1 follow needs.
    const steps = Math.max(1, Math.ceil((elapsed / 1000) * 240));
    const dt = elapsed / 1000 / steps;
    for (let i = 0; i < steps; i++) {
      const accel = -a.stiffness * (a.x - a.target) - a.damping * a.v;
      a.v += accel * dt;
      a.x += a.v * dt;
    }
    if (Math.abs(a.x - a.target) < 0.25 && Math.abs(a.v) < 2) {
      a.x = a.target;
      a.v = 0;
      paint(a.x);
      a.raf = 0;
      return;
    }
    paint(a.x);
    a.raf = requestAnimationFrame(step);
  };

  /** dampingRatio 1 = no bounce; below that it overshoots. */
  const springTo = (target: number, stiffness: number, dampingRatio: number) => {
    const a = anim.current;
    a.target = target;
    a.stiffness = stiffness;
    a.damping = 2 * dampingRatio * Math.sqrt(stiffness);
    if (!a.raf) {
      a.last = performance.now();
      a.raf = requestAnimationFrame(step);
    }
  };

  const snapTo = (x: number) => {
    const a = anim.current;
    a.x = x;
    a.v = 0;
    a.target = x;
    paint(x);
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const cancelHold = () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };

    const onStart = (e: TouchEvent) => {
      // A day trip's row sits inside its stop's row: without this, swiping the
      // day trip would drag the whole stop along with it.
      e.stopPropagation();
      const t = e.touches[0]!;
      const g = gesture.current;
      g.startX = t.clientX;
      g.startY = t.clientY;
      g.axis = 'none';
      g.acc = 0;
      g.phase = 'idle';
      g.committed = false;
      g.mode = 'idle';
      if (!callbacks.current.onDragStart) return;
      cancelHold();
      // Hold still for a moment and the row comes up for reordering; move first
      // and it is a swipe or a scroll instead.
      holdTimer.current = window.setTimeout(() => {
        if (gesture.current.mode !== 'idle') return;
        gesture.current.mode = 'drag';
        haptic('long-press');
        callbacks.current.onDragStart?.();
      }, 380);
    };

    const onMove = (e: TouchEvent) => {
      e.stopPropagation();
      const g = gesture.current;
      const t = e.touches[0]!;
      const moveX = t.clientX - g.startX;
      const moveY = t.clientY - g.startY;

      if (g.mode === 'drag') {
        e.preventDefault();
        callbacks.current.onDragMove?.(moveY);
        return;
      }
      // Decide once whether this is a swipe or a scroll, then stick to it —
      // re-deciding mid-gesture makes the row twitch while you scroll past it.
      if (g.axis === 'none') {
        if (Math.abs(moveX) < 10 && Math.abs(moveY) < 10) return;
        cancelHold();
        g.axis = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
        if (g.axis === 'x') {
          g.mode = 'swipe';
          g.phase = 'tension';
        }
      }
      if (g.axis !== 'x') return;
      e.preventDefault();
      g.acc = moveX;
      const dir = Math.sign(g.acc);

      if (g.phase === 'tension') {
        if (Math.abs(g.acc) < TENSION_PX) {
          snapTo(dir * TENSION_MAX_PX * (Math.abs(g.acc) / TENSION_PX));
          return;
        }
        // Comes loose: spring up to the finger rather than jumping to it.
        haptic('threshold-on');
        g.phase = 'free';
        springTo(g.acc, 200, 0.8);
        return;
      }

      const past = Math.abs(g.acc) > commitPx();
      if (past !== g.committed) {
        g.committed = past;
        haptic(past ? 'threshold-on' : 'threshold-off');
        boxRef.current?.setAttribute('data-armed', String(past));
      }
      springTo(g.acc, 10_000, 1);
    };

    const onEnd = (e: TouchEvent) => {
      e.stopPropagation();
      cancelHold();
      const g = gesture.current;
      if (g.mode === 'drag') {
        g.mode = 'idle';
        callbacks.current.onDragEnd?.();
        return;
      }
      const committed = g.axis === 'x' && Math.abs(g.acc) > commitPx();
      g.mode = 'idle';
      g.axis = 'none';
      g.phase = 'idle';
      g.committed = false;
      boxRef.current?.setAttribute('data-armed', 'false');

      if (committed) {
        haptic('end');
        const dir = Math.sign(g.acc);
        const a = anim.current;
        a.fling = {
          from: a.x,
          to: dir * width() * 1.1,
          start: performance.now(),
          ms: 260,
        };
        if (!a.raf) {
          a.last = performance.now();
          a.raf = requestAnimationFrame(step);
        }
        // Fired now, not after the fling: the row's height collapses in step
        // with it, so the gap closes as it glides away.
        callbacks.current.onDelete();
        return;
      }
      // Cancelled: an elastic settle back to where it was.
      springTo(0, 1500, 0.75);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      cancelHold();
      if (anim.current.raf) cancelAnimationFrame(anim.current.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing to swipe away and nothing to reorder: the card is the whole row.
  if (disabled) return <>{children}</>;

  return (
    <div className="swipe-row" ref={boxRef} data-dragging={dragging} data-armed="false">
      {/* Grows out of the edge you are uncovering; the icon hugs that edge and
          the label sits a fixed distance inward, so both directions read the
          same way round. */}
      <div className="swipe-reveal" ref={bgRef} aria-hidden="true">
        <span className="swipe-reveal-inner" ref={innerRef}>
          <Icon name="trash" size={18} className="swipe-reveal-icon" />
          <span className="swipe-reveal-label">{label}</span>
        </span>
      </div>
      <div className="swipe-fg" ref={fgRef}>
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
  readOnly,
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
  readOnly?: boolean;
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
                      {readOnly ? (
                        formatDate(trip.arrivalDate)
                      ) : (
                        <DateField
                          value={trip.arrivalDate.slice(0, 10)}
                          nearDate={parent.arrivalDate.slice(0, 10)}
                          onChange={(value) => value && onDate(trip, value)}
                        />
                      )}
                      {trip.latitude !== null && trip.longitude !== null && (
                        <WeatherBadge
                          lat={trip.latitude}
                          lon={trip.longitude}
                          day={trip.arrivalDate}
                          separator
                        />
                      )}
                    </span>
                  </div>
                  {/* A day trip keeps its cross: the rows are small, and a swipe
                      on something this size is fiddly. */}
                  {!readOnly && (
                    <button
                      type="button"
                      className="daytrip-delete"
                      onClick={() => onRemove(trip)}
                      aria-label={t('planner.dayTrip.delete')}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
            </li>
          ))}
        </ul>
      )}

      {/* 0fr → 1fr expander: the card itself grows, so the panel unfolds out of
          the stop instead of appearing on top of it. */}
      {!readOnly && (
      <div className="daytrip-panel" data-open={open}>
        <div className="daytrip-panel-inner">
          <div className="daytrip-form">
            <div className="daytrip-search searchbox">
              <Icon name="search" size={15} />
              <input
                ref={inputRef}
                value={query}
                placeholder={t('planner.dayTrip.search', { name: parent.name })}
                onChange={(e) => onInput(e.target.value)}
              />
            </div>
            {sugg.length > 0 && (
              <ul className="daytrip-suggestions">
                {sugg.map((place, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => pick(place)}>
                      <Flag code={place.countryCode} size={17} />
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
                label={t('planner.dayTrip.when')}
                value={day}
                nearDate={parent.arrivalDate.slice(0, 10)}
                onChange={setDay}
              />
            </div>
            <div className="daytrip-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!picked || !day}
                onClick={() => picked && onAdd(picked, day)}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      </div>
      )}
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
  readOnly,
}: {
  outbound: boolean;
  hasLocation: boolean;
  readOnly?: boolean;
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
  const text =
    name ??
    (hasLocation ? t('planner.leg.set') : outbound ? t('planner.leg.start') : t('planner.leg.end'));
  const isSet = hasLocation || !!label;

  // Nothing set and nothing to set: an empty "Beginpunt" prompt is an
  // invitation, and a guest has no way to accept it.
  if (readOnly && !isSet) return null;

  return (
    <>
      <button
        type="button"
        className={`leg-loc-pill ${isSet ? 'set' : ''}`}
        disabled={readOnly}
        onClick={() => setOpen(true)}
      >
        <Icon name="pin" size={13} />
        <span className="leg-loc-text">{text}</span>
      </button>
      {open && (
        <PlaceSheet
          title={outbound ? t('planner.leg.from') : t('planner.leg.backTo')}
          placeholder={outbound ? t('planner.leg.fromPlaceholder') : t('planner.leg.toPlaceholder')}
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
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Back closes the sheet rather than leaving the planner.
  useBackToClose('mmsPlace', close);

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
          <button type="button" className="fe-icon-btn" aria-label={t('common.close')} onClick={close}>
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
                <span className="fe-picker-code">
                  <Flag code={p.countryCode} size={20} />
                </span>
                <span className="fe-picker-name">
                  <strong>{p.name}</strong>
                  {p.region && <small>{p.region}</small>}
                </span>
              </button>
            </li>
          ))}
          {query.trim() && sugg.length === 0 && (
            <li className="fe-picker-empty">{t('planner.noResults')}</li>
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

  const distance = `${km.toLocaleString(intlLocale())} km`;
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

/** The same modes as SF Symbols, for the iPhone's own menu. */
const MODE_SYMBOL: Record<TravelMode, string> = {
  GROUND: 'car',
  TRAIN: 'tram',
  BUS: 'bus',
  BOAT: 'ferry',
  FLIGHT: 'airplane',
};

/** A pill with a dropdown to pick a travel mode (car/train/bus/boat/flight).
 *  Used to add an outbound/return leg, and to change a standalone leg's mode.
 *  On the iPhone the dropdown is the system's own menu. */
function ModeMenu({
  label,
  current,
  compact,
  align = 'left',
  onPick,
  readOnly,
}: {
  label?: string;
  current?: TravelMode;
  compact?: boolean;
  align?: 'left' | 'right';
  onPick: (mode: TravelMode) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);

  const icon = current ? MODE_ICON[current] ?? 'car' : 'plus';
  const text = label ?? MODE_LABEL[current!];

  return (
    <div
      className={`mode-menu ${compact ? 'mode-menu-compact' : ''} ${
        readOnly ? 'mode-menu-static' : ''
      } ${open ? 'mode-menu-open' : ''}`}
    >
      <button
        ref={pillRef}
        type="button"
        className="mode-menu-pill"
        disabled={readOnly}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          if (open) {
            setOpen(false);
            return;
          }
          if (!nativeMenusAvailable()) {
            setOpen(true);
            return;
          }
          const modes = TRAVEL_MODES.map((m) => ({
            id: m,
            title: MODE_LABEL[m],
            symbol: MODE_SYMBOL[m],
            checked: current === m,
          }));
          void showNativeMenu(e.currentTarget, [modes])
            .then((id) => id && onPick(id as TravelMode))
            // This iOS cannot open one itself: the page's menu can.
            .catch(() => setOpen(true));
        }}
      >
        {/* Keyed on the mode so picking another one cross-fades icon + label
            instead of swapping them instantly. */}
        <span className="mode-menu-face" key={current ?? 'new'}>
          <Icon name={icon} size={18} />
          <span>{text}</span>
        </span>
        {/* No caret when there is no menu behind it: the pill is a label. */}
        {/* "+ Heenreis" is an add button, as in the app: no caret either. */}
        {!readOnly && current && <Icon name="chevron-down" size={14} className="mode-menu-caret" />}
      </button>
      <ModeDrop
        anchor={pillRef.current}
        open={open}
        align={align}
        icon={icon}
        text={text}
        current={current}
        onClose={() => setOpen(false)}
        onPick={onPick}
      />
    </div>
  );
}

/** How long the unfolded mode pill takes to fold back (Planner.kt ModeDrop);
 *  it opens in 260 ms (plan.css). */
const DROP_CLOSE_MS = 200;

/**
 * The mode pill opened: the pill itself grows longer and on into a list, one
 * shape in its own colour the whole way, the chosen mode exactly where the
 * pill was and the others under it. It lies over what is below (nothing
 * shifts). With too little room below it opens upwards, the chosen mode then
 * at the bottom. A pick, a tap anywhere else or a scroll folds it back into
 * the pill; unfolding and folding each give a light tick.
 */
function ModeDrop({
  anchor,
  open,
  align,
  icon,
  text,
  current,
  onClose,
  onPick,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  align: 'left' | 'right';
  icon: IconName;
  text: string;
  current?: TravelMode;
  onClose: () => void;
  onPick: (mode: TravelMode) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [layout, setLayout] = useState<{
    left: number;
    top: number;
    up: boolean;
    clip: string;
    pillH: number;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const timer = useRef<number | undefined>(undefined);
  const wasOpen = useRef(false);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      wasOpen.current = true;
      setMounted(true);
      haptic('light');
    } else if (wasOpen.current) {
      wasOpen.current = false;
      haptic('light');
      setExpanded(false);
      timer.current = window.setTimeout(() => {
        setMounted(false);
        setLayout(null);
      }, DROP_CLOSE_MS + 40);
    }
    return () => window.clearTimeout(timer.current);
  }, [open]);

  // On the pill exactly: same left edge (a pill near the right edge keeps its
  // right edge instead), downwards whenever it fits, upwards only near the
  // bottom of the screen. Placed before it is drawn, so it never shows a
  // frame on the wrong side.
  useLayoutEffect(() => {
    if (!mounted || !open || !anchor || !ref.current) return;
    const p = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitsLeft = align === 'left' ? p.left + m.width <= vw - margin : p.right - m.width < margin;
    const left = fitsLeft ? p.left : p.right - m.width;
    const up = p.top + m.height > vh - margin && p.bottom - m.height >= margin;
    const top = up ? p.bottom - m.height : p.top;
    const t = up ? m.height - p.height : 0;
    const b = up ? 0 : m.height - p.height;
    const l = fitsLeft ? 0 : m.width - p.width;
    const r = fitsLeft ? m.width - p.width : 0;
    setLayout({
      left,
      top,
      up,
      pillH: p.height,
      clip: `inset(${t}px ${r}px ${b}px ${l}px round ${p.height / 2}px)`,
    });
  }, [mounted, open, anchor, align]);

  useEffect(() => {
    if (!open || !layout) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [open, layout]);

  // A tap beside it still reaches the page (a scroll scrolls) while the pill
  // folds shut.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      closeRef.current();
    };
    const away = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      closeRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open, anchor]);

  if (!mounted) return null;

  const others = TRAVEL_MODES.filter((m) => m !== current);
  const head = (
    <button
      type="button"
      className="mode-drop-head"
      style={layout ? { height: layout.pillH } : undefined}
      onClick={() => closeRef.current()}
    >
      <Icon name={icon} size={16} />
      <span>{text}</span>
      <Icon name="chevron-down" size={14} className="mode-drop-caret" />
    </button>
  );
  const choices = (layout?.up ? [...others].reverse() : others).map((m) => (
    <button
      key={m}
      type="button"
      role="menuitem"
      className="mode-drop-choice"
      onClick={() => {
        onPick(m);
        closeRef.current();
      }}
    >
      <Icon name={MODE_ICON[m] ?? 'car'} size={16} />
      <span>{MODE_LABEL[m]}</span>
    </button>
  ));
  const line = <span className="mode-drop-line" aria-hidden="true" />;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={`mode-drop ${expanded ? 'expanded' : ''} ${layout?.up ? 'up' : ''} ${
        layout ? '' : 'measuring'
      }`}
      style={{
        left: layout?.left ?? -9999,
        top: layout?.top ?? 0,
        clipPath: expanded ? 'inset(0px round 16px)' : layout?.clip,
      }}
    >
      {layout?.up ? (
        <>
          {choices}
          {line}
          {head}
        </>
      ) : (
        <>
          {head}
          {line}
          {choices}
        </>
      )}
    </div>,
    document.body,
  );
}
