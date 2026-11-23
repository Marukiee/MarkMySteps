import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { cachedImage, loadImage, retainImage } from './AuthImage';
import './smartimage.css';

/** A picture that arrives within this long after it was asked for just appears. */
const QUICK_MS = 250;

/** A path through the app's image proxy, or an address an <img> can load as it is. */
const isDirect = (src: string) => /^(https?:|blob:|data:)/.test(src);

function cachedFor(src: string): string | undefined {
  return isDirect(src) ? undefined : cachedImage(src);
}

/**
 * A photo as the native apps load it.
 *
 * - Already in hand (cached), or there within 250 ms: on screen at once, no
 *   fade. A fade over a picture that was already there only reads as a blink.
 * - Slower than that: it fades in over its own tile.
 * - A candidate that fails (deleted, a size the server cannot make) moves on
 *   to the next one instead of leaving a flickering empty tile.
 *
 * `candidates` are tried in order: proxy paths (`/media/<id>/thumbnail...`)
 * or plain URLs (the share page hands those in).
 */
export function SmartImage({
  candidates,
  className,
  style,
  alt = '',
  eager = false,
  draggable,
  onLoad,
}: {
  candidates: string[];
  className?: string;
  style?: CSSProperties;
  alt?: string;
  eager?: boolean;
  draggable?: boolean;
  onLoad?: () => void;
}) {
  const list = candidates.filter(Boolean);
  const listKey = list.join('|');
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;
  const firstCached = () => {
    for (const c of list) {
      const hit = cachedFor(c);
      if (hit) return hit;
    }
    return undefined;
  };
  const [src, setSrc] = useState<string | undefined>(firstCached);
  // Instant: cached, or quick enough that a fade would only be a blink.
  const [instant, setInstant] = useState(() => src !== undefined);
  const [loaded, setLoaded] = useState(() => src !== undefined);
  const [near, setNear] = useState(eager || src !== undefined);
  const [failedAll, setFailedAll] = useState(false);
  const holderRef = useRef<HTMLSpanElement>(null);
  const indexRef = useRef(0);
  /** Set once the candidates have started loading, so a failure never starts over. */
  const startedRef = useRef(false);
  const startRef = useRef(performance.now());

  // A new photo (paging, another trip): start over with what is cached for it.
  useEffect(() => {
    const hit = firstCached();
    indexRef.current = 0;
    startedRef.current = false;
    startRef.current = performance.now();
    setSrc(hit);
    setInstant(hit !== undefined);
    setLoaded(hit !== undefined);
    setFailedAll(false);
    setNear((n) => n || eager || hit !== undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  // Hold on to every candidate while shown, so the cache never drops one
  // that is on screen.
  useEffect(() => {
    const releases = list.filter((c) => !isDirect(c)).map((c) => retainImage(c));
    return () => releases.forEach((r) => r());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  useEffect(() => {
    if (near || !holderRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '150% 50%' },
    );
    observer.observe(holderRef.current);
    return () => observer.disconnect();
  }, [near]);

  const tryFrom = (index: number) => {
    const candidate = list[index];
    if (candidate === undefined) {
      setSrc(undefined);
      setFailedAll(true);
      return;
    }
    indexRef.current = index;
    const key = listKeyRef.current;
    const done = (url: string) => {
      if (key !== listKeyRef.current) return;
      if (performance.now() - startRef.current <= QUICK_MS) setInstant(true);
      setSrc(url);
    };
    if (isDirect(candidate)) done(candidate);
    else
      loadImage(candidate)
        .then(done)
        .catch(() => {
          if (key === listKeyRef.current) tryFrom(index + 1);
        });
  };

  useEffect(() => {
    if (!near || src !== undefined || list.length === 0 || startedRef.current) return;
    startedRef.current = true;
    startRef.current = performance.now();
    tryFrom(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, src, listKey]);

  return (
    <span
      ref={holderRef}
      className={`smart-img ${className ?? ''} ${failedAll ? 'missing' : ''}`}
      style={style}
    >
      {src && (
        <img
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0 && !loaded) {
              if (performance.now() - startRef.current <= QUICK_MS) setInstant(true);
              setLoaded(true);
            }
          }}
          src={src}
          alt={alt}
          draggable={draggable}
          decoding="async"
          className={`${loaded ? 'loaded' : ''} ${instant ? 'instant' : ''}`}
          onLoad={() => {
            if (performance.now() - startRef.current <= QUICK_MS) setInstant(true);
            setLoaded(true);
            onLoad?.();
          }}
          onError={() => {
            // This one cannot be drawn: on to the next candidate.
            setLoaded(false);
            const next = indexRef.current + 1;
            if (next >= list.length) {
              setSrc(undefined);
              setFailedAll(true);
            } else tryFrom(next);
          }}
        />
      )}
    </span>
  );
}
