import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The phone's own photo library (MmsGalleryPlugin).
 *
 * Used instead of Immich when running without a server. Photos are matched to a
 * trip on when they were TAKEN, and their coordinates come from the file's own
 * EXIF — which Android only hands over with ACCESS_MEDIA_LOCATION, hence the
 * separate flag in the permission status.
 */

export interface GalleryItem {
  /** content:// URI. Turn it into something an <img> accepts with mediaSrc(). */
  uri: string;
  /** Epoch ms. */
  takenAt: number;
  mime: string;
  video: boolean;
  width: number;
  height: number;
  latitude?: number;
  longitude?: number;
}

export interface GalleryPermissions {
  library: boolean;
  /** False means photos come through without their coordinates. */
  location: boolean;
}

interface MmsGalleryPlugin {
  permissionStatus(): Promise<GalleryPermissions>;
  requestPermission(): Promise<GalleryPermissions>;
  query(options: { fromMs: number; toMs: number }): Promise<{
    items: GalleryItem[];
    hasLocation: boolean;
  }>;
}

const MmsGallery = registerPlugin<MmsGalleryPlugin>('MmsGallery');

export function galleryAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function galleryPermissions(): Promise<GalleryPermissions> {
  if (!galleryAvailable()) return { library: false, location: false };
  return MmsGallery.permissionStatus().catch(() => ({ library: false, location: false }));
}

export async function requestGalleryPermission(): Promise<GalleryPermissions> {
  if (!galleryAvailable()) return { library: false, location: false };
  return MmsGallery.requestPermission().catch(() => ({ library: false, location: false }));
}

/** Everything shot between two days, both inclusive. */
export async function queryGallery(fromDay: string, toDay: string): Promise<GalleryItem[]> {
  if (!galleryAvailable()) return [];
  const from = new Date(`${fromDay.slice(0, 10)}T00:00:00`).getTime();
  // End of the last day, not its midnight — a photo taken at 22:00 belongs to it.
  const to = new Date(`${toDay.slice(0, 10)}T00:00:00`).getTime() + 86_400_000 - 1;
  const { items } = await MmsGallery.query({ fromMs: from, toMs: to });
  return items;
}

/**
 * A `content://` URI an <img> can load. Capacitor proxies it through its own
 * origin, so the file streams natively instead of crossing the bridge encoded.
 */
export function mediaSrc(uri: string): string {
  return Capacitor.convertFileSrc(uri);
}
