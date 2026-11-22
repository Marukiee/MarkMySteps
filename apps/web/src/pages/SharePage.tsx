import { FormEvent, lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { MediaItem, PhotoComment, RouteCollection } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import { formatDay } from '../lib/colors';
import { FastScroll } from '../components/FastScroll';
import { useExit } from '../lib/useExit';
import { Icon } from '../components/Icon';
import { DayNote, TripNote } from '../components/DayNote';
import {
  CommentFlag,
  DayComments,
  groupComments,
  type PhotoCommentsAdapter,
} from '../components/PhotoComments';
import { reactorKey, ReactionBadge, type ReactionsView, useReactions } from '../components/PhotoReactions';
import { LogoMark } from '../components/Logo';
import { PasswordInput } from '../components/PasswordInput';
import { PhotoGrid } from '../components/PhotoGrid';
import { GRID_ZOOM_PREVIEW, useGridZoom } from '../lib/gridZoom';
import { jumpToDay, StopJump } from '../components/StopJump';
import { TripFacts } from '../components/TripFacts';
import { WeatherBadge } from '../components/WeatherBadge';
import { countTravellers, resolveFacts } from '../lib/tripFacts';
import '../components/timeline.css'; // the shared timeline IS the app's timeline
// Photo markers on the map, and the viewer's loading placeholders.
import '../components/tripmap.css';
import './share-page.css';
import { Flag } from '../components/Flag';
import { t } from '../i18n';
import { tr } from '../i18n/rich';

/*
 * The two heavy parts of this page arrive when they are needed. The map engine
 * alone is several times the size of everything else a guest downloads, and
 * the viewer is only wanted once somebody taps a photo. The page reserves the
 * map's box at its final size, so the map drawing in moves nothing.
 */
const ShareMap = lazy(() => import('../components/ShareMap'));
const loadLightbox = () => import('../components/Lightbox');
const Lightbox = lazy(() => loadLightbox().then((m) => ({ default: m.Lightbox })));

interface SharedTrip {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  /** `role` is missing from servers before guests were left out of the count. */
  members: { userId: string; role?: string; user: { displayName: string } }[];
  resolvedCoverId: string | null;
  stats: {
    distanceKm: number;
    countries: string[];
    days: number;
    photoCount: number;
    stops: number;
  };
}

const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

/**
 * A stop, exactly as the app knows one.
 *
 * The shared page draws the plan with the app's own code, and that code wants
 * a whole stop (its travel mode, its airports, whether it is a day trip), not
 * the handful of fields the timeline happens to need.
 */
type SharedStop = PlannedStop;

type SharedMedia = Omit<MediaItem, 'immichAssetId'>;

/** What the screen in front of the trip is saying. */
type GateState = 'loading' | 'password' | 'gone' | 'failed';

/** A refusal that means the link itself is over, not that something hiccupped. */
class LinkGone extends Error {}

/** Session storage can be switched off; a link then simply asks again. */
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* the token lives for this page only */
  }
}

/** Read-only public trip view behind an unguessable slug (+ optional password). */
export function SharePage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const storageKey = `mms.share.${slug}`;
  const [token, setToken] = useState<string | null>(() => readSession(storageKey));
  const [gate, setGate] = useState<GateState>('loading');
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  /** Bumped by the retry button to run the whole opening again. */
  const [attempt, setAttempt] = useState(0);

  /** Swaps the slug (and the password, when it has one) for a session token. */
  const unlock = useCallback(
    async (withPassword?: string): Promise<void> => {
      const res = await fetch(`/api/share/${slug}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(withPassword ? { password: withPassword } : {}),
      });
      if (res.status === 404) throw new LinkGone();
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { token: string };
      writeSession(storageKey, data.token);
      setToken(data.token);
    },
    [slug, storageKey],
  );

  useEffect(() => {
    if (!slug || token) return;
    let cancelled = false;
    setGate('loading');
    fetch(`/api/share/${slug}/info`)
      .then(async (res) => {
        // Only a link the server does not know is "gone". A server that is
        // down, or a phone that lost its signal, is not a dead link.
        if (res.status === 404) throw new LinkGone();
        if (!res.ok) throw new Error(String(res.status));
        const info = (await res.json()) as { title: string; hasPassword: boolean };
        if (cancelled) return;
        setTitle(info.title);
        if (info.hasPassword) setGate('password');
        else await unlock();
      })
      .catch((err: unknown) => {
        if (!cancelled) setGate(err instanceof LinkGone ? 'gone' : 'failed');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, token, attempt, unlock]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setPasswordError(null);
    try {
      const res = await fetch(`/api/share/${slug}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setPasswordError(t('share.page.wrongPassword'));
        return;
      }
      if (res.status === 404) {
        setGate('gone');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { token: string };
      writeSession(storageKey, data.token);
      setToken(data.token);
    } catch {
      setPasswordError(t('share.page.openFailed'));
    } finally {
      setBusy(false);
    }
  }

  // The link was withdrawn, or its password changed, while this tab still
  // held a session for it: forget the session and ask the server again, which
  // shows the password form or says the link is gone.
  const expire = useCallback(() => {
    writeSession(storageKey, null);
    setToken(null);
  }, [storageKey]);

  if (token) return <SharedTripView key={token} slug={slug} token={token} onExpired={expire} />;

  if (gate === 'gone' || gate === 'failed') {
    return (
      <ShareGate title={gate === 'gone' ? t('share.page.notWorking') : t('share.page.openFailed')}>
        <p className="share-gate-text">
          {gate === 'gone' ? t('share.page.goneHint') : t('share.page.failedHint')}
        </p>
        {gate === 'failed' && (
          <button type="button" className="btn btn-ghost" onClick={() => setAttempt((n) => n + 1)}>
            {t('common.retry')}
          </button>
        )}
      </ShareGate>
    );
  }

  if (gate === 'password') {
    return (
      <ShareGate title={title || t('share.page.sharedTrip')}>
        <form className="card share-gate-card" onSubmit={submit}>
          {/* A wrong password takes the place of the line above the field.
              Both lines share one cell, so the card is as tall as the longer
              of the two from the start and never changes height under the
              thumb. */}
          <div className="share-gate-lead">
            <p className="share-gate-text" aria-hidden={passwordError ? true : undefined}>
              {t('share.page.protected')}
            </p>
            <p className="share-gate-text share-gate-error" role="alert">
              {passwordError ?? ''}
            </p>
          </div>
          <div className="field">
            <label htmlFor="sp-pw">{t('share.link.password')}</label>
            <PasswordInput
              id="sp-pw"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" disabled={busy || password.length === 0} aria-busy={busy}>
            {t('share.page.view')}
          </button>
        </form>
      </ShareGate>
    );
  }

  return <ShareGate loading />;
}

/**
 * The quiet screen in front of the trip: the brand, and a title or a line.
 *
 * The same screen covers the trip while it loads, so going from "checking the
 * link" to "loading the trip" changes nothing on screen; it only fades away
 * once the whole page is there to be seen.
 */
function ShareGate({
  title,
  loading = false,
  cover = false,
  closing = false,
  children,
}: {
  title?: string;
  loading?: boolean;
  cover?: boolean;
  closing?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`share-gate ${cover ? 'is-cover' : ''} ${closing ? 'closing' : ''}`}
      aria-busy={loading || undefined}
    >
      <div className="share-gate-inner">
        <span className="share-gate-brand">
          <LogoMark size={38} />
          MarkMySteps
        </span>
        {title && <h1>{title}</h1>}
        {loading && <p className="share-gate-loading">{t('common.loading')}</p>}
        {children}
      </div>
    </div>
  );
}

/** One entry per day with photos: the same shape the app's timeline uses. */
interface DayEntry {
  date: string;
  items: SharedMedia[];
  place: string | null;
  flag: string | null;
  lat: number | null;
  lon: number | null;
}

/** "vrijdag 1 mei" becomes "Vrijdag 1 mei": a capital for the day, not for the month. */
function capitalFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

function SharedTripView({
  slug,
  token,
  onExpired,
}: {
  slug: string;
  token: string;
  onExpired: () => void;
}) {
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [stops, setStops] = useState<SharedStop[]>([]);
  const [media, setMedia] = useState<SharedMedia[]>([]);
  const [notes, setNotes] = useState<TripNote[]>([]);
  const [routes, setRoutes] = useState<RouteCollection | null>(null);
  /** How many of the five parts the page is built from have answered. */
  const [settled, setSettled] = useState(0);
  const [failed, setFailed] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [backTopShown, backTopLeaving] = useExit(!atTop, 200);
  const [fresh, setFresh] = useState<{ count: number; day: string } | null>(null);
  const [freshOpen, setFreshOpen] = useState(false);
  const [freshShown, freshClosing] = useExit(freshOpen, 220);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  /** Opened from a photo's comment flag: straight onto the conversation. */
  const [lightboxComments, setLightboxComments] = useState(false);
  const [comments, setComments] = useState<PhotoComment[]>([]);

  /*
   * Nothing of the trip is shown until its parts are in: the cover, the map
   * and the days all change the height of what is above them, and showing them
   * one by one as they land made the page jump three times on a phone. The
   * screen that checked the link stays up meanwhile, and fades off it.
   */
  const ready = trip !== null && settled >= 5;
  const [coverShown, coverClosing] = useExit(!ready, 240);

  // Thumbnails go through plain <img> tags: the token rides along as a query
  // parameter so the browser can lazy-load and cache them itself.
  //
  // The grid asks for the small rendition. It used to take the ~1440px preview
  // of every photo and paint it into a 100px box, which is why a trip with a
  // few hundred pictures took an age to settle and stuttered while it did.
  const thumb = useCallback(
    (id: string, size: 'thumbnail' | 'preview' | 'original' = 'thumbnail') =>
      `/api/share/${slug}/media/${id}/thumbnail?size=${size}&t=${encodeURIComponent(token)}`,
    [slug, token],
  );
  // Pinched in far enough, the small rendition is a blur at the size it is shown.
  const gridSize = useGridZoom() >= GRID_ZOOM_PREVIEW ? 'preview' : 'thumbnail';
  const videoSrc = useCallback(
    (id: string) => `/api/share/${slug}/media/${id}/video?t=${encodeURIComponent(token)}`,
    [slug, token],
  );

  // Stable chronological order: the timeline and the viewer share these indices.
  const orderedMedia = useMemo(
    () => [...media].sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [media],
  );
  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    orderedMedia.forEach((m, i) => map.set(m.id, i));
    return map;
  }, [orderedMedia]);

  // The viewer is the app's, and it takes app media. A share link deliberately
  // never learns the Immich asset ids behind the photos, and it has no use for
  // them either: the field is there to be shaped like a MediaItem.
  const lightboxItems = useMemo<MediaItem[]>(
    () => orderedMedia.map((m) => ({ ...m, immichAssetId: '' })),
    [orderedMedia],
  );

  const grouped = useMemo(() => groupComments(comments), [comments]);

  // Likes need no account: this browser's own random key is who a visitor is.
  const [reactor] = useState(reactorKey);
  const putReaction = useCallback(
    async (target: string, kind: string | null) => {
      // A comment is `c:<id>`, anything else is a photo.
      const path = target.startsWith('c:') ? `comments/${target.slice(2)}` : `media/${target}`;
      const res = await fetch(`/api/share/${slug}/${path}/reaction`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-share-token': token, 'x-reactor': reactor },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) throw new Error(String(res.status));
    },
    [slug, token, reactor],
  );
  const reactions = useReactions(
    () =>
      fetch(`/api/share/${slug}/reactions`, {
        headers: { 'x-share-token': token, 'x-reactor': reactor },
      }).then((res) =>
        res.ok ? (res.json() as Promise<ReactionsView>) : Promise.reject(new Error(String(res.status))),
      ),
    putReaction,
  );

  // Visitors have no account: they comment under the name they type.
  const commentsAdapter = useMemo<PhotoCommentsAdapter>(
    () => ({
      list: grouped.list,
      askName: true,
      reactions,
      post: async (target, body, name) => {
        const path = 'mediaId' in target ? `media/${target.mediaId}` : `days/${target.day}`;
        const res = await fetch(`/api/share/${slug}/${path}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-share-token': token },
          body: JSON.stringify({ name, body }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const added = (await res.json()) as PhotoComment;
        setComments((list) => [...list, added]);
      },
    }),
    [grouped, slug, token, reactions],
  );

  const openPhoto = useCallback(
    (id: string, withComments = false) => {
      setLightboxComments(withComments);
      setLightboxIndex(indexOf.get(id) ?? 0);
    },
    [indexOf],
  );

  useEffect(() => {
    let cancelled = false;
    const get = <T,>(path: string): Promise<T> =>
      fetch(`/api/share/${slug}/${path}`, { headers: { 'x-share-token': token } }).then((res) => {
        if (res.status === 401 || res.status === 404) throw new LinkGone();
        return res.ok ? (res.json() as Promise<T>) : Promise.reject(new Error(String(res.status)));
      });
    const part = <T,>(path: string, apply: (value: T) => void) =>
      get<T>(path)
        .then((value) => !cancelled && apply(value))
        .catch(() => undefined)
        .finally(() => !cancelled && setSettled((n) => n + 1));

    get<SharedTrip>('trip')
      .then((value) => {
        if (cancelled) return;
        // The cover is the largest thing on the page and the first thing seen.
        // Asked for now, it is on its way while the rest of the trip loads.
        if (value.resolvedCoverId) {
          const img = new Image();
          img.fetchPriority = 'high';
          img.src = thumb(value.resolvedCoverId, 'preview');
        }
        setTrip(value);
        setSettled((n) => n + 1);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof LinkGone) onExpired();
        else setFailed(true);
      });
    void part<SharedStop[]>('stops', setStops);
    void part<SharedMedia[]>('media', setMedia);
    void part<TripNote[]>('notes', setNotes);
    void part<RouteCollection>('route', setRoutes);
    // Not waited for: these only add a count to a photo or a line under a day.
    get<PhotoComment[]>('comments')
      .then((value) => !cancelled && setComments(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, token, thumb, onExpired]);

  // The viewer's code, fetched while the guest is still looking at the page,
  // so the first photo they tap opens as quickly as the next one.
  useEffect(() => {
    if (!ready) return;
    const warm = () => void loadLightbox();
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = globalThis.setTimeout(warm, 1500);
    return () => globalThis.clearTimeout(handle);
  }, [ready]);

  /**
   * Far enough down the page that going back to the top is a journey.
   *
   * The body is the scroller here (`overflow-x: hidden` on it computes its
   * overflow-y to `auto`), so its scroll is what to listen to: the window
   * never hears it.
   */
  useEffect(() => {
    const read = () => setAtTop(scrollTopOf() < 600);
    read();
    window.addEventListener('scroll', read, { passive: true });
    document.body.addEventListener('scroll', read, { passive: true });
    return () => {
      window.removeEventListener('scroll', read);
      document.body.removeEventListener('scroll', read);
    };
  }, []);

  /**
   * "There are new photos since you last looked."
   *
   * A share link is a page people come back to, and the thing they come back
   * for is what has been added. What they saw last time is remembered in their
   * own browser (nothing about a visit is sent anywhere) and anything taken
   * later than that is new.
   */
  useEffect(() => {
    if (!ready || orderedMedia.length === 0) return;
    const latest = orderedMedia[orderedMedia.length - 1]!.takenAt;
    const seenKey = `mms.share.seen.${slug}`;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(seenKey);
    } catch {
      /* a browser with storage switched off simply never says "new" */
    }
    const remember = () => {
      try {
        localStorage.setItem(seenKey, latest);
      } catch {
        /* nothing to do: the banner shows again next time */
      }
    };
    if (!seen) {
      // First visit: everything is new, which is not news.
      remember();
      return;
    }
    const added = orderedMedia.filter((m) => m.takenAt > seen!);
    remember();
    if (added.length === 0) return;
    setFresh({ count: added.length, day: added[0]!.takenAt.slice(0, 10) });
    setFreshOpen(true);
  }, [ready, orderedMedia, slug]);

  // One section per day, exactly like the app's timeline: the date, the places
  // that day touched (day trips included), the weather, then the photos.
  const entries = useMemo<DayEntry[]>(() => {
    const days = new Map<string, SharedMedia[]>();
    for (const item of orderedMedia) {
      const day = item.takenAt.slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), item]);
    }
    // A day with only a story and no photos still gets its section, as in the app.
    for (const note of notes) {
      if (!days.has(note.day)) days.set(note.day, []);
    }

    // Every place that day covers, in itinerary order. A day trip is stored
    // with zero nights (arrival === departure), so it has to be matched on its
    // arrival day as well.
    const placeFor = (date: string) => {
      const onDay = stops.filter((s) => {
        if (LEG_NAMES.has(s.name)) return false;
        const from = s.arrivalDate.slice(0, 10);
        const to = s.departureDate.slice(0, 10);
        return date === from || (date > from && date < to);
      });
      const located = onDay.filter((s) => s.latitude !== null && s.longitude !== null);
      const last = located[located.length - 1];
      return {
        place: onDay.length > 0 ? onDay.map((s) => s.name).join(' · ') : null,
        flag: last?.countryCode ?? null,
        lat: last?.latitude ?? null,
        lon: last?.longitude ?? null,
      };
    };

    return [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items, ...placeFor(date) }));
  }, [stops, orderedMedia, notes]);

  const notesByDay = useMemo(() => {
    const map = new Map<string, TripNote[]>();
    for (const note of notes) map.set(note.day, [...(map.get(note.day) ?? []), note]);
    return map;
  }, [notes]);

  const placeByDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) if (entry.place) map.set(entry.date, entry.place);
    return map;
  }, [entries]);

  // Kept as one array: the chips measure themselves whenever they are handed a
  // new one, and a fresh array on every render had them re-measuring on every
  // scroll that moved the back-to-top button.
  const facts = useMemo(
    () =>
      trip
        ? resolveFacts(
            {
              distanceKm: trip.stats.distanceKm,
              days: trip.stats.days,
              stops: trip.stats.stops,
              photoCount: trip.stats.photoCount,
              travellers: countTravellers(trip.members),
              countries: trip.stats.countries.length,
            },
            null,
          )
        : [],
    [trip],
  );

  /** A map is only worth its space when there is something on it to frame. */
  const hasMap = useMemo(
    () =>
      stops.some((s) => s.latitude !== null && s.longitude !== null) ||
      orderedMedia.some((m) => m.latitude !== null && m.longitude !== null) ||
      (routes?.features ?? []).some((f) => f.geometry.coordinates.length > 0),
    [stops, orderedMedia, routes],
  );

  const mapPhotos = orderedMedia;
  const openFromMap = useCallback((id: string) => openPhoto(id), [openPhoto]);
  const markerThumb = useCallback((id: string) => thumb(id), [thumb]);

  if (failed) {
    return (
      <ShareGate title={t('share.page.openFailed')}>
        <p className="share-gate-text">{t('share.page.failedHint')}</p>
        <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
          {t('common.retry')}
        </button>
      </ShareGate>
    );
  }

  return (
    <>
      {ready && trip && (
        <div className="share-view">
          <header className="share-topbar">
            <span className="share-brand">
              <LogoMark size={26} />
              MarkMySteps
            </span>
          </header>

          {/* Same header card as the app: cover, title, dates and the trip's facts. */}
          <div className={`share-headcard ${trip.resolvedCoverId ? 'has-cover' : ''}`}>
            {trip.resolvedCoverId && (
              <img
                // The cover fills the top of the page, so this one wants the big
                // rendition; everything else on the page takes the small one.
                src={thumb(trip.resolvedCoverId, 'preview')}
                alt=""
                className="share-headcard-img"
                decoding="async"
                fetchPriority="high"
                onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '1')}
                ref={(el) => {
                  if (el?.complete) el.setAttribute('data-loaded', '1');
                }}
              />
            )}
            <div className="share-headcard-body">
              <h1>{trip.title}</h1>
              <p className="share-headcard-dates">
                {t('common.dateRange', { from: formatDay(trip.startDate), to: formatDay(trip.endDate) })}
              </p>
              <TripFacts facts={facts} />
            </div>
          </div>

          {trip.description && <p className="share-description">{trip.description}</p>}

          {hasMap && (
            <div className="share-map">
              <Suspense fallback={null}>
                <ShareMap
                  stops={stops}
                  routes={routes}
                  photos={mapPhotos}
                  thumbFor={markerThumb}
                  onOpenPhoto={openFromMap}
                />
              </Suspense>
            </div>
          )}

          {entries.length === 0 ? (
            <p className="share-empty">
              <Icon name="camera" size={17} />
              {t('share.page.noPhotos')}
            </p>
          ) : (
            <section className="share-section">
              <h2 className="share-section-title">{t('trip.tab.timeline')}</h2>
              {/* Straight to a city, the same row of pills the app's timeline has. */}
              <StopJump
                stops={stops}
                days={entries.map((entry) => entry.date)}
                media={orderedMedia}
                renderThumb={(id, onMissing) => (
                  <img src={thumb(id)} alt="" loading="lazy" decoding="async" onError={onMissing} />
                )}
              />
              {/* Same markup and classes as the app's timeline, so the shared
                  page reads identically: one row per day with its places and
                  weather. */}
              <div className="timeline">
                {entries.map((entry) => (
                  // The day and its place are written onto the section so the
                  // fast-scroll grip can say where the page is.
                  <section
                    key={entry.date}
                    className="timeline-day"
                    data-day={entry.date}
                    data-place={entry.place ?? undefined}
                  >
                    <h3>
                      <span className="timeline-dot" />
                      <span className="timeline-day-label">
                        <span className="timeline-day-top">
                          {capitalFirst(formatDay(entry.items[0]?.takenAt ?? entry.date))}
                        </span>
                        {(entry.place || entry.lat !== null) && (
                          <span className="timeline-day-meta">
                            {entry.place && (
                              <span className="timeline-place">
                                <Flag code={entry.flag} size={15} /> {entry.place}
                              </span>
                            )}
                            {entry.lat !== null && entry.lon !== null && (
                              <WeatherBadge lat={entry.lat} lon={entry.lon} day={entry.date} />
                            )}
                          </span>
                        )}
                      </span>
                    </h3>
                    {notesByDay.has(entry.date) && (
                      <>
                        <DayNote day={entry.date} notes={notesByDay.get(entry.date)!} canEdit={false} />
                        <DayComments day={entry.date} adapter={commentsAdapter} />
                      </>
                    )}
                    {/* Justified rows, same as the app: each photo keeps its own
                        shape instead of being cropped into a square. */}
                    <PhotoGrid items={entry.items} className="timeline-grid">
                      {(item) => (
                        <figure
                          className="timeline-photo"
                          // Named so a jump from the places rail can land on this
                          // photo rather than on the top of the day it is in.
                          data-media-id={item.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openPhoto(item.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openPhoto(item.id);
                            }
                          }}
                        >
                          <img
                            src={thumb(item.id, gridSize)}
                            alt=""
                            className="timeline-img"
                            loading="lazy"
                            decoding="async"
                            // The shapes are already known, so the browser can
                            // size and decode without waiting for the header bytes.
                            width={item.width ?? undefined}
                            height={item.height ?? undefined}
                            onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '1')}
                            // A cached image is already complete by the time React
                            // attaches onLoad, and would otherwise stay invisible.
                            ref={(el) => {
                              if (el?.complete) el.setAttribute('data-loaded', '1');
                            }}
                          />
                          {item.assetType === 'VIDEO' && (
                            <span className="timeline-video">
                              <Icon name="play" size={22} />
                            </span>
                          )}
                          {/* Top right, side by side: liked, and talked about. */}
                          <span className="photo-flags">
                            <ReactionBadge summary={reactions.summary(item.id)} />
                            <CommentFlag
                              count={grouped.byMedia.get(item.id)?.length ?? 0}
                              onOpen={() => openPhoto(item.id, true)}
                            />
                          </span>
                        </figure>
                      )}
                    </PhotoGrid>
                  </section>
                ))}
              </div>
            </section>
          )}

          <footer className="share-footer">
            {tr('share.page.sharedWith', {
              brand: () => (
                <>
                  <LogoMark size={18} /> <strong>MarkMySteps</strong>
                </>
              ),
            })}
          </footer>
        </div>
      )}

      {/* The same grip the app has: a trip of three months is a very long page
          to flick through, and this one scrolls the document itself. Outside
          the page's box, whose entrance would otherwise carry it along. */}
      {ready && <FastScroll />}

      {/* Straight back to the top. Nothing is pinned across the top of this
          page, so unlike the app's it can sit at the very top of the screen. */}
      {ready && backTopShown && (
        <button
          type="button"
          className={`share-backtop ${backTopLeaving ? 'leaving' : ''}`}
          aria-label={t('trip.backToTop')}
          onClick={scrollPageToTop}
        >
          <Icon name="chevron-up" size={17} />
        </button>
      )}

      {/* What you came back for. */}
      {freshShown && fresh && (
        <div className={`share-fresh ${freshClosing ? 'closing' : ''}`} role="status">
          <span className="share-fresh-text">{t('share.page.fresh', { count: fresh.count })}</span>
          <button
            type="button"
            className="btn btn-primary share-fresh-go"
            onClick={() => {
              jumpToDay(fresh.day);
              setFreshOpen(false);
            }}
          >
            {t('share.page.view')}
          </button>
          <button
            type="button"
            className="share-fresh-close"
            aria-label={t('common.close')}
            onClick={() => setFreshOpen(false)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {/* The app's viewer, not a second one that merely looked like it: the
          same pinch, double-tap and drag zoom, the same paging and the same
          swipe to dismiss. It only gets told where the pixels live. */}
      {lightboxIndex !== null && lightboxItems[lightboxIndex] && (
        <Suspense fallback={null}>
          <Lightbox
            items={lightboxItems}
            index={lightboxIndex}
            srcFor={(item, size) => thumb(item.id, size)}
            videoSrcFor={(item) => videoSrc(item.id)}
            onNavigate={setLightboxIndex}
            onClose={() => setLightboxIndex(null)}
            comments={commentsAdapter}
            startWithComments={lightboxComments}
            reactions={reactions}
            // The day's own places, for a photo whose coordinate the map cannot
            // put a name to.
            placeFallbackFor={(item) => placeByDay.get(item.takenAt.slice(0, 10)) ?? null}
          />
        </Suspense>
      )}

      {coverShown && <ShareGate loading cover closing={coverClosing} />}
    </>
  );
}

/** How far down the page we are, whichever box the browser is scrolling. */
function scrollTopOf(): number {
  return Math.max(document.body.scrollTop, document.scrollingElement?.scrollTop ?? 0);
}

/** And back to the start of it. */
function scrollPageToTop(): void {
  window.dispatchEvent(new Event('mms:fastscroll-hide'));
  document.body.scrollTo({ top: 0, behavior: 'smooth' });
  document.scrollingElement?.scrollTo({ top: 0, behavior: 'smooth' });
}
