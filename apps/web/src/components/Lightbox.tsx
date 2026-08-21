import { Style, StatusBar } from '@capacitor/status-bar';
import { useEffect, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError, getServerBase } from '../api/client';
import type { ConnectionStatus, MediaItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_IMMICH_PUBLIC_URL } from '../config';
import { formatDay } from '../lib/colors';
import { deviceMediaUri, isDeviceMediaId } from '../lib/deviceMedia';
import { mediaSrc } from '../lib/gallery';
import { reversePlaceName } from '../lib/geocode';
import { isNativeApp, openExternal } from '../lib/native';
import { savePhoto } from '../lib/photoSave';
import { cachedImage, decoded, loadImage, preloadImage } from './AuthImage';
import { Icon, IconName } from './Icon';
import './lightbox.css';

/** How the photo is currently framed: a scale plus a translation in CSS pixels. */
interface View {
  scale: number;
  x: number;
  y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };
const ZOOM_MAX = 6;
/** Where one double-tap lands. Enough to read a sign, not so far you are lost. */
const ZOOM_TAP = 2.5;

const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(1, s));

interface LightboxProps {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** When set (trip owner), shows the "set as cover" action. */
  coverTripId?: string;
  onCoverSet?: () => void;
  /**
   * Where the pixels come from, for viewers that are not the signed-in app.
   *
   * The public share page reaches its photos through a link token rather than
   * a bearer header, so it hands in its own URL builder and the viewer skips
   * the authorized fetch, the Immich deep link and the cover action. Everything
   * else — zoom, pinch, double-tap, paging, the swipe to dismiss — is the same
   * code, because it should be the same viewer.
   */
  srcFor?: (item: MediaItem, size: 'thumbnail' | 'preview' | 'original') => string;
  /** Playback URL for a video, for those same viewers. */
  videoSrcFor?: (item: MediaItem) => string;
}

export function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
  coverTripId,
  onCoverSet,
  srcFor,
  videoSrcFor,
}: LightboxProps) {
  const { user } = useAuth();
  const isPublic = Boolean(srcFor);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [coverSaved, setCoverSaved] = useState(false);
  // A download is the one action here that takes long enough to need saying
  // something about, and it says it over the photo rather than in the menu it
  // was started from — the menu is closed by the time the file arrives.
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Three states, not two: a menu that is only ever mounted or not cannot
  // animate itself away — it was simply gone the moment you tapped past it.
  const [menu, setMenu] = useState<'closed' | 'open' | 'closing'>('closed');
  const menuOpen = menu === 'open';
  const closeMenu = () => setMenu((m) => (m === 'open' ? 'closing' : m));
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // ---- Zoom ------------------------------------------------------------
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  // Off while a finger is down (the photo must track the finger exactly), on
  // for the jumps a double-tap or a released pinch make.
  const [eased, setEased] = useState(false);
  const gesture = useRef({
    mode: 'none' as 'none' | 'swipe' | 'pan' | 'pinch' | 'holdzoom',
    sx: 0,
    sy: 0,
    start: FIT,
    dist: 1,
    // Focal point of the gesture, and the centre of the photo as it would sit
    // unzoomed. Both measured once at touchdown: nothing reflows mid-gesture,
    // and reading the element's box back while it is being transformed gives
    // the box you just moved.
    fx: 0,
    fy: 0,
    cx: 0,
    cy: 0,
    moved: false,
    at: 0,
  });
  const tap = useRef({ at: 0, x: 0, y: 0 });
  /**
   * When a finger last did something.
   *
   * A touchscreen also sends the mouse events it thinks a mouse would have
   * sent, so the double-tap that had just zoomed in was followed by a
   * synthetic dblclick that zoomed straight back out.
   */
  const lastTouch = useRef(0);

  const photoEl = () => wrapRef.current?.querySelector('.lightbox-img') as HTMLElement | null;

  /** Where the photo's centre sits when the given view is applied to it. */
  const originOf = (v: View) => {
    const el = photoEl();
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - v.x, y: r.top + r.height / 2 - v.y };
  };

  /** Keep the photo's edges out of the empty space around it. */
  const clamp = (v: View): View => {
    const el = photoEl();
    const scale = clampScale(v.scale);
    const mx = ((el?.offsetWidth ?? 0) * (scale - 1)) / 2;
    const my = ((el?.offsetHeight ?? 0) * (scale - 1)) / 2;
    return {
      scale,
      x: Math.min(mx, Math.max(-mx, v.x)),
      y: Math.min(my, Math.max(-my, v.y)),
    };
  };

  /**
   * Scale to `scale` while the point under (fx, fy) stays under (fx, fy).
   *
   * A point p on screen is `q * scale + translate` for some point q on the
   * photo; solving for the translate that leaves p where it is gives the line
   * below. Without it, zooming always pulls towards the middle of the photo and
   * whatever you were actually looking at slides off screen.
   */
  const zoomAround = (scale: number, fx: number, fy: number, from: View, origin: { x: number; y: number }) => {
    const px = fx - origin.x;
    const py = fy - origin.y;
    const k = clampScale(scale) / from.scale;
    return clamp({ scale, x: px - (px - from.x) * k, y: py - (py - from.y) * k });
  };

  /** Anything below a hair over 1 falls back to the fitted photo. */
  const settle = (v: View) => {
    if (v.scale <= 1.02) {
      setEased(true);
      setView(FIT);
    } else {
      setView(clamp(v));
    }
  };

  const zoomed = view.scale > 1.02;

  // A new photo arrives fitted; the zoom you left on the previous one is not
  // an opinion about this one.
  useEffect(() => {
    setEased(false);
    setView(FIT);
    closeMenu();
    gesture.current.mode = 'none';
  }, [index]);

  // Off the screen once its exit has played.
  useEffect(() => {
    if (menu !== 'closing') return;
    const timer = window.setTimeout(() => setMenu('closed'), 150);
    return () => window.clearTimeout(timer);
  }, [menu]);

  // Animate out before unmounting; closing used to be an abrupt cut.
  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  };
  const item = items[index];

  // City + country for the photo, when it carries a coordinate. Cached per ~1 km
  // so paging through an album doesn't re-query the geocoder.
  //
  // The name is NOT cleared between photos. Twenty shots taken in one town all
  // resolve to that town, and blanking the line in between made it fade itself
  // back in twenty times over. It changes when the place changes, and only then.
  useEffect(() => {
    const lat = item?.latitude;
    const lon = item?.longitude;
    if (lat == null || lon == null) {
      setPlace(null);
      return;
    }
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
    // A share link has no bearer token to trade for a playback URL; its own
    // proxy is already reachable with the link token it was handed.
    if (videoSrcFor) {
      setVideoUrl(videoSrcFor(item));
      return;
    }
    // A video that never left the phone plays from the phone; there is no
    // playback URL to ask the server for, and asking would only 404.
    if (isDeviceMediaId(item.id)) {
      setVideoUrl(mediaSrc(deviceMediaUri(item.id)));
      return;
    }
    let cancelled = false;
    api<{ url: string }>(`/media/${item.id}/video-url`)
      .then((res) => {
        if (!cancelled) setVideoUrl(`${getServerBase()}${res.url}`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.assetType]);

  async function setAsCover() {
    if (!coverTripId || !item) return;
    await api(`/trips/${coverTripId}`, { method: 'PATCH', body: { coverMediaId: item.id } });
    setCoverSaved(true);
    window.setTimeout(() => setCoverSaved(false), 1600);
    onCoverSet?.();
  }

  async function saveToDevice() {
    if (!item || saving) return;
    setSaving(true);
    setNote('Downloaden…');
    const outcome = await savePhoto(item, srcFor);
    setSaving(false);
    // A share sheet the user waved away is not a failure, and it has already
    // told them what happened — say nothing.
    if (outcome === 'cancelled') setNote(null);
    else if (outcome === 'failed') setNote('Downloaden lukte niet');
    else setNote(outcome === 'shared' ? 'Opgeslagen' : 'Bewaard in je downloads');
  }

  // The note clears itself; a photo you page away from takes it with you.
  useEffect(() => {
    if (!note || saving) return;
    const timer = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(timer);
  }, [note, saving]);

  useEffect(() => {
    setNote(null);
  }, [index]);

  // Public Immich URL → deep link to the asset. Only for own photos;
  // friends' photos live on their server.
  useEffect(() => {
    if (isPublic) return; // nothing to deep-link to, and no session to ask with
    api<ConnectionStatus>('/immich/connection')
      .then((s) => setImmichUrl(s.publicUrl ?? DEFAULT_IMMICH_PUBLIC_URL))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404)
          setImmichUrl(DEFAULT_IMMICH_PUBLIC_URL);
      });
  }, [isPublic]);

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
      // Down and out with its animation, the same as the ✕ and the swipe. A
      // back gesture used to take the photo off the screen in one frame.
      close();
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

  // Fetch the neighbours ahead of time, so paging lands on a photo instead of
  // on a placeholder. One either way: any more and a fast scroll through an
  // album is pulling down photos nobody stopped on.
  useEffect(() => {
    for (const i of [index + 1, index - 1]) {
      const next = items[i];
      if (!next || next.assetType === 'VIDEO') continue;
      if (srcFor) new Image().src = srcFor(next, 'preview');
      else if (!isDeviceMediaId(next.id)) preloadImage(`/media/${next.id}/thumbnail`);
    }
  }, [index, items, srcFor]);

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
  const isOwn = !isPublic && item.userId === user?.id;
  const onDevice = isDeviceMediaId(item.id);

  const actions: { label: string; icon: IconName; run: () => void }[] = [];
  if (coverTripId && !onDevice) {
    actions.push({
      label: coverSaved ? 'Cover ingesteld' : 'Als cover',
      icon: coverSaved ? 'check' : 'camera',
      run: () => void setAsCover(),
    });
  }
  // Every viewer gets this one, the share page included: whoever is looking at
  // the photo may as well be able to keep it. A photo that never left this
  // phone is already in its gallery, so there is nothing to download.
  if (!onDevice) {
    actions.push({
      label: saving ? 'Downloaden…' : item.assetType === 'VIDEO' ? 'Video downloaden' : 'Afbeelding downloaden',
      icon: 'download',
      run: () => void saveToDevice(),
    });
  }
  if (isOwn && immichUrl && !onDevice) {
    actions.push({
      label: 'Openen in Immich',
      icon: 'external',
      run: () => openExternal(`${immichUrl}/photos/${item.immichAssetId}`),
    });
  }

  /**
   * One handler for everything a finger can mean on a photo.
   *
   * Fitted: a drag pages through the album or throws the photo away, exactly as
   * before. Zoomed in, that same drag moves the photo instead, because there is
   * now something to move. On top of that: pinch, double-tap to jump to 2.5x
   * and back, and double-tap-and-hold, where dragging up zooms in and down
   * zooms out without ever lifting your thumb.
   */
  const onTouchStart = (e: ReactTouchEvent) => {
    lastTouch.current = Date.now();
    // Gone the moment a finger lands, rather than when it lifts: a pinch or a
    // drag never becomes a click, so it would otherwise stay open underneath.
    closeMenu();
    setEased(false);
    const g = gesture.current;
    const origin = originOf(view);
    // A video has its own scrubber and play button; zooming it would fight
    // them, so it keeps the paging and dismiss swipes and nothing else.
    const video = item.assetType === 'VIDEO';

    if (!video && e.touches.length >= 2) {
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      g.mode = 'pinch';
      g.start = view;
      g.dist = Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
      g.fx = (a.clientX + b.clientX) / 2;
      g.fy = (a.clientY + b.clientY) / 2;
      g.cx = origin.x;
      g.cy = origin.y;
      g.moved = true;
      return;
    }

    const t = e.touches[0]!;
    const now = Date.now();
    const second =
      now - tap.current.at < 320 &&
      Math.hypot(t.clientX - tap.current.x, t.clientY - tap.current.y) < 44;

    g.mode = video ? 'swipe' : second ? 'holdzoom' : zoomed ? 'pan' : 'swipe';
    g.sx = t.clientX;
    g.sy = t.clientY;
    g.fx = t.clientX;
    g.fy = t.clientY;
    g.cx = origin.x;
    g.cy = origin.y;
    g.start = view;
    g.moved = false;
    g.at = now;
    touchRef.current = { x: t.clientX, y: t.clientY };

    // The second tap acts the moment it lands, not when it lifts. Waiting for
    // the lift meant a thumb that rolled a few pixels while pressing was read
    // as the drag-zoom instead, and the photo crept to some scale nobody asked
    // for rather than snapping back to fitted.
    if (second && !video) {
      setEased(true);
      const next = zoomed ? FIT : zoomAround(ZOOM_TAP, t.clientX, t.clientY, view, origin);
      setView(next);
      // Drag-zoom continues from where the jump landed, so holding on after
      // the second tap still fine-tunes it.
      g.start = next;
      g.cx = origin.x;
      g.cy = origin.y;
      tap.current = { at: 0, x: 0, y: 0 };
    }
  };

  const onTouchMove = (e: ReactTouchEvent) => {
    const g = gesture.current;
    if (g.mode === 'none') return;

    if (g.mode === 'pinch') {
      if (e.touches.length < 2) return;
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      setView(
        zoomAround(clampScale((g.start.scale * dist) / g.dist), g.fx, g.fy, g.start, {
          x: g.cx,
          y: g.cy,
        }),
      );
      return;
    }

    const t = e.touches[0]!;
    const dx = t.clientX - g.sx;
    const dy = t.clientY - g.sy;
    // A double-tap-and-hold has to travel further before it counts as a drag:
    // the same 8px that means "you are panning" is well within the wobble of
    // pressing twice in one spot.
    const threshold = g.mode === 'holdzoom' ? 24 : 8;
    if (!g.moved && Math.hypot(dx, dy) > threshold) g.moved = true;

    if (g.mode === 'holdzoom') {
      if (!g.moved) return;
      // 260px of travel doubles or halves it, and it is exponential so the same
      // distance does the same thing whether you are at 1x or at 4x.
      const scale = clampScale(g.start.scale * Math.exp(-dy / 260));
      setView(zoomAround(scale, g.fx, g.fy, g.start, { x: g.cx, y: g.cy }));
      return;
    }

    if (g.mode === 'pan') {
      setView(clamp({ scale: g.start.scale, x: g.start.x + dx, y: g.start.y + dy }));
    }
  };

  const onTouchEnd = (e: ReactTouchEvent) => {
    lastTouch.current = Date.now();
    const g = gesture.current;
    const t = e.changedTouches[0]!;
    const now = Date.now();

    if (g.mode === 'pinch') {
      // Only once the last finger is up: lifting one of two mid-pinch should
      // not snap the photo back.
      if (e.touches.length === 0) {
        settle(view);
        g.mode = 'none';
      }
      return;
    }

    if (g.mode === 'holdzoom') {
      // The jump itself happened when the finger landed; this only tidies up
      // after whatever dragging followed it.
      settle(view);
      // Consumed, so a third tap starts a fresh pair rather than toggling again.
      tap.current = { at: 0, x: 0, y: 0 };
      g.mode = 'none';
      return;
    }

    if (!g.moved && now - g.at < 320) tap.current = { at: now, x: t.clientX, y: t.clientY };

    if (g.mode === 'pan') {
      settle(view);
      g.mode = 'none';
      return;
    }

    // Fitted: the old paging and dismiss gestures, untouched.
    const s = touchRef.current;
    g.mode = 'none';
    if (!s) return;
    touchRef.current = null;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0 && index > 0) onNavigate(index - 1);
      else if (dx < 0 && index < items.length - 1) onNavigate(index + 1);
    } else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      close(); // swipe down to dismiss
    }
  };

  /** Mouse: double-click toggles, the wheel zooms, and a drag pans once zoomed. */
  const onDoubleClick = (e: ReactMouseEvent) => {
    if (item.assetType === 'VIDEO') return;
    // The touch handlers have already answered this one.
    if (Date.now() - lastTouch.current < 900) return;
    e.stopPropagation();
    setEased(true);
    setView(zoomed ? FIT : zoomAround(ZOOM_TAP, e.clientX, e.clientY, view, originOf(view)));
  };

  const onWheel = (e: ReactWheelEvent) => {
    if (item.assetType === 'VIDEO') return;
    setEased(false);
    setView(
      zoomAround(clampScale(view.scale * Math.exp(-e.deltaY / 400)), e.clientX, e.clientY, view, originOf(view)),
    );
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    if (!zoomed || e.button !== 0) return;
    e.preventDefault();
    setEased(false);
    const start = view;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: MouseEvent) =>
      setView(clamp({ scale: start.scale, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy }));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Portal to <body> so it sits above the fixed tab bar and any page stacking
  // context (the trip detail is itself position:fixed on mobile).
  return createPortal(
    <div
      className={`lightbox ${closing ? 'closing' : ''}`}
      // With the menu open, a tap outside it means "never mind" — not "close
      // the photo I was about to act on".
      onClick={() => (menuOpen ? closeMenu() : close())}
      role="dialog"
      aria-modal="true"
    >
      <div className="lightbox-date">
        {formatDay(item.takenAt)}
        {/* Keyed on the name: the same place keeps the same element and stays
            put, a different one is a new element and fades in. */}
        {place && (
          <span key={place} className="lightbox-place">
            {place}
          </span>
        )}
      </div>

      {note && (
        <div className="lightbox-note" role="status">
          {note}
        </div>
      )}

      {/* A photo the server has never seen cannot be its cover, and there is
          nothing in Immich to open — with neither, there is no menu. */}
      {actions.length > 0 && (
        <div className="lightbox-menu" onClick={(e) => e.stopPropagation()}>
          <button
            className="lightbox-menu-btn"
            aria-label="Meer"
            aria-expanded={menuOpen}
            onClick={() => setMenu((m) => (m === 'open' ? 'closing' : 'open'))}
          >
            <Icon name="dots" size={20} />
          </button>
          {menu !== 'closed' && (
            <div
              className={`lightbox-menu-list ${menu === 'closing' ? 'closing' : ''}`}
              role="menu"
            >
              {actions.map((action) => (
                <button
                  key={action.label}
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    action.run();
                  }}
                >
                  <Icon name={action.icon} size={16} />
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button className="lightbox-close" aria-label="Sluiten" onClick={close}>
        <Icon name="close" size={22} />
      </button>

      {/* The stage swallows clicks so tapping the photo does not dismiss the
          viewer, which also kept them from reaching the menu. Touching the
          picture is still "never mind" as far as the menu is concerned. */}
      <figure
        className="lightbox-stage"
        onClick={(e) => {
          e.stopPropagation();
          closeMenu();
        }}
      >
        <div
          className={`lightbox-imgwrap ${zoomed ? 'zoomed' : ''}`}
          ref={wrapRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
        >
          {/* The zoom lives on a wrapper rather than on the photo itself: the
              photo already runs an arrival animation, and a running animation
              outranks an inline transform, so for a third of a second the two
              would be arguing over the same property. */}
          <div
            className="lightbox-zoom"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: eased ? 'transform 0.26s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
            }}
          >
            {item.assetType === 'VIDEO' && videoUrl ? (
              <video className="lightbox-img" src={videoUrl} controls autoPlay playsInline />
            ) : (
              <LightboxPhoto
                id={item.id}
                // What the grid you tapped in already has in hand: a cached blob
                // in the app, a URL the browser has cached on a share link.
                lowSrc={
                  srcFor
                    ? srcFor(item, 'thumbnail')
                    : cachedImage(`/media/${item.id}/thumbnail?size=thumbnail`)
                }
                // A video that has not resolved its playback URL yet shows its
                // still, not a preview render of a file that isn't an image.
                loadFull={
                  srcFor
                    ? () =>
                        Promise.resolve(
                          srcFor(item, item.assetType === 'VIDEO' ? 'thumbnail' : 'preview'),
                        )
                    : () => loadImage(`/media/${item.id}/thumbnail`)
                }
                className="lightbox-img"
              />
            )}
          </div>
          {item.assetType === 'VIDEO' && !videoUrl && (
            <p className="lightbox-videohint">Video laden…</p>
          )}
          {/* Arrows sit at the vertical centre of the image, not the screen.
              Zoomed in they are in the way of the part you zoomed in on, and
              the drag that would reach them is a pan now. */}
          {index > 0 && !zoomed && (
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
          {index < items.length - 1 && !zoomed && (
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
        {/* Nothing but the counter down here now. The two action buttons used
            to live on this line, which is as wide as the photo above it and
            therefore a different width for every photo — they walked around
            the screen as you paged, and on a tall photo they sat inside the
            frame's own drop shadow. They are in the menu at the top instead,
            which is in the same place whatever you are looking at. */}
        <figcaption className="lightbox-bar">
          <span className="lightbox-count">
            {index + 1} / {items.length}
          </span>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

/**
 * The photo in the viewer, and the reason paging through does not blink.
 *
 * Nothing is put on screen until the browser has actually decoded it. Handing
 * a fresh <img> a URL — even one whose bytes are already cached — leaves it
 * blank for a frame or two while the bitmap is made, and the entrance
 * animation was playing out over exactly that nothing.
 *
 * So the photo on screen stays where it is until its replacement is ready, and
 * only then does it swap, which is also when the animation runs: the element
 * is keyed on the photo, so a new photo is a new element and animates, while
 * the small version quietly becoming the big one is the same element with a
 * different `src` and does not.
 */
function LightboxPhoto({
  id,
  lowSrc,
  loadFull,
  className,
}: {
  id: string;
  lowSrc?: string;
  loadFull: () => Promise<string>;
  className?: string;
}) {
  const [frame, setFrame] = useState<{ id: string; src: string } | null>(null);

  useEffect(() => {
    let alive = true;
    let arrived = false;
    // Whatever is already in hand goes up first, once it can be painted — but
    // never over the full-size one, which on a photo that was preloaded can
    // easily be ready first.
    if (lowSrc) {
      void decoded(lowSrc).then((url) => {
        if (alive && !arrived) setFrame({ id, src: url });
      });
    }
    void loadFull()
      .then(decoded)
      .then((url) => {
        if (!alive) return;
        arrived = true;
        setFrame({ id, src: url });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // loadFull is rebuilt every render; the photo it points at is `id`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lowSrc]);

  // Nothing at all yet: the previous photo is gone and this one has not landed.
  if (!frame) return <div className={`${className ?? ''} img-placeholder`} aria-hidden="true" />;
  // Keyed on the photo, not the source: a new photo is a new element and plays
  // the entrance, the small one growing into the big one is not.
  return <img key={frame.id} src={frame.src} alt="" className={className} decoding="sync" />;
}
