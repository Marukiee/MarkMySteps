import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { MediaItem, RouteCollection } from '../api/types';
import { trimOutlierEnds } from '../lib/arc';
import { colorForUser, flagEmoji, formatDay } from '../lib/colors';
import { reversePlaceName } from '../lib/geocode';
import { getMapStyle } from '../lib/prefs';
import { Icon, MODE_ICON } from '../components/Icon';
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

const LEG_NAMES = new Set(['Heenreis', 'Terugreis', 'Heenvlucht', 'Terugvlucht']);

const REGION_NAMES = new Intl.DisplayNames(['nl'], { type: 'region' });

/** "Zweden" for SE — reads better next to a city than a flag emoji does. */
function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return REGION_NAMES.of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

interface SharedStop {
  id: string;
  name: string;
  countryCode: string | null;
  travelMode: string | null;
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

/** One chronological stream: stops and photo days in the order they happened. */
type Entry =
  | { kind: 'stop'; key: string; date: string; stop: SharedStop; index: number }
  | { kind: 'leg'; key: string; date: string; stop: SharedStop }
  | { kind: 'day'; key: string; date: string; items: SharedMedia[]; place: string | null; flag: string | null };

function SharedTripView({ slug, token }: { slug: string; token: string }) {
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [stops, setStops] = useState<SharedStop[]>([]);
  const [media, setMedia] = useState<SharedMedia[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // Thumbnails go through plain <img> tags: the token rides along as a query
  // parameter so the browser can lazy-load and cache them itself.
  const thumb = (id: string) =>
    `/api/share/${slug}/media/${id}/thumbnail?t=${encodeURIComponent(token)}`;

  // Stable chronological order — the timeline and the viewer share these indices.
  const orderedMedia = useMemo(
    () => [...media].sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [media],
  );
  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    orderedMedia.forEach((m, i) => map.set(m.id, i));
    return map;
  }, [orderedMedia]);

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

  // Photo markers, clustered per zoom level exactly like the app's map. Placing
  // one marker per photo piles hundreds of DOM nodes (and their shadows) on top
  // of each other, which is both unreadable and slow on a phone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];

      const withGps = orderedMedia.filter((m) => m.latitude !== null && m.longitude !== null);
      const zoom = map.getZoom();
      const cell = 40 / 2 ** zoom; // degrees per cluster cell
      const clusters = new Map<string, SharedMedia[]>();
      for (const item of withGps) {
        const key = `${Math.round(item.latitude! / cell)}:${Math.round(item.longitude! / cell)}`;
        clusters.set(key, [...(clusters.get(key) ?? []), item]);
      }

      for (const items of clusters.values()) {
        const rep = items[0]!;
        const el = document.createElement('div');
        el.className = 'photo-marker';
        el.style.borderColor = colorForUser(rep.userId);
        el.style.backgroundImage = `url(${thumb(rep.id)})`;
        if (items.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'photo-marker-count';
          badge.textContent = items.length > 99 ? '99+' : String(items.length);
          el.appendChild(badge);
        }
        // A single photo opens; a cluster zooms in until it splits.
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (items.length > 1) {
            map.easeTo({
              center: [rep.longitude!, rep.latitude!],
              zoom: Math.min(zoom + 2.5, 16),
            });
          } else {
            setLightboxIndex(indexOf.get(rep.id) ?? 0);
          }
        });
        markersRef.current.push(
          new maplibregl.Marker({ element: el }).setLngLat([rep.longitude!, rep.latitude!]).addTo(map),
        );
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
    map.on('zoomend', draw);
    return () => {
      map.off('zoomend', draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedMedia, indexOf, slug, token]);

  // Stops and photo days woven into one stream, so the photos taken during a
  // stay sit under that stop instead of in a separate list further down.
  const entries = useMemo<Entry[]>(() => {
    const days = new Map<string, SharedMedia[]>();
    for (const item of orderedMedia) {
      const day = item.takenAt.slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), item]);
    }
    // Outbound/return legs are travel, not a destination — they don't get a
    // number, and they don't take one from the stops either.
    let number = 0;
    const stopEntries: Entry[] = stops.map((stop) =>
      LEG_NAMES.has(stop.name)
        ? { kind: 'leg' as const, key: `leg-${stop.id}`, date: stop.arrivalDate.slice(0, 10), stop }
        : {
            kind: 'stop' as const,
            key: `stop-${stop.id}`,
            date: stop.arrivalDate.slice(0, 10),
            stop,
            index: number++,
          },
    );

    // Where a day was spent, same rule as the app's timeline: a day trip is
    // stored with zero nights, so it has to match on its arrival day too, and a
    // day that touches two places names both.
    const placeFor = (date: string) => {
      const onDay = stops.filter((s) => {
        if (LEG_NAMES.has(s.name)) return false;
        const from = s.arrivalDate.slice(0, 10);
        const to = s.departureDate.slice(0, 10);
        return date === from || (date > from && date < to);
      });
      if (onDay.length === 0) return { place: null, flag: null };
      return {
        place: onDay.map((s) => s.name).join(' \u00b7 '),
        flag: onDay[onDay.length - 1]!.countryCode
          ? flagEmoji(onDay[onDay.length - 1]!.countryCode!)
          : null,
      };
    };

    const list: Entry[] = [
      ...stopEntries,
      ...[...days.entries()].map(([date, items]) => ({
        kind: 'day' as const,
        key: `day-${date}`,
        date,
        items,
        ...placeFor(date),
      })),
    ];
    // Within one date: outbound/return legs first, then any planned stop header starting today,
    // then today's photos, then any subsequent stops.
    const byDate = new Map<string, Entry[]>();
    for (const e of list) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    const out: Entry[] = [];
    for (const date of [...byDate.keys()].sort()) {
      const group = byDate.get(date)!;
      const legs = group.filter((e) => e.kind === 'leg');
      const stops = group.filter((e) => e.kind === 'stop');
      const day = group.find((e) => e.kind === 'day');
      out.push(...legs);
      out.push(...stops);
      if (day) out.push(day);
    }
    return out;
  }, [stops, orderedMedia]);

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
          <img
            src={thumb(trip.resolvedCoverId)}
            alt=""
            className="share-headcard-img"
            decoding="async"
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

      <div className="share-map">
        <div ref={mapContainerRef} className="share-map-inner" />
      </div>

      {entries.length > 0 && (
        <section className="share-section">
          <h2 className="share-section-title">Tijdlijn</h2>
          <div className="share-tl">
            {entries.map((entry) =>
              entry.kind === 'leg' ? (
                <section key={entry.key} className="share-tl-leg">
                  <span className="share-tl-marker share-tl-marker-leg" aria-hidden="true">
                    <Icon name={MODE_ICON[entry.stop.travelMode ?? 'CAR'] ?? 'car'} size={14} />
                  </span>
                  <span className="share-tl-leg-pill">
                    {entry.stop.name.startsWith('Heen') ? 'Heenreis' : 'Terugreis'}
                    <small>{stopRange(entry.stop.arrivalDate, entry.stop.departureDate)}</small>
                  </span>
                </section>
              ) : entry.kind === 'stop' ? (
                <section key={entry.key} className="share-tl-stop">
                  <span className="share-tl-marker share-tl-marker-stop">{entry.index + 1}</span>
                  <div className="share-tl-stop-body">
                    <strong>
                      {entry.stop.name}
                      {countryName(entry.stop.countryCode) && (
                        <span className="share-tl-country">
                          , {countryName(entry.stop.countryCode)}
                        </span>
                      )}
                    </strong>
                    <span className="muted">
                      {stopRange(entry.stop.arrivalDate, entry.stop.departureDate)}
                    </span>
                  </div>
                </section>
              ) : (
                <section key={entry.key} className="share-tl-day">
                  <span className="share-tl-marker share-tl-marker-day" aria-hidden="true" />
                  <h3>{formatDay(entry.items[0]!.takenAt)}</h3>
                  {entry.place && (
                    <p className="share-tl-place muted">
                      {entry.flag && <span className="share-tl-place-flag">{entry.flag}</span>}
                      {entry.place}
                    </p>
                  )}
                  <div className="share-grid">
                    {entry.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="share-photo-btn"
                        onClick={() => setLightboxIndex(indexOf.get(item.id) ?? 0)}
                      >
                        <img
                          src={thumb(item.id)}
                          alt=""
                          className="share-photo"
                          loading="lazy"
                          decoding="async"
                          onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '1')}
                          // A cached image is already complete by the time React
                          // attaches onLoad, and would otherwise stay invisible.
                          ref={(el) => {
                            if (el?.complete) el.setAttribute('data-loaded', '1');
                          }}
                        />
                        {item.assetType === 'VIDEO' && (
                          <span className="share-photo-video">
                            <Icon name="play" size={20} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              ),
            )}
          </div>
        </section>
      )}

      <footer className="share-footer">
        Gedeeld met <LogoMark size={18} /> <strong>MarkMySteps</strong>
      </footer>

      {lightboxIndex !== null && orderedMedia[lightboxIndex] && (
        <ShareLightbox
          items={orderedMedia}
          index={lightboxIndex}
          srcFor={thumb}
          onNavigate={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/** Fullscreen photo viewer for the public share page (prev/next, esc, tap-out). */
function ShareLightbox({
  items,
  index,
  srcFor,
  onNavigate,
  onClose,
}: {
  items: SharedMedia[];
  index: number;
  srcFor: (id: string) => string;
  onNavigate: (i: number) => void;
  onClose: () => void;
}) {
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

  // City + country, same as the app's viewer.
  useEffect(() => {
    setPlace(null);
    if (item.latitude == null || item.longitude == null) return;
    let alive = true;
    void reversePlaceName(item.latitude, item.longitude).then((name) => alive && setPlace(name));
    return () => {
      alive = false;
    };
  }, [item.id, item.latitude, item.longitude]);

  // Preload the neighbours so paging through doesn't flash an empty frame.
  useEffect(() => {
    for (const i of [index - 1, index + 1]) {
      const next = items[i];
      if (next) new Image().src = srcFor(next.id);
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
          <img key={item.id} src={srcFor(item.id)} alt="" decoding="async" />
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
