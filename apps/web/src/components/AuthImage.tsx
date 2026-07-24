import { CSSProperties, useEffect, useRef, useState } from 'react';
import { fetchBlobUrl } from '../api/client';

// Object-URL cache so re-renders and repeated thumbnails don't refetch.
const cache = new Map<string, string>();

/** Drop a cached image so the next render refetches it (e.g. after an avatar
 *  upload replaces the same URL). */
export function evictImage(path: string): void {
  const url = cache.get(path);
  if (url) URL.revokeObjectURL(url);
  cache.delete(path);
}

/**
 * <img> that loads through the authorized thumbnail proxy — but only once
 * it scrolls near the viewport (IntersectionObserver), so photo-heavy
 * timelines don't fire hundreds of fetches up front.
 */
export function AuthImage({
  path,
  alt,
  className,
  style,
}: {
  path: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [src, setSrc] = useState<string | undefined>(cache.get(path));
  const [visible, setVisible] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);

  // When the path prop changes (e.g. lightbox navigation), swap to the new
  // image instead of keeping the previous one on screen.
  useEffect(() => {
    setSrc(cache.get(path));
  }, [path]);

  useEffect(() => {
    if (src || !placeholderRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' }, // start loading slightly before it scrolls in
    );
    observer.observe(placeholderRef.current);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    if (!visible || src) return;
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
  }, [visible, path, src]);

  if (!src) {
    return (
      <div
        ref={placeholderRef}
        className={`${className ?? ''} img-placeholder`}
        style={style}
        aria-label={alt}
      />
    );
  }
  return <img src={src} alt={alt} className={className} style={style} loading="lazy" />;
}
