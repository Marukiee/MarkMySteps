import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FormEvent, useEffect, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { MediaItem, RouteCollection } from '../api/types';
import { trimOutlierEnds } from '../lib/arc';
import { colorForUser, flagEmoji, formatDay } from '../lib/colors';
import { reversePlaceName } from '../lib/geocode';
import { getMapStyle } from '../lib/prefs';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { TripFacts } from '../components/TripFacts';
import { resolveFacts } from '../lib/tripFacts';
import '../components/tripmap.css'; // photo markers on the shared map
import './share-page.css';

interface SharedTrip {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  members: { userId: string; user: { displayName: string } }[];
  resolvedCoverId: string | null;
  stats: {
    distanceKm: number;
    countries: string[];
    days: number;
    photoCount: number;
    stops: number;
  };
}

interface SharedStop {
  id: string;
  name: string;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  arrivalDate: string;
  departureDate: string;
}

type SharedMedia = Omit<MediaItem, 'immichAssetId'>;

/** Compact stay range, e.g. "20 – 23 aug" (or a single day). */
function stopRange(arrival: string, departure: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  const a = arrival.slice(0, 10);
  const d = departure.slice(0, 10);
  return a === d ? fmt(arrival) : `${fmt(arrival)} – ${fmt(departure)}`;
}

/** Read-only public trip view behind an unguessable slug (+ optional password). */
export function SharePage() {
  const { slug } = useParams<{ slug: string }>();
  const [needsPassword, setNeedsPassword] = useState(false);
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(sessionStorage.getItem(`mms.share.${slug}`));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || token) return;
    fetch(`/api/share/${slug}/info`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Link bestaat niet meer'))))
      .then((info: { title: string; hasPassword: boolean }) => {
        setTitle(info.title);
        if (info.hasPassword) setNeedsPassword(true);
        else void unlock();
      })
      .catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function unlock(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    const res = await fetch(`/api/share/${slug}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(password ? { password } : {}),
    });
    if (!res.ok) {
      setError(res.status === 401 ? 'Verkeerd wachtwoord' : 'Kon link niet openen');
      return;
    }
    const data = (await res.json()) as { token: string };
    sessionStorage.setItem(`mms.share.${slug}`, data.token);
    setToken(data.token);
  }

  if (error && !token) {
    return (
      <div className="share-gate">
        <div className="share-gate-inner">
          <span className="share-gate-brand">
            <LogoMark size={38} />
            MarkMySteps
          </span>
          <h1>Deze link werkt niet meer</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="share-gate">
        <div className="share-gate-inner">
          <span className="share-gate-brand">
            <LogoMark size={38} />
            MarkMySteps
          </span>
          <h1>{title || 'Gedeelde reis'}</h1>
          {needsPassword ? (
            <form className="card share-gate-card" onSubmit={unlock}>
              <p className="muted">Deze reis is beveiligd met een wachtwoord.</p>
              <div className="field">
                <label htmlFor="sp-pw">Wachtwoord</label>
                <input
                  id="sp-pw"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn btn-primary">Bekijken</button>
            </form>
          ) : (
            <p className="muted share-gate-loading">Laden…</p>
          )}
        </div>
      </div>
    );
  }

  return <SharedTripView slug={slug!} token={token} />;
}

function SharedTripView({ slug, token }: { slug: string; token: string }) {
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [stops, setStops] = useState<SharedStop[]>([]);
  const [media, setMedia] = useState<SharedMedia[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const photoMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Media in a stable, chronological order — used for both the timeline grid
  // and the lightbox so indices line up.
  const orderedMedia = [...media].sort((a, b) => a.takenAt.localeCompare(b.takenAt));

  useEffect(() => {
    const get = <T,>(path: string): Promise<T> =>
      fetch(`/api/share/${slug}/${path}`, { headers: { 'x-share-token': token } }).then((res) =>
        res.ok ? (res.json() as Promise<T>) : Promise.reject(new Error(String(res.status))),
      );
    get<SharedTrip>('trip').then(setTrip).catch(() => undefined);
    get<SharedStop[]>('stops').then(setStops).catch(() => undefined);
    get<SharedMedia[]>('media').then(setMedia).catch(() => undefined);

    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getMapStyle(),
      center: [4.9, 52.37],
      zoom: 3,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    void get<RouteCollection>('route').then((routes) => {
      const drawRoutes = () => {
        const bounds = new LngLatBounds();
        for (const feature of routes.features) {
          const id = `share-route-${feature.properties.userId}`;
          // Trim stray home snaps so the line doesn't run from home to the trip.
          const coords = trimOutlierEnds(feature.geometry.coordinates as [number, number][]);
          const trimmed = { ...feature, geometry: { ...feature.geometry, coordinates: coords } };
          map.addSource(id, { type: 'geojson', data: trimmed });
          map.addLayer({
            id,
            type: 'line',
            source: id,
            paint: { 'line-color': colorForUser(feature.properties.userId), 'line-width': 3.5 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
          for (const c of coords) bounds.extend(c);
        }
        if (routes.features.length > 0) {
          map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 800 });
        }
      };
      if (map.isStyleLoaded()) drawRoutes();
      else map.once('load', drawRoutes);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [slug, token]);

  // Photo markers on the map — a small thumbnail dot per GPS-tagged photo that
  // opens the lightbox, mirroring the main app.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of photoMarkersRef.current) m.remove();
    photoMarkersRef.current = [];
    const place = () => {
      orderedMedia.forEach((item, idx) => {
        if (item.latitude === null || item.longitude === null) return;
        const el = document.createElement('div');
        el.className = 'photo-marker';
        el.style.borderColor = colorForUser(item.userId);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setLightboxIndex(idx);
        });
        fetch(`/api/share/${slug}/media/${item.id}/thumbnail`, {
          headers: { 'x-share-token': token },
        })
          .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
          .then((blob) => {
            el.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
          })
          .catch(() => el.classList.add('photo-marker-error'));
        photoMarkersRef.current.push(
          new maplibregl.Marker({ element: el })
            .setLngLat([item.longitude, item.latitude])
            .addTo(map),
        );
      });
    };
    if (map.isStyleLoaded()) place();
    else map.once('load', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, slug, token]);

  const days = new Map<string, SharedMedia[]>();
  for (const item of media) {
    const day = item.takenAt.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), item]);
  }

  return (
    <div className="share-view">
      <header className="share-topbar">
        <span className="share-brand">
          <LogoMark size={26} />
          MarkMySteps
        </span>
      </header>

      {/* Same header card as the app: cover, title, dates and the trip's facts. */}
      <div className={`share-headcard ${trip?.resolvedCoverId ? 'has-cover' : ''}`}>
        {trip?.resolvedCoverId && (
          <ShareImage
            slug={slug}
            token={token}
            mediaId={trip.resolvedCoverId}
            className="share-headcard-img"
          />
        )}
        <div className="share-headcard-body">
          <h1>{trip?.title ?? ' '}</h1>
          {trip && (
            <p className="share-headcard-dates">
              {formatDay(trip.startDate)} – {formatDay(trip.endDate)}
            </p>
          )}
          <TripFacts
            facts={
              !trip
                ? []
                : resolveFacts(
                    {
                      distanceKm: trip.stats.distanceKm,
                      days: trip.stats.days,
                      stops: trip.stats.stops,
                      photoCount: trip.stats.photoCount,
                      travellers: trip.members.length,
                      countries: trip.stats.countries.length,
                    },
                    null,
                  )
            }
          />
        </div>
      </div>

      {trip?.description && <p className="share-description">{trip.description}</p>}

      <div className="share-map card">
        <div ref={mapContainerRef} className="share-map-inner" />
      </div>

      {stops.length > 0 && (
        <section className="share-section">
          <h2 className="share-section-title">Route</h2>
          <ol className="share-stops">
            {stops.map((stop, i) => (
              <li key={stop.id} style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
                <button
                  className="share-stop"
                  onClick={() =>
                    document
                      .getElementById(`day-${stop.arrivalDate.slice(0, 10)}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                >
                  <span className="share-stop-rail" aria-hidden="true">
                    <span className="share-stop-dot">{i + 1}</span>
                  </span>
                  <span className="share-stop-body">
                    <strong>
                      {stop.countryCode && (
                        <span className="share-stop-flag">{flagEmoji(stop.countryCode)}</span>
                      )}
                      {stop.name}
                    </strong>
                    <span className="muted">
                      {stopRange(stop.arrivalDate, stop.departureDate)}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={16} className="share-stop-go" />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="share-section">
        <h2 className="share-section-title">Tijdlijn</h2>
        <div className="share-days">
          {[...days.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, items]) => (
              <section key={day} id={`day-${day}`} className="share-day">
                <h3>
                  <span className="share-day-dot" />
                  {formatDay(items[0]!.takenAt)}
                </h3>
                <div className="share-grid">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="share-photo-btn"
                      onClick={() =>
                        setLightboxIndex(orderedMedia.findIndex((m) => m.id === item.id))
                      }
                    >
                      <ShareImage
                        slug={slug}
                        token={token}
                        mediaId={item.id}
                        className="share-photo"
                      />
                    </button>
                  ))}
                </div>
              </section>
            ))}
        </div>
      </section>

      <footer className="share-footer">
        Gedeeld met <LogoMark size={18} /> <strong>MarkMySteps</strong>
      </footer>

      {lightboxIndex !== null && orderedMedia[lightboxIndex] && (
        <ShareLightbox
          slug={slug}
          token={token}
          items={orderedMedia}
          index={lightboxIndex}
          onNavigate={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/** Fullscreen photo viewer for the public share page (prev/next, esc, tap-out). */
function ShareLightbox({
  slug,
  token,
  items,
  index,
  onNavigate,
  onClose,
}: {
  slug: string;
  token: string;
  items: SharedMedia[];
  index: number;
  onNavigate: (i: number) => void;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [place, setPlace] = useState<string | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const item = items[index]!;

  // Animate out before unmounting, so closing isn't an abrupt cut.
  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  };

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

  useEffect(() => {
    let cancelled = false;
    setSrc(undefined);
    fetch(`/api/share/${slug}/media/${item.id}/thumbnail`, {
      headers: { 'x-share-token': token },
    })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!cancelled) setSrc(URL.createObjectURL(blob));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, token, item.id]);

  // City + country, same as the app's viewer.
  useEffect(() => {
    setPlace(null);
    if (item.latitude == null || item.longitude == null) return;
    let alive = true;
    void reversePlaceName(item.latitude, item.longitude).then(
      (name) => alive && setPlace(name),
    );
    return () => {
      alive = false;
    };
  }, [item.id, item.latitude, item.longitude]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length, onNavigate]);

  return (
    <div className={`share-lightbox ${closing ? 'closing' : ''}`} onClick={close}>
      <button className="share-lightbox-close" aria-label="Sluiten" onClick={close}>
        <Icon name="close" size={22} />
      </button>

      <figure
        className="share-lightbox-fig"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* The frame sizes to the image, so a portrait after a landscape eases
            between shapes instead of snapping. */}
        <div className="share-lightbox-imgwrap">
          {src ? (
            <img key={item.id} src={src} alt="" />
          ) : (
            <div className="share-lightbox-loading" />
          )}
          {index > 0 && (
            <button
              className="share-lightbox-nav share-lightbox-prev"
              aria-label="Vorige"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(index - 1);
              }}
            >
              <Icon name="chevron-left" size={26} />
            </button>
          )}
          {index < items.length - 1 && (
            <button
              className="share-lightbox-nav share-lightbox-next"
              aria-label="Volgende"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(index + 1);
              }}
            >
              <Icon name="chevron-right" size={26} />
            </button>
          )}
        </div>

        <figcaption className="share-lightbox-caption">
          <span className="share-lightbox-date">{formatDay(item.takenAt)}</span>
          {place && <span className="share-lightbox-place">{place}</span>}
          <span className="share-lightbox-count">
            {index + 1} / {items.length}
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

function ShareImage({
  slug,
  token,
  mediaId,
  className,
}: {
  slug: string;
  token: string;
  mediaId: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/share/${slug}/media/${mediaId}/thumbnail`, {
      headers: { 'x-share-token': token },
    })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!cancelled) setSrc(URL.createObjectURL(blob));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, token, mediaId]);

  // Placeholder keeps the slot's size, so nothing reflows as photos arrive.
  return (
    <img
      src={src}
      alt=""
      className={`${className ?? ''} ${src ? 'is-loaded' : 'is-loading'}`}
      loading="lazy"
    />
  );
}
