import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { MediaItem, RouteCollection } from '../api/types';
import { colorForUser, flagEmoji, formatDay } from '../lib/colors';
import './share-page.css';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

interface SharedTrip {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  members: { userId: string; user: { displayName: string } }[];
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
        <h1>MarkMySteps</h1>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="share-gate">
        <h1>{title || 'Gedeelde reis'}</h1>
        {needsPassword ? (
          <form className="card share-gate-card" onSubmit={unlock}>
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
            <button className="btn btn-primary">Bekijken</button>
          </form>
        ) : (
          <p className="muted">Laden…</p>
        )}
      </div>
    );
  }

  return <SharedTripView slug={slug!} token={token} />;
}

function SharedTripView({ slug, token }: { slug: string; token: string }) {
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [stops, setStops] = useState<SharedStop[]>([]);
  const [media, setMedia] = useState<SharedMedia[]>([]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

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
      style: MAP_STYLE,
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
          map.addSource(id, { type: 'geojson', data: feature });
          map.addLayer({
            id,
            type: 'line',
            source: id,
            paint: { 'line-color': colorForUser(feature.properties.userId), 'line-width': 3.5 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
          for (const c of feature.geometry.coordinates) bounds.extend(c);
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

  const days = new Map<string, SharedMedia[]>();
  for (const item of media) {
    const day = item.takenAt.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), item]);
  }

  return (
    <div className="share-view">
      <header className="share-head">
        <span className="share-brand">MarkMySteps</span>
        <h1>{trip?.title}</h1>
        {trip && (
          <p className="muted">
            {trip.members.map((m) => m.user.displayName).join(' · ')}
          </p>
        )}
      </header>

      <div className="share-map card">
        <div ref={mapContainerRef} className="share-map-inner" />
      </div>

      {stops.length > 0 && (
        <ol className="share-stops">
          {stops.map((stop, i) => (
            <li key={stop.id} className="card">
              <span className="stop-number">{i + 1}</span>
              <span>
                {flagEmoji(stop.countryCode)} <strong>{stop.name}</strong>
              </span>
              <span className="muted">
                {formatDay(stop.arrivalDate)}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="share-days">
        {[...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => (
          <section key={day}>
            <h3>{formatDay(items[0]!.takenAt)}</h3>
            <div className="share-grid">
              {items.map((item) => (
                <ShareImage key={item.id} slug={slug} token={token} mediaId={item.id} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ShareImage({ slug, token, mediaId }: { slug: string; token: string; mediaId: string }) {
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

  if (!src) return <div className="img-placeholder share-photo" />;
  return <img src={src} alt="" className="share-photo" loading="lazy" />;
}
