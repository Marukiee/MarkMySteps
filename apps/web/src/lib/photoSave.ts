import { getAccessToken, getServerBase } from '../api/client';
import type { MediaItem } from '../api/types';
import { shareOrSaveFiles, type ShareOutcome } from './fileShare';

/** Extension for a downloaded file when its name has to be invented. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/**
 * The name Immich sends the file under, if it sends one.
 *
 * `filename*=UTF-8''IMG_0042.jpg` is the encoded form and wins over the plain
 * `filename="…"` when both are there, which is what a name with an accent in
 * it looks like.
 */
function nameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]!.trim());
    } catch {
      // Fall through to the plain form: a malformed escape is not a reason to
      // refuse the download.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1]!.trim() : null;
}

/** Anything a filesystem would rather not be handed. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}

/**
 * Saves one photo or video the way the device saves things.
 *
 * The picture on screen is a rendition — a re-encoded ~1440px JPEG — so the
 * download asks the server for `size=original` instead: what comes down is the
 * file as it was uploaded, under the name it was uploaded with.
 *
 * The share page has no session to fetch with, so it hands in its own URL
 * builder, exactly as it does for the pixels the viewer shows.
 */
export async function savePhoto(
  item: MediaItem,
  srcFor?: (item: MediaItem, size: 'thumbnail' | 'preview' | 'original') => string,
): Promise<ShareOutcome> {
  const token = getAccessToken();
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  let res: Response;
  try {
    res = srcFor
      ? await fetch(srcFor(item, 'original'))
      : await fetch(`${getServerBase()}/api/media/${item.id}/thumbnail?size=original`, {
          headers,
        });
  } catch {
    return 'failed';
  }
  if (!res.ok) return 'failed';

  const blob = await res.blob();
  const type = blob.type || res.headers.get('content-type') || 'image/jpeg';
  const fallback = `${item.takenAt.slice(0, 10)}-${item.id.slice(0, 8)}.${
    EXTENSIONS[type.split(';')[0]!.trim()] ?? 'jpg'
  }`;
  const name = safeName(nameFromDisposition(res.headers.get('content-disposition')) ?? fallback);

  return shareOrSaveFiles([new File([blob], name, { type })], name);
}
