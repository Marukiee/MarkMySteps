import { Capacitor, registerPlugin } from '@capacitor/core';
import { ApiError, api } from '../api/client';
import { notify } from '../lib/notify';
import { getTrackingIntervalMin } from '../lib/prefs';
import { BufferedPoint, bufferPoint, bufferedCount, peekPoints, removePoints } from './buffer';

/**
 * Battery-friendly trip tracker.
 *
 * Native (Android APK): our own MmsLocation plugin — a foreground service built
 * on the AOSP `LocationManager`, so it keeps recording with the screen off and
 * needs no Google Play Services (works on LineageOS / GrapheneOS). It takes
 * exactly one position per interval and keeps the GNSS engine off in between,
 * so this side does no pacing of its own: every fix handed over is one
 * scheduled check. See MmsLocationService.java.
 *
 * Web/PWA fallback: geolocation.watchPosition — foreground only (browsers
 * suspend background GPS) and it reports continuously, so there the interval is
 * applied here instead.
 *
 * Every fix goes to the IndexedDB buffer first; a flusher uploads batches
 * whenever the network allows (idempotent via clientId).
 */

interface MmsLocationPlugin {
  start(options: { intervalMs: number; title?: string }): Promise<void>;
  stop(): Promise<void>;
  openSettings(): Promise<void>;
  backgroundStatus(): Promise<{ granted: boolean; foreground: boolean }>;
  /** One position now, without starting the service. Rejects without permission. */
  currentPosition(): Promise<NativePosition>;
  /** Collects the fixes the service queued (and clears its queue). */
  drain(): Promise<{ fixes: NativePosition[] }>;
  addListener(
    event: 'location',
    cb: () => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: 'status',
    cb: (data: { state: string; message: string | null }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

interface NativePosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  time?: number;
}

const MmsLocation = registerPlugin<MmsLocationPlugin>('MmsLocation');

const FLUSH_INTERVAL_MS = 60_000;
const BATCH_SIZE = 500;

/** Fixes vaguer than this are drift, not travel. */
const MAX_ACCURACY_M = 120;

/**
 * Radius around the first fix of a stay. Everything inside it is the same
 * place — a hotel, a terrace, an office — and is merged into one point rather
 * than sprayed across the map as a spiderweb. Membership is measured against
 * that first fix, not against the running average, so walking away steadily
 * still leaves the stay after ~75 m instead of dragging it along.
 */
const STAY_RADIUS_M = 75;

const ACTIVE_TRIP_KEY = 'mms.tracking.trip';
/** When the tracked trip stops being under way, as epoch ms. */
const ACTIVE_UNTIL_KEY = 'mms.tracking.until';
const DAY_MS = 86_400_000;
const LOG_KEY = 'mms.tracking.log';

export interface FixLogEntry {
  lat: number;
  lng: number;
  at: number;
  /** Metres from the previous check, when known. */
  movedM?: number;
  /** Reported accuracy of this fix, in metres. */
  accuracyM?: number;
  /** How many checks have now been merged into the same stay (2 or more means
   *  this one did not add a new point but refined the existing one). */
  stayCount?: number;
}

/** Recent GPS fixes (newest first), persisted so you can see it kept running. */
export function getTrackingLog(): FixLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as FixLogEntry[];
  } catch {
    return [];
  }
}

/** One line per scheduled check — no more, no less. */
function pushLog(entry: FixLogEntry): void {
  try {
    const log = [entry, ...getTrackingLog()].slice(0, 60);
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* storage full — log is best-effort */
  }
}

type Listener = (state: TrackerState) => void;

export interface TrackerState {
  tripId: string | null;
  buffered: number;
  lastError: string | null;
  /** Most recent GPS fix — proof tracking is alive. */
  lastFix: { lat: number; lng: number; at: number; accuracy?: number } | null;
  /** Last thing the native service reported (which providers it registered on,
   *  whether it parked itself on the motion sensor). Diagnostics only. */
  lastStatus: string | null;
}

let nativeHandles: { remove: () => Promise<void> }[] = [];
let webWatchId: number | null = null;
let flushTimer: number | null = null;
let listeners: Listener[] = [];
let state: TrackerState = {
  tripId: null,
  buffered: 0,
  lastError: null,
  lastFix: null,
  lastStatus: null,
};

function emit(patch: Partial<TrackerState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function onTrackerChange(listener: Listener): () => void {
  listeners.push(listener);
  listener(state);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Open the OS app-settings so the user can flip location to "Always allow"
 *  (needed for background tracking with the screen off). */
/** True when location is on "Allow all the time" (needed with the screen off).
 *  Returns true on the web, where the question doesn't apply. */
export async function hasBackgroundLocation(): Promise<boolean> {
  if (!isNative()) return true;
  return MmsLocation.backgroundStatus()
    .then((r) => r.granted)
    .catch(() => true); // unknown → don't nag
}

export async function openLocationSettings(): Promise<void> {
  await MmsLocation.openSettings().catch(() => undefined);
}

/** Position of the previous check, to report how far you moved. */
let lastChecked: { lat: number; lng: number } | null = null;

/**
 * The place you are currently at. While fixes keep landing inside its radius
 * they refine this one point instead of adding new ones, so standing still
 * produces a single dot rather than a cluster.
 */
interface Stay {
  /** First fix of the stay — the yardstick for "still the same place". */
  anchor: { lat: number; lng: number };
  sumLat: number;
  sumLng: number;
  count: number;
  clientId: string;
  startedAt: number;
  /** Once uploaded the point can no longer be rewritten, so later fixes only
   *  update the in-memory average. */
  uploaded: boolean;
}
let stay: Stay | null = null;

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** Web fallback only: watchPosition fires far more often than we want. */
let lastWebCheckAt = 0;

/**
 * Collects everything the native service queued and records it in order. The
 * service keeps queueing while the WebView is gone, so a backlog after the app
 * was killed still ends up in the route.
 */
async function drainNative(tripId: string): Promise<void> {
  const { fixes } = await MmsLocation.drain().catch(() => ({ fixes: [] as NativePosition[] }));
  for (const fix of fixes) await record(tripId, fix);
}

/** Collects the native backlog when the app comes back to the foreground. */
let resumeDrain: (() => void) | null = null;
function onVisible(): void {
  if (document.visibilityState === 'visible') resumeDrain?.();
}

/** Serialises the checks, so two fixes arriving together can't both open a stay. */
let recordChain: Promise<void> = Promise.resolve();

function record(tripId: string, position: NativePosition): Promise<void> {
  recordChain = recordChain.then(() => handleFix(tripId, position)).catch(() => undefined);
  return recordChain;
}

/**
 * One scheduled check. It always produces exactly one log line; whether that
 * check also adds a point depends only on whether you left the current stay.
 */
async function handleFix(tripId: string, position: NativePosition): Promise<void> {
  const at = position.time && position.time > 0 ? position.time : Date.now();
  const here = { lat: position.latitude, lng: position.longitude };
  const moved = lastChecked ? metresBetween(lastChecked, here) : undefined;

  // Too vague to place: a ±120 m fix drags the route across a whole town. It is
  // logged (the GPS did answer) but never stored and never opens a stay.
  if (position.accuracy !== undefined && position.accuracy > MAX_ACCURACY_M) {
    pushLog({ ...here, at, movedM: moved, accuracyM: Math.round(position.accuracy) });
    emit({ lastFix: { ...here, at, accuracy: position.accuracy } });
    return;
  }

  lastChecked = here;

  if (stay && metresBetween(stay.anchor, here) <= STAY_RADIUS_M) {
    await mergeIntoStay(tripId, position);
    pushLog({
      ...here,
      at,
      movedM: moved,
      accuracyM: position.accuracy !== undefined ? Math.round(position.accuracy) : undefined,
      stayCount: stay.count,
    });
  } else {
    await openStay(tripId, position, at);
    pushLog({
      ...here,
      at,
      movedM: moved,
      accuracyM: position.accuracy !== undefined ? Math.round(position.accuracy) : undefined,
    });
  }

  emit({
    buffered: await bufferedCount(),
    lastFix: { ...here, at, accuracy: position.accuracy },
  });
}

/** You moved somewhere new: store this fix and make it the new stay. */
async function openStay(tripId: string, position: NativePosition, at: number): Promise<void> {
  stay = {
    anchor: { lat: position.latitude, lng: position.longitude },
    sumLat: position.latitude,
    sumLng: position.longitude,
    count: 1,
    clientId: crypto.randomUUID(),
    startedAt: at,
    uploaded: false,
  };
  await bufferPoint(stayPoint(tripId, position));
}

/**
 * Still the same place: fold this fix into the stay's average and rewrite the
 * point that is already buffered, so a night in a hotel is one dot on the map.
 * Once it has been uploaded it can no longer be rewritten (the server ignores a
 * clientId it already has), so from then on only the average moves.
 */
async function mergeIntoStay(tripId: string, position: NativePosition): Promise<void> {
  if (!stay) return;
  stay.sumLat += position.latitude;
  stay.sumLng += position.longitude;
  stay.count += 1;
  if (!stay.uploaded) {
    await bufferPoint(
      stayPoint(tripId, {
        ...position,
        latitude: stay.sumLat / stay.count,
        longitude: stay.sumLng / stay.count,
        time: stay.startedAt,
      }),
    );
  }
}

function stayPoint(tripId: string, position: NativePosition): BufferedPoint {
  return {
    clientId: stay!.clientId,
    tripId,
    recordedAt: new Date(position.time ?? Date.now()).toISOString(),
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy: position.accuracy,
    altitude: position.altitude,
  };
}

export async function flush(): Promise<void> {
  const points = await peekPoints(BATCH_SIZE);
  if (points.length === 0 || !navigator.onLine) return;

  // Points can belong to different trips (rare, but possible after a switch).
  const byTrip = new Map<string, BufferedPoint[]>();
  for (const point of points) {
    const list = byTrip.get(point.tripId) ?? [];
    list.push(point);
    byTrip.set(point.tripId, list);
  }

  for (const [tripId, tripPoints] of byTrip) {
    try {
      await api(`/trips/${tripId}/points/batch`, {
        method: 'POST',
        body: {
          points: tripPoints.map(({ tripId: _ignored, ...p }) => p),
        },
      });
      const ids = tripPoints.map((p) => p.clientId);
      // The server ignores a clientId it already stored, so a stay that has
      // been uploaded can no longer be refined — stop rewriting it.
      if (stay && ids.includes(stay.clientId)) stay.uploaded = true;
      await removePoints(ids);
      emit({ lastError: null });
    } catch (err) {
      emit({ lastError: err instanceof Error ? err.message : 'Upload mislukt' });
      return; // network problem — retry next flush
    }
  }
  emit({ buffered: await bufferedCount() });
}

/**
 * Learns when the tracked trip is over. Kept on the device, so the check below
 * still works with no signal — which is the situation it exists for.
 *
 * The end date is a day, and a day you are still on: a trip that ends today is
 * under way until tonight.
 */
async function refreshTripDeadline(tripId: string): Promise<void> {
  try {
    const trip = await api<{ endDate: string }>(`/trips/${tripId}`);
    const until = new Date(trip.endDate.slice(0, 10)).getTime() + DAY_MS;
    if (Number.isFinite(until)) localStorage.setItem(ACTIVE_UNTIL_KEY, String(until));
  } catch (err) {
    // The trip was deleted while it was being tracked: there is nothing left to
    // record onto, so treat it as finished right now.
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      localStorage.setItem(ACTIVE_UNTIL_KEY, '1');
      return;
    }
    // Offline. Whatever was known stays known.
  }
}

/**
 * Switches tracking off once the trip it belongs to has finished.
 *
 * A tracker left running past the last day records the drive home and then
 * every commute after it, onto a trip that is supposed to be finished — and
 * keeps the GNSS engine waking up for it. Checked on the flush tick and on
 * every return to the foreground, so it also fires for a phone that spent the
 * last day of the trip in a pocket.
 */
async function stopIfTripIsOver(): Promise<boolean> {
  const tripId = localStorage.getItem(ACTIVE_TRIP_KEY);
  if (!tripId) return false;
  // The deadline is learned over the network, and starting a trip with no
  // signal leaves it unknown. Unknown must not mean "record forever", so keep
  // asking until it is answered.
  if (!localStorage.getItem(ACTIVE_UNTIL_KEY)) await refreshTripDeadline(tripId);
  const until = Number(localStorage.getItem(ACTIVE_UNTIL_KEY));
  if (!Number.isFinite(until) || until <= 0 || Date.now() <= until) return false;
  await stopTracking();
  const message = 'Tracking is automatisch gestopt.';
  emit({ lastStatus: message });
  // Said out loud too: the app is usually not the thing you are looking at when
  // a trip ends, and a tracker that stops silently looks like one that broke.
  notify('Tracking gestopt', message);
  return true;
}

export async function startTracking(tripId: string): Promise<void> {
  // Everything the service queued while the app was away has to be collected
  // BEFORE the listeners are torn down and the service is reconfigured.
  if (isNative() && localStorage.getItem(ACTIVE_TRIP_KEY)) {
    await drainNative(localStorage.getItem(ACTIVE_TRIP_KEY)!).catch(() => undefined);
  }
  await stopTracking(false);
  localStorage.setItem(ACTIVE_TRIP_KEY, tripId);
  // Not awaited: starting must not wait on the network, and a trip whose dates
  // cannot be looked up right now is simply tracked until they can be.
  localStorage.removeItem(ACTIVE_UNTIL_KEY);
  // Starting on a trip that is already over is caught as soon as its dates are
  // known, rather than a minute later on the first flush tick.
  void refreshTripDeadline(tripId).then(() => stopIfTripIsOver());
  // A fresh watcher starts a fresh stay, so the first fix always lands.
  stay = null;
  lastWebCheckAt = 0;

  if (isNative()) {
    nativeHandles.push(
      await MmsLocation.addListener('location', () => void drainNative(tripId)),
    );
    nativeHandles.push(
      await MmsLocation.addListener('status', ({ state: s, message }) => {
        const label = message ? `${s}: ${message}` : s;
        if (s === 'permission') {
          emit({ lastError: message ?? 'Locatietoestemming ontbreekt', lastStatus: label });
          void MmsLocation.openSettings();
        } else if (s === 'error') {
          emit({ lastError: message ?? 'Locatiefout', lastStatus: label });
        } else {
          // 'nofix' is a missed check, not a failure — the next one may work.
          emit({ lastStatus: label });
        }
      }),
    );
    try {
      await MmsLocation.start({
        // How often the service wakes for one single position.
        intervalMs: getTrackingIntervalMin() * 60_000,
        title: 'MarkMySteps volgt je route',
      });
    } catch (err) {
      emit({ lastError: err instanceof Error ? err.message : 'Tracking starten mislukt' });
      await stopTracking();
      return;
    }
    // Anything the service recorded while the app was away.
    void drainNative(tripId);
    // The 'location' event only arrives while a page is alive, so coming back
    // to the foreground is the other moment the backlog has to be collected.
    resumeDrain = () => {
      void drainNative(tripId).then(() => flush());
      // Coming back to the app is also the moment to notice the trip ended
      // while it was away, and to pick up a changed end date.
      void refreshTripDeadline(tripId).then(() => stopIfTripIsOver());
    };
    document.addEventListener('resume', resumeDrain);
    document.addEventListener('visibilitychange', onVisible);
  } else {
    if (!('geolocation' in navigator)) {
      emit({ lastError: 'Geen GPS beschikbaar in deze browser' });
      return;
    }
    webWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        // watchPosition reports continuously; the interval lives here so the
        // browser behaves like the native service: one check per interval.
        const now = Date.now();
        if (now - lastWebCheckAt < getTrackingIntervalMin() * 60_000) return;
        lastWebCheckAt = now;
        void record(tripId, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude ?? undefined,
          time: pos.timestamp,
        });
      },
      (err) => emit({ lastError: err.message }),
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
  }

  flushTimer = window.setInterval(() => {
    void stopIfTripIsOver().then((over) => (over ? undefined : flush()));
  }, FLUSH_INTERVAL_MS);
  window.addEventListener('online', onOnline);
  emit({ tripId, buffered: await bufferedCount(), lastError: null });
}

export async function stopTracking(clearTrip = true): Promise<void> {
  if (isNative()) {
    const active = localStorage.getItem(ACTIVE_TRIP_KEY);
    // Collect whatever is still queued before anything is taken down.
    if (clearTrip && active) await drainNative(active).catch(() => undefined);
    for (const handle of nativeHandles) await handle.remove().catch(() => undefined);
    nativeHandles = [];
    // Only a real stop takes the service down. Restarting the watcher (app
    // launch, changed interval) leaves it running: killing and recreating it on
    // every launch dropped the fix currently in flight and reset its cadence.
    if (clearTrip) await MmsLocation.stop().catch(() => undefined);
  }
  if (webWatchId !== null) {
    navigator.geolocation.clearWatch(webWatchId);
    webWatchId = null;
  }
  if (flushTimer !== null) {
    window.clearInterval(flushTimer);
    flushTimer = null;
  }
  window.removeEventListener('online', onOnline);
  if (resumeDrain) {
    document.removeEventListener('resume', resumeDrain);
    document.removeEventListener('visibilitychange', onVisible);
    resumeDrain = null;
  }
  if (clearTrip) {
    localStorage.removeItem(ACTIVE_TRIP_KEY);
    localStorage.removeItem(ACTIVE_UNTIL_KEY);
    await flush(); // final attempt to push what's left
    emit({ tripId: null });
  }
}

function onOnline(): void {
  void flush();
}

/**
 * Re-applies the interval to a RUNNING tracker. The service reads it once when
 * it starts, so without this a changed interval only took effect after stopping
 * and starting tracking again.
 */
export async function refreshTrackingInterval(): Promise<void> {
  const tripId = state.tripId;
  if (!tripId) return;
  await startTracking(tripId); // stops the old watcher first
}

/** Resumes tracking after an app restart if a trip was being tracked. */
export function resumeIfTracking(): void {
  const tripId = localStorage.getItem(ACTIVE_TRIP_KEY);
  if (!tripId) return;
  // A trip that finished while the app was shut is not picked up again.
  void stopIfTripIsOver().then((over) => {
    if (!over) void startTracking(tripId);
  });
}

/**
 * One position at app start, whether or not a trip is being tracked, so the
 * maps and the globe can show where you are straight away instead of only
 * after the first scheduled check.
 *
 * Never prompts: without the permission it quietly does nothing. When a trip IS
 * being tracked the fix goes through the normal recording path, so it also
 * closes the gap left while the app was shut.
 */
export async function captureCurrentLocation(): Promise<void> {
  if (!isNative()) return;
  const granted = await MmsLocation.backgroundStatus()
    .then((r) => r.foreground)
    .catch(() => false);
  if (!granted) return;

  const fix = await MmsLocation.currentPosition().catch(() => null);
  if (!fix) return;

  const tripId = state.tripId ?? localStorage.getItem(ACTIVE_TRIP_KEY);
  if (tripId) {
    await record(tripId, fix);
    void flush();
    return;
  }
  // Not tracking: it is only a position to draw, not a point on any route.
  emit({
    lastFix: {
      lat: fix.latitude,
      lng: fix.longitude,
      at: fix.time && fix.time > 0 ? fix.time : Date.now(),
      accuracy: fix.accuracy,
    },
  });
}
