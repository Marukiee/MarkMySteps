import { Style, StatusBar } from '@capacitor/status-bar';
import { useEffect, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError, getServerBase } from '../api/client';
import type { ConnectionStatus, MediaItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_IMMICH_PUBLIC_URL } from '../config';
import { formatDay } from '../lib/colors';
import { reversePlaceName } from '../lib/geocode';
import { isNativeApp, openExternal } from '../lib/native';
import { AuthImage } from './AuthImage';
import { Icon } from './Icon';
import './lightbox.css';

interface LightboxProps {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** When set (trip owner), shows the "set as cover" action. */
  coverTripId?: string;
  onCoverSet?: () => void;
}

export function Lightbox({ items, index, onClose, onNavigate, coverTripId, onCoverSet }: LightboxProps) {
  const { user } = useAuth();
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [coverSaved, setCoverSaved] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // Animate out before unmounting; closing used to be an abrupt cut.
  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  };
  const item = items[index];

  // City + country for the photo, when it carries a coordinate. Cached per ~1 km
  // so paging through an album doesn't re-query the geocoder.
  useEffect(() => {
    setPlace(null);
    const lat = item?.latitude;
    const lon = item?.longitude;
    if (lat == null || lon == null) return;
    let alive = true;
    void reversePlaceName(lat, lon).then((name) => alive && setPlace(name));
    return () => {
      alive = false;
    };
  }, [item?.id, item?.latitude, item?.longitude]);

  // Fetch a short-lived playback URL when a video is shown.
  useEffect(() => {
    setVideoUrl(null);
    if (item?.assetType !== 'VIDEO') return;
    let cancelled = false;
    api<{ url: string }>(`/media/${item.id}/video-url`)
      .then((res) => {
        if (!cancelled) setVideoUrl(`${getServerBase()}${res.url}`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.assetType]);

  async function setAsCover() {
    if (!coverTripId || !item) return;
    await api(`/trips/${coverTripId}`, { method: 'PATCH', body: { coverMediaId: item.id } });
    setCoverSaved(true);
    window.setTimeout(() => setCoverSaved(false), 1600);
    onCoverSet?.();
  }

  // Public Immich URL → deep link to the asset. Only for own photos;
  // friends' photos live on their server.
  useEffect(() => {
    api<ConnectionStatus>('/immich/connection')
      .then((s) => setImmichUrl(s.publicUrl ?? DEFAULT_IMMICH_PUBLIC_URL))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404)
          setImmichUrl(DEFAULT_IMMICH_PUBLIC_URL);
      });
  }, []);

  // The lightbox is a dark overlay — flip the native status bar to light icons
  // so the clock/battery stay legible, then restore on close.
  useEffect(() => {
    if (!isNativeApp()) return;
    void StatusBar.setStyle({ style: Style.Dark });
    return () =>
      void StatusBar.setStyle({
        style: document.documentElement.dataset.theme === 'dark' ? Style.Dark : Style.Light,
      });
  }, []);

  // A back gesture should close the photo, not walk out of the trip.
  useEffect(() => {
    window.history.pushState({ mmsLightbox: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) window.history.back();
    };
    // Mounted once per lightbox session; navigating between photos must not
    // push another entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onNavigate]);

  if (!item) return null;
  const isOwn = item.userId === user?.id;

  // Swipe left/right to page through photos on touch devices.
  const onTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0]!;
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const s = touchRef.current;
    if (!s) return;
    touchRef.current = null;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0 && index > 0) onNavigate(index - 1);
      else if (dx < 0 && index < items.length - 1) onNavigate(index + 1);
    } else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      close(); // swipe down to dismiss
    }
  };

  // Portal to <body> so it sits above the fixed tab bar and any page stacking
  // context (the trip detail is itself position:fixed on mobile).
  return createPortal(
    <div
      className={`lightbox ${closing ? 'closing' : ''}`}
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      <div className="lightbox-date">
        {formatDay(item.takenAt)}
        {place && <span className="lightbox-place">{place}</span>}
      </div>

      <button className="lightbox-close" aria-label="Sluiten" onClick={close}>
        <Icon name="close" size={22} />
      </button>

      <figure
        className="lightbox-stage"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="lightbox-imgwrap">
          {item.assetType === 'VIDEO' && videoUrl ? (
            <video className="lightbox-img" src={videoUrl} controls autoPlay playsInline />
          ) : (
            <AuthImage
              key={item.id}
              path={`/media/${item.id}/thumbnail`}
              alt=""
              className="lightbox-img"
            />
          )}
          {item.assetType === 'VIDEO' && !videoUrl && (
            <p className="lightbox-videohint">Video laden…</p>
          )}
          {/* Arrows sit at the vertical centre of the image, not the screen. */}
          {index > 0 && (
            <button
              className="lightbox-nav lightbox-prev"
              aria-label="Vorige"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(index - 1);
              }}
            >
              <Icon name="chevron-left" size={30} />
            </button>
          )}
          {index < items.length - 1 && (
            <button
              className="lightbox-nav lightbox-next"
              aria-label="Volgende"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(index + 1);
              }}
            >
              <Icon name="chevron-right" size={30} />
            </button>
          )}
        </div>
        <figcaption className="lightbox-bar">
          <span className="lightbox-count">
            {index + 1} / {items.length}
          </span>
          {coverTripId && (
            <button className="btn btn-ghost lightbox-cover" onClick={() => void setAsCover()}>
              {coverSaved ? (
                <>
                  <Icon name="check" size={15} /> Cover ingesteld
                </>
              ) : (
                'Als cover'
              )}
            </button>
          )}
          {isOwn && immichUrl && (
            <button
              className="btn btn-primary lightbox-immich"
              onClick={() => openExternal(`${immichUrl}/photos/${item.immichAssetId}`)}
            >
              Openen in Immich <Icon name="external" size={15} />
            </button>
          )}
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}
