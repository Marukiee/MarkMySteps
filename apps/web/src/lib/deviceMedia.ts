import type { MediaItem } from '../api/types';
import { galleryAvailable, queryGallery, requestGalleryPermission } from './gallery';
import { dbByTrip, dbDeleteMany, dbPutMany } from './localDb';

/**
 * Photos from the phone's own library on a trip that lives on a server.
 *
 * Signing in to a server does not have to mean handing it your pictures. These
 * are matched to the trip the same way Immich's are — on the day they were
 * taken, with their EXIF coordinates — but nothing is uploaded: the row kept
 * here is a reference to a file that never leaves the phone.
 *
 * What that costs is what sharing a photo means. They are on this device and
 * nowhere else: fellow travellers do not see them, a share link does not carry
 * them, the trip's photo count on the server does not know about them, and a
 * new phone starts without them. Everything else — the map, the timeline, the
 * lightbox — treats them exactly like any other photo.
 *
 * Stored in the same IndexedDB store the no-server mode uses. That mode's rows
 * are keyed by its own trip ids, so the two can never be confused for one
 * another.
 */

/** Marks an id as a file on this phone. The rest is its content:// URI. */
export const DEVICE_MEDIA_PREFIX = 'device:';

export interface DeviceMediaRow extends MediaItem {
  tripId: string;
}

export function isDeviceMediaId(id: string): boolean {
  return id.startsWith(DEVICE_MEDIA_PREFIX);
}

/** The content:// URI behind a device media id. */
export function deviceMediaUri(id: string): string {
  return decodeURIComponent(id.slice(DEVICE_MEDIA_PREFIX.length));
}

export function deviceMediaSupported(): boolean {
  return galleryAvailable();
}

export async function listDeviceMedia(tripId: string): Promise<MediaItem[]> {
  if (!galleryAvailable()) return [];
  const rows = await dbByTrip<DeviceMediaRow>('media', tripId).catch(() => []);
  return rows.filter((row) => isDeviceMediaId(row.id));
}

export interface DeviceImportResult {
  found: number;
  added: number;
  /** False means Android withheld the coordinates, so nothing lands on the map. */
  hasLocation: boolean;
}

/**
 * Takes everything shot between the trip's dates and remembers it against the
 * trip. Photos already known are left alone, so this can be run again after a
 * day out without collecting duplicates.
 */
export async function importDeviceMedia(
  tripId: string,
  fromDay: string,
  toDay: string,
  userId: string,
): Promise<DeviceImportResult> {
  const permissions = await requestGalleryPermission();
  if (!permissions.library) {
    throw new Error('Geen toegang tot je fotobibliotheek.');
  }
  const items = await queryGallery(fromDay, toDay);
  const known = new Set((await listDeviceMedia(tripId)).map((m) => m.id));
  const fresh: DeviceMediaRow[] = [];
  for (const item of items) {
    const id = `${DEVICE_MEDIA_PREFIX}${encodeURIComponent(item.uri)}`;
    if (known.has(id)) continue;
    fresh.push({
      id,
      tripId,
      userId,
      immichAssetId: item.uri,
      assetType: item.video ? 'VIDEO' : 'IMAGE',
      takenAt: new Date(item.takenAt).toISOString(),
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
    });
  }
  if (fresh.length > 0) await dbPutMany('media', fresh);
  return { found: items.length, added: fresh.length, hasLocation: permissions.location };
}

/** Forgets them again. The files themselves are not touched — they never were. */
export async function clearDeviceMedia(tripId: string): Promise<number> {
  const rows = await listDeviceMedia(tripId);
  if (rows.length > 0) await dbDeleteMany('media', rows.map((row) => row.id));
  return rows.length;
}
