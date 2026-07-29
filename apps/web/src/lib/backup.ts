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
