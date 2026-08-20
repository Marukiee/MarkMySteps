import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativeApp } from './native';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/**
 * Hands files to whatever the device shares or saves with.
 *
 * Three different places have wanted this now (a poster, a track file, a photo
 * book) and each one has the same three problems: a WebView has no working
 * blob download, a desktop browser may have no share sheet, and a share the
 * user waved away is not a failure.
 */
export async function shareOrSaveFiles(files: File[], title: string): Promise<ShareOutcome> {
  if (files.length === 0) return 'failed';

  try {
    // In the app, straight to Android's own share sheet. It wants files on
    // disk rather than blobs, so each one is written to the cache first.
    if (isNativeApp()) {
      const uris: string[] = [];
      for (const file of files) {
        const written = await Filesystem.writeFile({
          path: file.name,
          data: await toBase64(file),
          directory: Directory.Cache,
        });
        uris.push(written.uri);
      }
      await Share.share({ title, files: uris });
      return 'shared';
    }

    if (navigator.canShare?.({ files }) && navigator.share) {
      await navigator.share({ files, title });
      return 'shared';
    }

    for (const file of files) {
      const href = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = href;
      link.download = file.name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
    }
    return 'downloaded';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

/** Filesystem.writeFile speaks base64, not blobs. */
export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('kon het bestand niet lezen'));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
