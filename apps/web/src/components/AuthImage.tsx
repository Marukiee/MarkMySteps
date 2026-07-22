import { useEffect, useState } from 'react';
import { fetchBlobUrl } from '../api/client';

// Object-URL cache so re-renders and repeated thumbnails don't refetch.
const cache = new Map<string, string>();

/** <img> that loads through the authorized thumbnail proxy. */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | undefined>(cache.get(path));

  useEffect(() => {
    if (cache.has(path)) {
      setSrc(cache.get(path));
      return;
    }
    let cancelled = false;
    fetchBlobUrl(path)
      .then((url) => {
        cache.set(path, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!src) return <div className={`${className ?? ''} img-placeholder`} aria-label={alt} />;
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}
