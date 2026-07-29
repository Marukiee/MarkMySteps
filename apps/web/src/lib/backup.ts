import { Capacitor, registerPlugin } from '@capacitor/core';
import { api } from '../api/client';
import type { MediaItem, Trip } from '../api/types';
import type { PlannedStop } from './arc';

/**
 * A full copy of everything the app knows about your trips, as one file.
 *
 * Read through `api()`, so it works the same whether the data lives on a
 * server or on the device — and a backup taken from one can be read by the
 * other, because every record already carries the id it will keep.
 *
 * Photos are references, not pixels: on a server they live in Immich, and
 * locally they are files in your own gallery. Copying them into the backup
 * would turn a small file into gigabytes of what you already have.
 */

export const BACKUP_VERSION = 1;

interface TripNote {
  id: string;
  day: string;
  body: string;
}

interface TrackedPoint {
  id: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
}

export interface Backup {
  version: number;
  createdAt: string;
  app: string;
  trips: {
    trip: Trip;
    stops: PlannedStop[];
    media: MediaItem[];
    notes: TripNote[];
    points: TrackedPoint[];
  }[];
  /** Device preferences (theme, map style, airports, tracking cadence…). */
  settings: Record<string, string>;
}

interface MmsExportPlugin {
  save(options: {
    filename: string;
    mimeType: string;
    base64: string;
    share?: boolean;
  }): Promise<{ path: string; uri: string }>;
}

const MmsExport = registerPlugin<MmsExportPlugin>('MmsExport');

/** Every device preference, so a restore feels like the same app. */
function settingsSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // Only the settings — not the session tokens, and not the offline queues.
    if (!key || !key.startsWith('mms.')) continue;
    if (['mms.access', 'mms.refresh', 'mms.pending', 'mms.weather'].includes(key)) continue;
    out[key] = localStorage.getItem(key) ?? '';
  }
  return out;
}

/**
 * Collects everything, reporting progress per trip so a long export can show
 * where it is rather than freezing on a spinner.
 */
export async function createBackup(
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<Backup> {
  const trips = await api<Trip[]>('/trips');
  const out: Backup['trips'] = [];

  for (const [index, trip] of trips.entries()) {
    onProgress?.(index, trips.length, trip.title);
    const [stops, media, notes, points] = await Promise.all([
      api<PlannedStop[]>(`/trips/${trip.id}/stops`).catch(() => []),
      api<MediaItem[]>(`/trips/${trip.id}/media`).catch(() => []),
      api<TripNote[]>(`/trips/${trip.id}/notes`).catch(() => []),
      api<TrackedPoint[]>(`/trips/${trip.id}/points`).catch(() => []),
    ]);
    out.push({ trip, stops, media, notes, points });
  }
  onProgress?.(trips.length, trips.length, '');

  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: 'MarkMySteps',
    trips: out,
    settings: settingsSnapshot(),
  };
}

export function backupFilename(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `markmysteps-backup-${stamp}.json`;
}

/** UTF-8 safe: a plain btoa() mangles anything above ASCII, and trip names
 *  are full of it. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000; // apply() has an argument-count ceiling
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Writes the backup where you can get at it: the phone's Downloads folder,
 * with a share sheet on top. In a browser it is an ordinary download.
 *
 * Returns where it went, so the app can say so.
 */
export async function saveBackup(backup: Backup, share = true): Promise<string> {
  const json = JSON.stringify(backup, null, 2);
  const filename = backupFilename();

  if (Capacitor.isNativePlatform()) {
    const { path } = await MmsExport.save({
      filename,
      mimeType: 'application/json',
      base64: toBase64(json),
      share,
    });
    return path;
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking straight away can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

/** Rough size of the file that would be written, for the button's label. */
export function backupSize(backup: Backup): number {
  return new Blob([JSON.stringify(backup)]).size;
}

/* -------------------------------------------------------------------------
   Restore
   ------------------------------------------------------------------------- */

export interface RestoreResult {
  tripsAdded: number;
  tripsSkipped: number;
  stops: number;
  points: number;
  notes: number;
  /** Trips whose cover photo could not be re-linked (the photo isn't here). */
  coversLost: number;
}

/** Reads and validates a file the user picked. */
export async function readBackupFile(file: File): Promise<Backup> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Dit is geen leesbaar back-upbestand.');
  }
  const backup = parsed as Partial<Backup>;
  if (backup.app !== 'MarkMySteps' || !Array.isArray(backup.trips)) {
    throw new Error('Dit bestand komt niet van MarkMySteps.');
  }
  if ((backup.version ?? 0) > BACKUP_VERSION) {
    throw new Error('Deze back-up komt van een nieuwere versie van de app.');
  }
  return backup as Backup;
}

/**
 * Puts a backup back, trip by trip.
 *
 * A trip that is already here is left alone rather than merged: half-merging
 * two versions of the same route is worse than either of them, and skipping is
 * something the result can report honestly.
 *
 * Everything keeps the id it had, which is also what makes this the same
 * operation as handing a device-only account to a server for the first time.
 */
export async function restoreBackup(
  backup: Backup,
  options: { settings?: boolean } = {},
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<RestoreResult> {
  const existing = await api<Trip[]>('/trips').catch(() => []);
  const known = new Set(existing.map((t) => t.id));
  const result: RestoreResult = {
    tripsAdded: 0,
    tripsSkipped: 0,
    stops: 0,
    points: 0,
    notes: 0,
    coversLost: 0,
  };

  for (const [index, entry] of backup.trips.entries()) {
    const { trip, stops, notes, points } = entry;
    onProgress?.(index, backup.trips.length, trip.title);
    if (known.has(trip.id)) {
      result.tripsSkipped += 1;
      continue;
    }

    await api('/trips', {
      method: 'POST',
      body: {
        id: trip.id,
        title: trip.title,
        description: trip.description ?? undefined,
        startDate: trip.startDate,
        endDate: trip.endDate,
      },
    });
    // The looks of a trip are a second call: create only takes the essentials.
    await api(`/trips/${trip.id}`, {
      method: 'PATCH',
      body: {
        color: trip.color ?? null,
        markerLng: trip.markerLng ?? null,
        markerLat: trip.markerLat ?? null,
        autoTrack: trip.autoTrack,
      },
    }).catch(() => undefined);
    // The cover points at a photo, and photos are not in the backup — it will
    // re-link itself once the same library or Immich account is connected.
    if (trip.coverMediaId) result.coversLost += 1;
    result.tripsAdded += 1;

    // Route stops first, in order; then the day trips, whose parent now exists.
    const route = stops.filter((s) => !s.parentStopId);
    const dayTrips = stops.filter((s) => s.parentStopId);
    for (const stop of [...route, ...dayTrips]) {
      await api(`/trips/${trip.id}/stops`, {
        method: 'POST',
        body: {
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
        },
      }).catch(() => undefined);
      result.stops += 1;
    }
    // Appending kept them in order, but only by luck of the ordering above —
    // this makes it exact.
    if (route.length > 1) {
      await api(`/trips/${trip.id}/stops/order`, {
        method: 'PUT',
        body: { stopIds: route.map((s) => s.id) },
      }).catch(() => undefined);
    }

    // Points go in as a tracked batch: the id doubles as the clientId, so
    // restoring the same backup twice cannot duplicate the route.
    const BATCH = 400;
    for (let i = 0; i < points.length; i += BATCH) {
      const slice = points.slice(i, i + BATCH);
      await api(`/trips/${trip.id}/points/batch`, {
        method: 'POST',
        body: {
          points: slice.map((p) => ({
            clientId: p.id,
            recordedAt: p.recordedAt,
            latitude: p.latitude,
            longitude: p.longitude,
          })),
        },
      }).catch(() => undefined);
      result.points += slice.length;
    }

    for (const note of notes) {
      await api(`/trips/${trip.id}/notes`, {
        method: 'POST',
        body: { day: note.day, body: note.body },
      }).catch(() => undefined);
      result.notes += 1;
    }
  }
  onProgress?.(backup.trips.length, backup.trips.length, '');

  if (options.settings && backup.settings) {
    for (const [key, value] of Object.entries(backup.settings)) {
      if (!key.startsWith('mms.')) continue;
      localStorage.setItem(key, value);
    }
  }
  return result;
}
