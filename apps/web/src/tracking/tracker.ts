import { Capacitor, registerPlugin } from '@capacitor/core';
import { api } from '../api/client';
import { getTrackingIntervalMin } from '../lib/prefs';
import { BufferedPoint, bufferPoint, bufferedCount, peekPoints, removePoints } from './buffer';

/**
 * Battery-friendly trip tracker.
 *
 * Native (Android APK): our own MmsLocation plugin — a foreground service built
 * on the AOSP `LocationManager`, so it keeps recording with the screen off and
 * needs no Google Play Services (works on LineageOS / GrapheneOS). Its
 * `intervalMs` is the provider's minTime, which genuinely duty-cycles the GNSS
 * engine, and it parks itself on the significant-motion sensor while you stand
 * still. See MmsLocationService.java.
 *
 * Web/PWA fallback: geolocation.watchPosition — foreground only (browsers
 * suspend background GPS), still useful for city walks with the screen on.
 *
 * Every fix goes to the IndexedDB buffer first; a flusher uploads batches
 * whenever the network allows (idempotent via clientId).
 */

interface MmsLocationPlugin {
  start(options: {
    intervalMs: number;
    distanceFilterM: number;
    title?: string;
    message?: string;
  }): Promise<void>;
  stop(): Promise<void>;
  openSettings(): Promise<void>;
  backgroundStatus(): Promise<{ granted: boolean; foreground: boolean }>;
  addListener(
    event: 'location',
    cb: (position: NativePosition) => void,
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

/**
 * Metres you must move before the OS bothers reporting a new fix. Scaled to the
 * chosen storage interval (~30 m per minute, floor 50 m) so a long interval also
 * ignores small wanders — together with the interval itself this is what keeps
 * the GPS asleep.
 */
function distanceFilterM(): number {
  // Floor lowered to 60 m so real travel in 50-80 m steps gets captured.
  // Dynamic scaling: ~30 m per interval minute, floor 60 m, ceiling 200 m.
  return Math.min(200, Math.max(60, getTrackingIntervalMin() * 30));
}

/** Fixes vaguer than this are drift, not travel. */
const MAX_ACCURACY_M = 120;

// Second line of defence: even if a provider reports more often than asked, we
// only store a point every N minutes so the track stays lean.
let lastRecordAt = 0;

const ACTIVE_TRIP_KEY = 'mms.tracking.trip';
const LOG_KEY = 'mms.tracking.log';

export interface FixLogEntry {
  lat: number;
  lng: number;
  at: number;
  /** false when the fix arrived but was dropped by the interval/distance rules
   *  — so the log shows the GPS is alive even when nothing is stored. */
  kept?: boolean;
  /** Metres from the previously stored point, when known. */
  movedM?: number;
}

/** Recent GPS fixes (newest first), persisted so you can see it kept running. */
export function getTrackingLog(): FixLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as FixLogEntry[];
  } catch {
    return [];
  }
}

let lastLogPushAt = 0;

function pushLog(entry: FixLogEntry): void {
  try {
    const now = Date.now();
    // Kept points are always logged. Skipped points are throttled (at most once
    // every 90 seconds unless significant movement occurred) to prevent log spamming.
    if (!entry.kept && now - lastLogPushAt < 90_000 && (entry.movedM ?? 0) < 100) {
      return;
    }
    lastLogPushAt = now;
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

/** Last stored position, to report how far a new fix moved. */
let lastStored: { lat: number; lng: number } | null = null;

/** Recent stored positions to detect stationary stay clusters ("spinnenweb"). */
const recentStored: { lat: number; lng: number; at: number }[] = [];

/** Queue of recent fixes while waiting for interval or path confirmation. */
interface CandidateFix {
  position: NativePosition;
  lat: number;
  lng: number;
  at: number;
}
let candidateBuffer: CandidateFix[] = [];

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** Returns true if recent stored points form a stationary cluster around a spot. */
function inStationaryCluster(here: { lat: number; lng: number }): boolean {
  if (recentStored.length < 3) return false;
  // Calculate centroid of recent stored points
  let sumLat = 0;
  let sumLng = 0;
  for (const p of recentStored) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  const center = { lat: sumLat / recentStored.length, lng: sumLng / recentStored.length };
  
  // Check if all recent stored points sit within 80 m of center
  const allClose = recentStored.every((p) => metresBetween(center, p) <= 80);
  if (!allClose) return false;

  // If we are still within 100 m of the cluster center, suppress saving extra drift
  return metresBetween(center, here) <= 100;
}

async function storePoint(tripId: string, position: NativePosition, moved?: number): Promise<void> {
  const now = Date.now();
  const here = { lat: position.latitude, lng: position.longitude };
  lastRecordAt = now;
  lastStored = here;

  recentStored.push({ ...here, at: now });
  if (recentStored.length > 5) recentStored.shift();

  const point: BufferedPoint = {
    clientId: crypto.randomUUID(),
    tripId,
    recordedAt: new Date(position.time ?? Date.now()).toISOString(),
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy: position.accuracy,
    altitude: position.altitude,
  };
  await bufferPoint(point);
  pushLog({ ...here, at: now, kept: true, movedM: moved });
  emit({
    buffered: await bufferedCount(),
    lastFix: {
      lat: position.latitude,
      lng: position.longitude,
      at: Date.now(),
      accuracy: position.accuracy,
    },
  });
}

async function record(tripId: string, position: NativePosition): Promise<void> {
  const now = Date.now();
  const here = { lat: position.latitude, lng: position.longitude };
  const moved = lastStored ? metresBetween(lastStored, here) : undefined;

  const skip = (): void => {
    pushLog({ ...here, at: now, kept: false, movedM: moved });
    emit({ lastFix: { ...here, at: now, accuracy: position.accuracy } });
  };

  // Too vague to place: a ±120 m fix drags the route across a whole town.
  if (position.accuracy !== undefined && position.accuracy > MAX_ACCURACY_M) return skip();

  // Add to candidate buffer for path evaluation
  candidateBuffer.push({ position, ...here, at: now });
  if (candidateBuffer.length > 15) candidateBuffer.shift();

  // Check if stationary cluster (prevents hotel/stay spiderweb noise)
  if (inStationaryCluster(here)) {
    return skip();
  }

  const intervalMs = getTrackingIntervalMin() * 60_000;
  const elapsed = now - lastRecordAt;
  const filterM = distanceFilterM();

  // If time interval elapsed AND we've moved at least min distance:
  if (elapsed >= intervalMs) {
    if (moved !== undefined && moved < filterM) {
      return skip();
    }

    // If candidate buffer contains an intermediate turn point (midpoint along path), save it first!
    if (lastStored && candidateBuffer.length >= 2) {
      let bestMid: CandidateFix | null = null;
      let maxDistFromLine = 0;
      for (const cand of candidateBuffer.slice(0, -1)) {
        const d1 = metresBetween(lastStored, cand);
        const d2 = metresBetween(cand, here);
        // If candidate sits between and extends path (d1 >= 40m, d2 >= 40m)
        if (d1 >= 40 && d2 >= 40 && (d1 + d2) > moved!) {
          const lineDist = Math.abs(d1 + d2 - moved!);
          if (lineDist > maxDistFromLine) {
            maxDistFromLine = lineDist;
            bestMid = cand;
          }
        }
      }
      if (bestMid && maxDistFromLine > 30) {
        await storePoint(tripId, bestMid.position, metresBetween(lastStored, bestMid));
      }
    }

    await storePoint(tripId, position, moved);
    candidateBuffer = [];
    return;
  }

  // If interval hasn't fully elapsed yet, but we've moved significantly (> 1.5 * filterM),
  // record immediately so fast travel is captured promptly.
  if (moved !== undefined && moved >= filterM * 1.5 && elapsed >= 60_000) {
    await storePoint(tripId, position, moved);
    candidateBuffer = [];
    return;
  }

  return skip();
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
      await removePoints(tripPoints.map((p) => p.clientId));
      emit({ lastError: null });
    } catch (err) {
      emit({ lastError: err instanceof Error ? err.message : 'Upload mislukt' });
      return; // network problem — retry next flush
    }
  }
  emit({ buffered: await bufferedCount() });
}

export async function startTracking(tripId: string): Promise<void> {
  await stopTracking(false);
  localStorage.setItem(ACTIVE_TRIP_KEY, tripId);
  lastRecordAt = 0; // record the first fix immediately

  if (isNative()) {
    nativeHandles.push(
      await MmsLocation.addListener('location', (position) => void record(tripId, position)),
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
          // 'tracking' and 'idle' are both healthy states.
          emit({ lastError: null, lastStatus: label });
        }
      }),
    );
    try {
      await MmsLocation.start({
        // minTime for the provider — the knob that duty-cycles the GNSS engine.
        intervalMs: getTrackingIntervalMin() * 60_000,
        distanceFilterM: distanceFilterM(),
        title: 'MarkMySteps volgt je route',
        message: 'Locatie wordt zuinig bijgehouden tijdens je reis',
      });
    } catch (err) {
      emit({ lastError: err instanceof Error ? err.message : 'Tracking starten mislukt' });
      await stopTracking();
      return;
    }
  } else {
    if (!('geolocation' in navigator)) {
      emit({ lastError: 'Geen GPS beschikbaar in deze browser' });
      return;
    }
    webWatchId = navigator.geolocation.watchPosition(
      (pos) =>
        void record(tripId, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude ?? undefined,
          time: pos.timestamp,
        }),
      (err) => emit({ lastError: err.message }),
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
  }

  flushTimer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  window.addEventListener('online', onOnline);
  emit({ tripId, buffered: await bufferedCount(), lastError: null });
}

export async function stopTracking(clearTrip = true): Promise<void> {
  if (isNative()) {
    for (const handle of nativeHandles) await handle.remove().catch(() => undefined);
    nativeHandles = [];
    await MmsLocation.stop().catch(() => undefined);
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
  if (clearTrip) {
    localStorage.removeItem(ACTIVE_TRIP_KEY);
    await flush(); // final attempt to push what's left
    emit({ tripId: null });
  }
}

function onOnline(): void {
  void flush();
}

/**
 * Re-applies the storage interval to a RUNNING watcher. distanceFilter is only
 * read when the watcher is created, so without this a changed interval only took
 * effect after stopping and starting tracking again.
 */
export async function refreshTrackingInterval(): Promise<void> {
  const tripId = state.tripId;
  if (!tripId) return;
  await startTracking(tripId); // stops the old watcher first
}

/** Resumes tracking after an app restart if a trip was being tracked. */
export function resumeIfTracking(): void {
  const tripId = localStorage.getItem(ACTIVE_TRIP_KEY);
  if (tripId) void startTracking(tripId);
}
