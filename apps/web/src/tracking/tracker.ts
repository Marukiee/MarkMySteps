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
  // Capped, or a 30-minute interval would ask for ~900 m and the route would
  // lose its shape through a town.
  return Math.min(300, Math.max(50, getTrackingIntervalMin() * 30));
}

// Second line of defence: even if a provider reports more often than asked, we
// only store a point every N minutes so the track stays lean.
let lastRecordAt = 0;

const ACTIVE_TRIP_KEY = 'mms.tracking.trip';
const LOG_KEY = 'mms.tracking.log';

export interface FixLogEntry {
  lat: number;
  lng: number;
  at: number;
}

/** Recent GPS fixes (newest first), persisted so you can see it kept running. */
export function getTrackingLog(): FixLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as FixLogEntry[];
  } catch {
    return [];
  }
}

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
}

let nativeHandles: { remove: () => Promise<void> }[] = [];
let webWatchId: number | null = null;
let flushTimer: number | null = null;
let listeners: Listener[] = [];
let state: TrackerState = { tripId: null, buffered: 0, lastError: null, lastFix: null };

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
export async function openLocationSettings(): Promise<void> {
  await MmsLocation.openSettings().catch(() => undefined);
}

async function record(tripId: string, position: NativePosition): Promise<void> {
  // Skip fixes that arrive sooner than the configured interval.
  const now = Date.now();
  if (now - lastRecordAt < getTrackingIntervalMin() * 60_000) return;
  lastRecordAt = now;

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
  pushLog({ lat: position.latitude, lng: position.longitude, at: Date.now() });
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
        if (s === 'permission') {
          emit({ lastError: message ?? 'Locatietoestemming ontbreekt' });
          void MmsLocation.openSettings();
        } else if (s === 'error') {
          emit({ lastError: message ?? 'Locatiefout' });
        } else {
          // 'tracking' and 'idle' are both healthy states.
          emit({ lastError: null });
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
