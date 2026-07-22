import { Capacitor, registerPlugin } from '@capacitor/core';
import { api } from '../api/client';
import { BufferedPoint, bufferPoint, bufferedCount, peekPoints, removePoints } from './buffer';

/**
 * Battery-friendly trip tracker.
 *
 * Native (Android APK): @capacitor-community/background-geolocation — AOSP
 * LocationManager with a foreground service + persistent notification, so it
 * keeps recording with the screen off. No Google Play Services involved
 * (works on LineageOS / GrapheneOS). distanceFilter keeps the GPS duty
 * cycle low: a new fix only when you actually moved.
 *
 * Web/PWA fallback: geolocation.watchPosition — foreground only (browsers
 * suspend background GPS), still useful for city walks with the screen on.
 *
 * Every fix goes to the IndexedDB buffer first; a flusher uploads batches
 * whenever the network allows (idempotent via clientId).
 */

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position?: NativePosition, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

interface NativePosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  time?: number;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/** Minimum meters between recorded fixes. */
const DISTANCE_FILTER_M = 50;
const FLUSH_INTERVAL_MS = 60_000;
const BATCH_SIZE = 500;

const ACTIVE_TRIP_KEY = 'mms.tracking.trip';

type Listener = (state: TrackerState) => void;

export interface TrackerState {
  tripId: string | null;
  buffered: number;
  lastError: string | null;
}

let watcherId: string | null = null;
let webWatchId: number | null = null;
let flushTimer: number | null = null;
let listeners: Listener[] = [];
let state: TrackerState = { tripId: null, buffered: 0, lastError: null };

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

async function record(tripId: string, position: NativePosition): Promise<void> {
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
  emit({ buffered: await bufferedCount() });
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

  if (isNative()) {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'MarkMySteps volgt je route',
        backgroundMessage: 'Locatie wordt zuinig bijgehouden tijdens je reis',
        requestPermissions: true,
        stale: false,
        distanceFilter: DISTANCE_FILTER_M,
      },
      (position, error) => {
        if (error) {
          emit({ lastError: error.message ?? 'Locatiefout' });
          if (error.code === 'NOT_AUTHORIZED') void BackgroundGeolocation.openSettings();
          return;
        }
        if (position) void record(tripId, position);
      },
    );
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
  if (watcherId) {
    await BackgroundGeolocation.removeWatcher({ id: watcherId }).catch(() => undefined);
    watcherId = null;
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

/** Resumes tracking after an app restart if a trip was being tracked. */
export function resumeIfTracking(): void {
  const tripId = localStorage.getItem(ACTIVE_TRIP_KEY);
  if (tripId) void startTracking(tripId);
}
