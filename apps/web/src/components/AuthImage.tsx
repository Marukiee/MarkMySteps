import { CSSProperties, useEffect, useRef, useState } from 'react';
import { fetchBlobUrl } from '../api/client';

/**
 * Object-URL cache so re-renders and repeated thumbnails don't refetch.
 *
 * Bounded, because an object URL pins its blob in memory until it is revoked:
 * a trip of two thousand photos used to end the day holding every one of them
 * at once, and the tab it was scrolled in got slower the further you went.
 * Insertion order is the eviction order, and a path that is on screen right
 * now is never thrown away underneath the <img> that is showing it.
 */
const cache = new Map<string, string>();
/** How many mounted images are currently pointing at each path. */
const inUse = new Map<string, number>();
const MAX_CACHED = 300;

function remember(path: string, url: string): void {
  cache.set(path, url);
  prune();
}

/** Move a hit to the back of the queue, so what you keep looking at stays. */
function touch(path: string): void {
  const url = cache.get(path);
  if (url === undefined) return;
  cache.delete(path);
  cache.set(path, url);
}

function prune(): void {
  for (const [path, url] of cache) {
    if (cache.size <= MAX_CACHED) return;
    if ((inUse.get(path) ?? 0) > 0) continue; // on screen — leave it alone
    release(path, url);
  }
}

function release(path: string, url: string): void {
  // Local and on-device photos are addressed directly, not through a blob;
  // there is nothing to revoke and the URL stays valid forever.
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  cache.delete(path);
}

/**
 * Warm the cache for an image that is about to be needed.
 *
 * The viewer uses it on the photos either side of the one on screen, so paging
 * lands on a picture that is already there instead of a placeholder. Failures
 * are ignored: this is a guess about what you will look at next.
 */
export function preloadImage(path: string): void {
  if (cache.has(path)) {
    touch(path);
    return;
  }
  void fetchBlobUrl(path)
    .then((url) => remember(path, url))
    .catch(() => undefined);
}

/** Whichever of the two resolutions is already cached, full size first. */
function bestCached(path: string, lowResPath?: string): string | undefined {
  return cache.get(path) ?? (lowResPath !== undefined ? cache.get(lowResPath) : undefined);
}

/** Drop a cached image so the next render refetches it (e.g. after an avatar
 *  upload replaces the same URL). */
export function evictImage(path: string): void {
  const url = cache.get(path);
  if (url !== undefined) release(path, url);
}

/**
 * <img> that loads through the authorized thumbnail proxy — but only once
 * it scrolls near the viewport (IntersectionObserver), so photo-heavy
 * timelines don't fire hundreds of fetches up front.
 *
 * `lowResPath` is a smaller version of the same picture that some other part of
 * the app has already loaded. If it is in the cache it goes on screen at once
 * and the full-size one replaces it in place when it arrives. That is how the
 * viewer opens on the photo you tapped instead of on a grey rectangle: the grid
 * you tapped it in was holding the small one all along.
 *
 * `eager` skips the visibility check, for somewhere the image is on screen by
 * definition — waiting for an observer callback there is a frame wasted.
 */
export function AuthImage({
  path,
  lowResPath,
  eager = false,
  alt,
  className,
  style,
}: {
  path: string;
  lowResPath?: string;
  eager?: boolean;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [src, setSrc] = useState<string | undefined>(cache.get(path));
  // Visible enough to fetch: told so, or already painting the small version —
  // in that case there is no placeholder left for the observer to watch, and
  // waiting on it would mean the full-size one never gets asked for at all.
  const [visible, setVisible] = useState(() => eager || bestCached(path, lowResPath) !== undefined);
  // Something already in hand is not something to fade in: it is on screen the
  // moment this element is, and the entrance animation over it should show the
  // picture moving, not a blank rectangle counting down. Starting at "not
  // loaded" is what made the viewer look like it had lost its animation.
  const [loaded, setLoaded] = useState(() => bestCached(path, lowResPath) !== undefined);
  const placeholderRef = useRef<HTMLDivElement>(null);
  // Read at render: whatever is cached right now, or nothing.
  const lowRes = lowResPath !== undefined ? cache.get(lowResPath) : undefined;
  const shown = src ?? lowRes;

  // When the path prop changes (e.g. lightbox navigation), swap to the new
  // image instead of keeping the previous one on screen.
  useEffect(() => {
    touch(path);
    setSrc(cache.get(path));
    setVisible(eager || bestCached(path, lowResPath) !== undefined);
    setLoaded(bestCached(path, lowResPath) !== undefined);
  }, [path, lowResPath, eager]);

  // Claim the path while this image is mounted, so the cache never revokes a
  // blob that something is still displaying.
  useEffect(() => {
    inUse.set(path, (inUse.get(path) ?? 0) + 1);
    return () => {
      const next = (inUse.get(path) ?? 1) - 1;
      if (next > 0) inUse.set(path, next);
      else inUse.delete(path);
    };
  }, [path]);

  useEffect(() => {
    if (src || eager || !placeholderRef.current) return;
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
  }, [src, eager]);

  useEffect(() => {
    if (!visible || src) return;
    if (cache.has(path)) {
      touch(path);
      setSrc(cache.get(path));
      return;
    }
    let cancelled = false;
    fetchBlobUrl(path)
      .then((url) => {
        remember(path, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visible, path, src]);

  if (!shown) {
    return (
      <div
        ref={placeholderRef}
        className={`${className ?? ''} img-placeholder`}
        style={style}
        aria-label={alt}
      />
    );
  }
  // Fade the pixels in once decoded, instead of them snapping in from Immich.
  // A cached object URL can already be complete before onLoad ever fires, which
  // would leave the image stuck at opacity 0 — so also flip `loaded` via a ref
  // callback the moment the element is complete.
  //
  // One element for both resolutions: swapping `src` on the SAME <img> is what
  // lets the small one hold the frame while the big one decodes, with no second
  // mount and so no second entrance animation.
  return (
    <img
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
      }}
      src={shown}
      alt={alt}
      className={`${className ?? ''} auth-img ${loaded ? 'loaded' : ''}`}
      style={style}
      loading={eager ? 'eager' : 'lazy'}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  );
}
