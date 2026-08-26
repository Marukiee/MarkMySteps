import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { MediaItem, RouteCollection } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import { ArcOverlay, createArcOverlay, drawPlannedStops, groundRuns } from '../lib/mapRoute';
import { colorForUser, formatDay } from '../lib/colors';
import { getMapStyle } from '../lib/prefs';
import { FastScroll } from '../components/FastScroll';
import { useExit } from '../lib/useExit';
import { Icon } from '../components/Icon';
import { Lightbox } from '../components/Lightbox';
import { LogoMark } from '../components/Logo';
import { PhotoGrid } from '../components/PhotoGrid';
import { jumpToDay, StopJump } from '../components/StopJump';
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

/**
 * A stop, exactly as the app knows one.
 *
 * The shared page draws the plan with the app's own code now, and that code
 * wants a whole stop — its travel mode, its airports, whether it is a day trip
 * — not the handful of fields the timeline happened to need.
 */
type SharedStop = PlannedStop;

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
  const [routes, setRoutes] = useState<RouteCollection | null>(null);
  const [mapReady, setMapReady] = useState(false);
  /** The frame the whole trip was given, for the recentre button. */
  const homeBoundsRef = useRef<LngLatBounds | null>(null);
  const [atTop, setAtTop] = useState(true);
  const [fresh, setFresh] = useState<{ count: number; day: string } | null>(null);
  const [freshOpen, setFreshOpen] = useState(false);
  const [freshShown, freshClosing] = useExit(freshOpen, 220);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const arcsRef = useRef<ArcOverlay | null>(null);
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
    get<RouteCollection>('route').then(setRoutes).catch(() => undefined);

    if (!mapContainerRef.current || mapRef.current) return;
    const container = mapContainerRef.current;
    const map = new maplibregl.Map({
      container,
      style: getMapStyle(),
      center: [4.9, 52.37],
      zoom: 3,
      attributionControl: { compact: true },
      /*
       * The page scrolls, and the map is a panel in the middle of it. A thumb
       * dragged upwards over that panel was panning the map instead of the
       * page, so reading the trip meant fighting it. Two fingers move the map
       * now, one finger scrolls past it, and MapLibre says so on the map the
       * moment somebody tries with one.
       */
      cooperativeGestures: true,
      locale: {
        'CooperativeGesturesHandler.MobileHelpText':
          'Gebruik twee vingers om de kaart te verplaatsen',
        'CooperativeGesturesHandler.WindowsHelpText': 'Gebruik Ctrl + scrollen om te zoomen',
        'CooperativeGesturesHandler.MacHelpText': 'Gebruik \u2318 + scrollen om te zoomen',
      },
    });
    mapRef.current = map;
    // The flights are painted over the map rather than onto it, by the same
    // overlay the app's map uses.
    const overlay = createArcOverlay(map, container);
    arcsRef.current = overlay;
    const onLoad = () => setMapReady(true);
    if (map.isStyleLoaded()) setMapReady(true);
    else map.once('load', onLoad);
    // Folded shut, like the app's map: a compact attribution control still
    // starts expanded, and "Imagery © Esri" over the corner of the picture is
    // not what anybody opened the link for. The ⓘ stays.
    map.once('idle', () =>
      container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'),
    );

    return () => {
      overlay.destroy();
      arcsRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [slug, token]);

  /**
   * The route, drawn the way the app draws it.
   *
   * The recorded line cut at every long jump, a dashed line over each gap (a
   * bow only where the plan says a flight), and the plan itself underneath: a
   * pin per place, a line to each one nothing recorded, dashed where the day
   * is still to come. It used to be one line layer over the raw track, and
   * everything else was simply missing.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const bounds = new LngLatBounds();
    let hasPoints = false;

    for (const layerId of map.getLayersOrder().filter((l) => l.startsWith('share-route-'))) {
      map.removeLayer(layerId);
    }
    for (const sourceId of Object.keys(map.getStyle().sources).filter((s) =>
      s.startsWith('share-route-'),
    )) {
      map.removeSource(sourceId);
    }

    // Everything that actually happened, for a planned leg to be measured
    // against: the tracked fixes and the places photos were taken.
    const realPoints: [number, number][] = [];

    for (const feature of routes?.features ?? []) {
      const { userId } = feature.properties;
      const id = `share-route-${userId}`;
      const { ground, gaps, flights, trimmed } = groundRuns(
        feature.geometry.coordinates as [number, number][],
        stops,
      );
      realPoints.push(...trimmed);
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
        paint: { 'line-color': colorForUser(userId), 'line-width': 3 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      if (gaps.length > 0) {
        const fid = `${id}-gaps`;
        map.addSource(fid, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'MultiLineString', coordinates: gaps },
            properties: {},
          },
        });
        map.addLayer({
          id: `${fid}-line`,
          type: 'line',
          source: fid,
          // The traveller's colour, dashed: travelled, but not recorded. Only
          // a leg the plan calls a flight gets a grey bow.
          paint: {
            'line-color': colorForUser(userId),
            'line-width': 2.5,
            'line-dasharray': [2, 2],
          },
          layout: { 'line-cap': 'round' },
        });
      }
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
      for (const coordinate of trimmed) {
        bounds.extend(coordinate);
        hasPoints = true;
      }
    }

    for (const item of media) {
      if (item.latitude === null || item.longitude === null) continue;
      realPoints.push([item.longitude, item.latitude]);
    }

    // The traveller's own colour where there is a track to join up with, beige
    // where the trip is still only a plan.
    const firstUser = routes?.features[0]?.properties.userId;
    const gapColour = realPoints.length > 0 && firstUser ? colorForUser(firstUser) : '#ffc46b';

    let markers: maplibregl.Marker[] = [];
    try {
      const drawn = drawPlannedStops(map, { stops, realPoints, gapColour });
      markers = drawn.markers;
      arcsRef.current?.setTracks(drawn.tracks);
    } catch {
      // A style mid-swap refuses a new source; a missing line until the next
      // change beats taking the page down with it.
    }

    for (const stop of stops) {
      if (stop.latitude === null || stop.longitude === null) continue;
      bounds.extend([stop.longitude, stop.latitude]);
      hasPoints = true;
    }
    if (hasPoints) {
      // Kept, so the button in the corner can put the map back exactly here
      // after you have wandered off across it.
      homeBoundsRef.current = bounds;
      map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 800 });
    }

    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [mapReady, routes, stops, media]);

  /**
   * Far enough down the page that going back to the top is a journey.
   *
   * The body is the scroller here (`overflow-x: hidden` on it computes its
   * overflow-y to `auto`), so its scroll is what to listen to — the window
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
   * own browser — nothing about a visit is sent anywhere — and anything taken
   * later than that is new.
   */
  useEffect(() => {
    if (orderedMedia.length === 0) return;
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
  }, [orderedMedia, slug]);

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

  const placeByDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) if (entry.place) map.set(entry.date, entry.place);
    return map;
  }, [entries]);

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
        {/* Back to the whole trip. Panning and pinching a map is how you get
            lost on one, and a map you cannot get back from is a map you stop
            touching. */}
        {mapReady && (
          <button
            type="button"
            className="share-map-recenter"
            aria-label="Terug naar de hele reis"
            title="Terug naar de hele reis"
            onClick={() => {
              const bounds = homeBoundsRef.current;
              if (bounds && mapRef.current) {
                mapRef.current.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 700 });
              }
            }}
          >
            <Icon name="reload" size={19} />
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <section className="share-section">
          <h2 className="share-section-title">Tijdlijn</h2>
          {/* Same markup and classes as the app's timeline, so the shared page
              reads identically: one row per day with its places and weather. */}
          {/* Straight to a city, the same row of pills the app's timeline has. */}
          <StopJump
            stops={stops}
            days={entries.map((entry) => entry.date)}
            media={orderedMedia}
            renderThumb={(id, onMissing) => (
              <img
                src={thumb(id)}
                alt=""
                loading="lazy"
                decoding="async"
                onError={onMissing}
              />
            )}
          />
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
                      // Named so a jump from the places rail can land on this
                      // photo rather than on the top of the day it is in.
                      data-media-id={item.id}
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

      {/* Straight back to the top. Nothing is pinned across the top of this
          page, so unlike the app's it can sit at the very top of the screen. */}
      {!atTop && (
        <button
          type="button"
          className="share-backtop"
          aria-label="Terug naar boven"
          onClick={scrollPageToTop}
        >
          <Icon name="chevron-up" size={20} />
        </button>
      )}

      {/* What you came back for. */}
      {freshShown && fresh && (
        <div className={`share-fresh ${freshClosing ? 'closing' : ''}`} role="status">
          <span className="share-fresh-text">
            {fresh.count === 1 ? 'Er staat 1 nieuwe foto' : `Er staan ${fresh.count} nieuwe foto's`}{' '}
            sinds je laatste bezoek
          </span>
          <button
            type="button"
            className="share-fresh-go"
            onClick={() => {
              jumpToDay(fresh.day);
              setFreshOpen(false);
            }}
          >
            Bekijken
          </button>
          <button
            type="button"
            className="share-fresh-close"
            aria-label="Sluiten"
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
        <Lightbox
          items={lightboxItems}
          index={lightboxIndex}
          srcFor={(item, size) => thumb(item.id, size)}
          videoSrcFor={(item) => videoSrc(item.id)}
          onNavigate={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          // The day's own places, for a photo whose coordinate the map cannot
          // put a name to.
          placeFallbackFor={(item) => placeByDay.get(item.takenAt.slice(0, 10)) ?? null}
        />
      )}
    </div>
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
