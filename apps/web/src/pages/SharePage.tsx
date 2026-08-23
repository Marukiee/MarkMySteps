import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { MediaItem, RouteCollection } from '../api/types';
import { buildLegs, flightArc, haversineKm, trimOutlierEnds, type TravelMode } from '../lib/arc';
import { colorForUser, formatDay } from '../lib/colors';
import { getMapStyle } from '../lib/prefs';
import { FastScroll } from '../components/FastScroll';
import { Icon } from '../components/Icon';
import { Lightbox } from '../components/Lightbox';
import { LogoMark } from '../components/Logo';
import { PhotoGrid } from '../components/PhotoGrid';
import { StopJump } from '../components/StopJump';
import { TripFacts } from '../components/TripFacts';
import { WeatherBadge } from '../components/WeatherBadge';
import { resolveFacts } from '../lib/tripFacts';
import '../components/timeline.css'; // the shared timeline IS the app's timeline
import '../components/tripmap.css'; // photo markers on the shared map
import './share-page.css';
import { Flag } from '../components/Flag';

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

interface SharedStop {
  id: string;
  name: string;
  countryCode: string | null;
  travelMode: TravelMode | null;
  latitude: number | null;
  longitude: number | null;
  arrivalDate: string;
  departureDate: string;
  /** The rest of what a leg is drawn from — a flight's airports, day trips. */
  fromAirport: string | null;
  toAirport: string | null;
  viaAirports: string[];
  parentStopId: string | null;
  hideLeg: boolean;
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

/** One entry per day with photos — the same shape the app's timeline uses. */
interface DayEntry {
  date: string;
  items: SharedMedia[];
  place: string | null;
  flag: string | null;
  lat: number | null;
  lon: number | null;
}

function SharedTripView({ slug, token }: { slug: string; token: string }) {
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [stops, setStops] = useState<SharedStop[]>([]);
  const [media, setMedia] = useState<SharedMedia[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Keyed by cluster cell so a redraw can keep the markers that did not move.
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

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
  const videoSrc = useCallback(
    (id: string) => `/api/share/${slug}/media/${id}/video?t=${encodeURIComponent(token)}`,
    [slug, token],
  );

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

  // The viewer is the app's, and it takes app media. A share link deliberately
  // never learns the Immich asset ids behind the photos, and it has no use for
  // them either: the field is there to be shaped like a MediaItem.
  const lightboxItems = useMemo<MediaItem[]>(
    () => orderedMedia.map((m) => ({ ...m, immichAssetId: '' })),
    [orderedMedia],
  );

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

    void Promise.all([get<RouteCollection>('route'), get<SharedStop[]>('stops')]).then(
      ([routes, tripStops]) => {
        const drawRoutes = () => drawTrackedRoute(map, routes, tripStops);
        if (map.isStyleLoaded()) drawRoutes();
        else map.once('load', drawRoutes);
      },
    );

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [slug, token]);

  // Photo markers, clustered per zoom level exactly like the app's map. Placing
  // one marker per photo piles hundreds of DOM nodes (and their shadows) on top
  // of each other, which is both unreadable and slow on a phone.
  //
  // Markers are kept between redraws and keyed by their cluster cell. Rebuilding
  // the whole set on every zoom meant every visible thumbnail was requested
  // again, mid-gesture, which is what made panning and zooming stutter.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const live = markersRef.current;
    // A fresh set of photos invalidates every cell: drop what is there rather
    // than leaving a marker showing a picture that is no longer its cluster's.
    for (const marker of live.values()) marker.remove();
    live.clear();

    const draw = () => {
      const withGps = orderedMedia.filter((m) => m.latitude !== null && m.longitude !== null);
      // The LEVEL is rounded, so the grid only changes on a real step of zoom.
      const level = Math.round(map.getZoom());
      const cell = 40 / 2 ** level;

      // Only what is on screen, plus a screen's worth of margin so a pan does
      // not arrive at empty map. Zoomed into one city, this is the difference
      // between forty markers and two thousand.
      const view = map.getBounds();
      const padLng = (view.getEast() - view.getWest()) / 2;
      const padLat = (view.getNorth() - view.getSouth()) / 2;
      const inView = (lat: number, lon: number) =>
        lon >= view.getWest() - padLng &&
        lon <= view.getEast() + padLng &&
        lat >= view.getSouth() - padLat &&
        lat <= view.getNorth() + padLat;

      const clusters = new Map<string, SharedMedia[]>();
      for (const item of withGps) {
        if (!inView(item.latitude!, item.longitude!)) continue;
        const key = `${Math.round(item.latitude! / cell)}:${Math.round(item.longitude! / cell)}`;
        const list = clusters.get(key) ?? [];
        list.push(item);
        clusters.set(key, list);
      }

      for (const [key, marker] of live) {
        if (clusters.has(key)) continue;
        marker.remove();
        live.delete(key);
      }

      for (const [key, items] of clusters) {
        if (live.has(key)) continue;
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
              zoom: Math.min(map.getZoom() + 2.5, 16),
            });
          } else {
            setLightboxIndex(indexOf.get(rep.id) ?? 0);
          }
        });
        live.set(
          key,
          new maplibregl.Marker({ element: el }).setLngLat([rep.longitude!, rep.latitude!]).addTo(map),
        );
      }
    };

    // Redraws land on a frame of their own, and never more than one per frame:
    // moveend after a fling fires alongside zoomend, and doing the work twice
    // in the same tick is a visible hitch.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
    map.on('moveend', schedule);
    map.on('zoomend', schedule);
    return () => {
      map.off('moveend', schedule);
      map.off('zoomend', schedule);
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedMedia, indexOf, thumb]);

  // One section per day, exactly like the app's timeline: the date, the places
  // that day touched (day trips included), the weather, then the photos. The
  // numbered stop bullets that used to sit in between are gone — they repeated
  // information the day rows already carry, and they put a day trip's photos
  // under the city you slept in.
  const entries = useMemo<DayEntry[]>(() => {
    const days = new Map<string, SharedMedia[]>();
    for (const item of orderedMedia) {
      const day = item.takenAt.slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), item]);
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
        place: onDay.length > 0 ? onDay.map((s) => s.name).join(' \u00b7 ') : null,
        flag: last?.countryCode ?? null,
        lat: last?.latitude ?? null,
        lon: last?.longitude ?? null,
      };
    };

    return [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items, ...placeFor(date) }));
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
            // The cover fills the top of the page, so this one wants the big
            // rendition — everything else on the page takes the small one.
            src={thumb(trip.resolvedCoverId, 'preview')}
            alt=""
            className="share-headcard-img"
            decoding="async"
            fetchPriority="high"
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
          {/* Same markup and classes as the app's timeline, so the shared page
              reads identically: one row per day with its places and weather. */}
          {/* Straight to a city, the same row of pills the app's timeline has. */}
          <StopJump stops={stops} days={entries.map((entry) => entry.date)} />
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
                      {formatDay(entry.items[0]!.takenAt)}
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
                {/* Justified rows, same as the app: each photo keeps its own
                    shape instead of being cropped into a square. */}
                <PhotoGrid items={entry.items} className="timeline-grid">
                  {(item) => (
                    <figure
                      className="timeline-photo"
                      role="button"
                      onClick={() => setLightboxIndex(indexOf.get(item.id) ?? 0)}
                    >
                      <img
                        src={thumb(item.id)}
                        alt=""
                        className="timeline-img"
                        loading="lazy"
                        decoding="async"
                        // The shapes are already known, so the browser can size
                        // and decode without waiting for the header bytes.
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
                    </figure>
                  )}
                </PhotoGrid>
              </section>
            ))}
          </div>
        </section>
      )}

      <footer className="share-footer">
        Gedeeld met <LogoMark size={18} /> <strong>MarkMySteps</strong>
      </footer>

      {/* The same grip the app has: a trip of three months is a very long page
          to flick through, and this one scrolls the document itself. */}
      <FastScroll />

      {/* The app's viewer, not a second one that merely looked like it: the
          same pinch, double-tap and drag zoom, the same paging and the same
          swipe to dismiss. It only gets told where the pixels live. */}
      {lightboxIndex !== null && lightboxItems[lightboxIndex] && (
        <Lightbox
          items={lightboxItems}
          index={lightboxIndex}
          srcFor={(item, size) => thumb(item.id, size)}
          videoSrcFor={(item) => videoSrc(item.id)}
          onNavigate={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/** A single-hop jump longer than this in a route line is treated as a flight. */
const FLIGHT_KM = 400;

/**
 * The recorded route, drawn the way the app draws it.
 *
 * The shared page used to hand the whole track to one line layer, which put a
 * straight coloured line across the map wherever the tracker had a gap — a
 * flight, a day the battery died, the hop home. The app has not done that for
 * a while: it cuts the line at every big jump and draws a dashed arc over the
 * gap instead. This is that same treatment, so a link you send someone shows
 * the route you actually travelled rather than a fan of straight lines over it.
 */
function drawTrackedRoute(map: MapLibreMap, routes: RouteCollection, stops: SharedStop[]) {
  // Where the trip itself says a flight happened. Those legs are cut even when
  // the tracker filled them in, and long ground legs stay joined up.
  const flightEndpoints = buildLegs(
    stops.map((s) => ({
      id: s.id,
      latitude: s.latitude,
      longitude: s.longitude,
      travelMode: s.travelMode ?? 'GROUND',
      fromAirport: s.fromAirport ?? null,
      toAirport: s.toAirport ?? null,
      viaAirports: s.viaAirports ?? [],
      parentStopId: s.parentStopId,
      hideLeg: s.hideLeg,
    })),
  )
    .filter((leg) => leg.isFlight)
    .map((leg) => {
      const c = (leg.feature.geometry as GeoJSON.LineString).coordinates as [number, number][];
      return { from: c[0]!, to: c[c.length - 1]! };
    });

  const near = (a: [number, number], b: [number, number]) => haversineKm(a, b) <= 250;
  const isExplicitFlight = (a: [number, number], b: [number, number]) =>
    flightEndpoints.some(
      (f) => (near(a, f.from) && near(b, f.to)) || (near(a, f.to) && near(b, f.from)),
    );

  const bounds = new LngLatBounds();
  let hasPoints = false;

  for (const feature of routes.features) {
    const { userId } = feature.properties;
    const id = `share-route-${userId}`;
    // Trim stray home snaps so the line doesn't run from home to the trip.
    const coords = trimOutlierEnds(feature.geometry.coordinates as [number, number][]);

    const ground: [number, number][][] = [];
    const flights: [number, number][][] = [];
    let run: [number, number][] = coords.length ? [coords[0]!] : [];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1]!;
      const b = coords[i]!;
      const longJump = haversineKm(a, b) > FLIGHT_KM;
      const explicit = isExplicitFlight(a, b);
      if (longJump || explicit) {
        if (run.length >= 2) ground.push(run);
        if (longJump && !explicit) flights.push(flightArc(a, b));
        run = [b];
      } else {
        run.push(b);
      }
    }
    if (run.length >= 2) ground.push(run);

    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: ground },
        properties: {},
      },
    });
    map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: id,
      paint: { 'line-color': colorForUser(userId), 'line-width': 3.5 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    if (flights.length > 0) {
      const fid = `${id}-flights`;
      map.addSource(fid, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'MultiLineString', coordinates: flights },
          properties: {},
        },
      });
      map.addLayer({
        id: `${fid}-line`,
        type: 'line',
        source: fid,
        // Dashed, and grey: the arc is drawn, not recorded.
        paint: { 'line-color': '#8a94a3', 'line-width': 2, 'line-dasharray': [1.4, 2.6] },
        layout: { 'line-cap': 'round' },
      });
    }

    for (const coordinate of coords) {
      bounds.extend(coordinate);
      hasPoints = true;
    }
  }

  if (hasPoints) map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 800 });
}
