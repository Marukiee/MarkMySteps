import { useEffect, useState } from 'react';
import { loadImage } from '../components/AuthImage';

/**
 * The tone of a trip's cover photo, for the fact tiles under it.
 *
 * As the native trip page: the figures are tinted with the colour of the
 * picture above them, so they read as part of the cover and still stand off
 * the page. Worked out once per cover and kept in this browser, so the tiles
 * open in their own colour instead of turning from grey a moment later.
 */

const KEY = 'mms.coverTone.';

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(KEY + key);
  } catch {
    return null;
  }
}

function remember(key: string, tone: string): void {
  try {
    localStorage.setItem(KEY + key, tone);
  } catch {
    // Private window or full storage: the tone is simply worked out again.
  }
}

/** The average of the picture, pulled a little towards its most colourful part. */
function sample(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 12;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i]!;
          const pg = data[i + 1]!;
          const pb = data[i + 2]!;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          // Colourful pixels count more than grey sky or black shadow.
          const w = 1 + ((max - min) / 255) * 3;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          weight += w;
        }
        if (weight === 0) return resolve(null);
        const hex = (v: number) => Math.round(v / weight).toString(16).padStart(2, '0');
        resolve(`#${hex(r)}${hex(g)}${hex(b)}`);
      } catch {
        // A picture from another origin without permission taints the canvas.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * The cover's tone, or null while it is not known (and for a trip without a
 * cover photo, where the caller uses the trip's own colour).
 */
export function useCoverTone(coverId: string | null | undefined): string | null {
  const [tone, setTone] = useState<string | null>(() => (coverId ? remembered(coverId) : null));
  useEffect(() => {
    if (!coverId) {
      setTone(null);
      return;
    }
    const known = remembered(coverId);
    setTone(known);
    if (known) return;
    let cancelled = false;
    loadImage(`/media/${coverId}/thumbnail?size=thumbnail`)
      .then(sample)
      .then((found) => {
        if (cancelled || !found) return;
        remember(coverId, found);
        setTone(found);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [coverId]);
  return tone;
}
