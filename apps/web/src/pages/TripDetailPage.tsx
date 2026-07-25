import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { LiveFix, MediaItem, RouteCollection, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { confirmModal } from '../components/confirm';
import { Icon } from '../components/Icon';
import { Lightbox } from '../components/Lightbox';
import { MembersPanel } from '../components/MembersPanel';
import { SharePanel } from '../components/SharePanel';
import { Timeline } from '../components/Timeline';
import { TripMap, TripMapApi, Waypoint } from '../components/TripMap';
import { TripPlanner } from '../components/TripPlanner';
import type { TripNote } from '../components/DayNote';
import type { PlannedStop } from '../lib/arc';
import { colorForUser, formatDate } from '../lib/colors';
import { getMapStyle } from '../lib/prefs';
import { onTrackerChange } from '../tracking/tracker';
import './tripdetail.css';

interface TripStats {
  distanceKm: number;
  countries: string[];
  days: number;
  photoCount: number;
}

export function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [routes, setRoutes] = useState<RouteCollection | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [visibleUsers, setVisibleUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [addPointMode, setAddPointMode] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleClosing, setPeopleClosing] = useState(false);
  const [currentLoc, setCurrentLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [liveTracking, setLiveTracking] = useState(false);
  const [liveFixes, setLiveFixes] = useState<LiveFix[]>([]);
  const [personMenuOpen, setPersonMenuOpen] = useState(false);
  const [personMenuClosing, setPersonMenuClosing] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ lng: number; lat: number } | null>(null);
  const [pointTime, setPointTime] = useState('');
  const [stops, setStops] = useState<PlannedStop[]>([]);
  const [tab, setTab] = useState<'timeline' | 'plan'>('timeline');
  const [planPick, setPlanPick] = useState<{ lat: number; lng: number } | null>(null);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [notes, setNotes] = useState<TripNote[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const scrollRef = useRef<HTMLElement>(null);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const mapApiRef = useRef<TripMapApi | null>(null);
  const mediaRef = useRef<MediaItem[]>([]);
  mediaRef.current = media;

  // Map follows the timeline: as you scroll, focus the camera on the photos
  // currently visible in the list, so the map shows where you are in the trip.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let focusTimer = 0;
    let lastKey = '';

    // The map shrink is driven purely by CSS (scroll-timeline) so it stays on
    // the compositor and never janks. Here we only move the camera to follow
    // the timeline, and only once scrolling settles.
    const focusVisible = () => {
      const api = mapApiRef.current;
      if (!api) return;
      const mapBottom = window.innerHeight * 0.42;
      const coords: [number, number][] = [];
      const seen = new Set<string>();
      for (const node of document.querySelectorAll<HTMLElement>('[data-media-id]')) {
        const r = node.getBoundingClientRect();
        if (r.bottom < mapBottom || r.top > window.innerHeight) continue;
        const id = node.dataset.mediaId!;
        if (seen.has(id)) continue;
        seen.add(id);
        const m = mediaRef.current.find((x) => x.id === id);
        if (m && m.latitude !== null && m.longitude !== null) coords.push([m.longitude, m.latitude]);
      }
      if (coords.length === 0) return;
      const key = `${coords.length}:${coords[0]![0].toFixed(2)},${coords[0]![1].toFixed(2)}`;
      if (key === lastKey) return;
      lastKey = key;
      api.focusOn(coords);
    };

    // Mobile only: shrink the fixed map as the page scrolls (content slides up
    // under it at 1×), down to a floor so the map always stays visible.
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const vh = window.innerHeight / 100;
    const startH = 55 * vh;
    const minH = 32 * vh;
    let raf = 0;
    const shrinkMap = () => {
      const panel = mapPanelRef.current;
      if (!panel || !isMobile) return;
      panel.style.height = `${Math.max(minH, startH - el.scrollTop)}px`;
    };
    shrinkMap();

    const onScroll = () => {
      // Height update on rAF so it stays glued to the scroll (no lag/jank).
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; shrinkMap(); });
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(focusVisible, 180);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(focusTimer);
    };
  }, [trip]);

  // Live "you are here" dot. Prefer the tracker's fixes (its background plugin
  // already holds the location permission and is recording); also try the web
  // geolocation as a fallback when not actively tracking.
  useEffect(() => {
    const off = onTrackerChange((s) => {
      if (s.lastFix && (s.tripId === tripId || !tripId)) {
        setCurrentLoc({ lat: s.lastFix.lat, lng: s.lastFix.lng });
      }
      setLiveTracking(s.tripId === tripId && !!tripId);
    });
    let watchId: number | null = null;
    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => setCurrentLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 15_000 },
      );
    }
    return () => {
      off();
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [tripId]);

  // Live "who's where": poll each traveller's latest fix (Snap-map style).
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    const load = () =>
      api<LiveFix[]>(`/trips/${tripId}/live`)
        .then((f) => alive && setLiveFixes(f))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [tripId]);

  const loadData = useCallback(() => {
    if (!tripId) return;
    api<Trip>(`/trips/${tripId}`)
      .then((t) => {
        setTrip(t);
        // Default to the owner's + your own track, so multiple travellers'
        // routes don't cross by default — toggle the rest on via the chips.
        setVisibleUsers((cur) =>
          cur.size > 0 ? cur : new Set([t.ownerId, user?.id].filter((x): x is string => !!x)),
        );
      })
      .catch((err: Error) => setError(err.message));
    api<RouteCollection>(`/trips/${tripId}/route`).then(setRoutes).catch(() => undefined);
    api<MediaItem[]>(`/trips/${tripId}/media`).then(setMedia).catch(() => undefined);
    api<PlannedStop[]>(`/trips/${tripId}/stops`).then(setStops).catch(() => undefined);
    api<TripStats>(`/trips/${tripId}/stats`).then(setStats).catch(() => undefined);
    api<TripNote[]>(`/trips/${tripId}/notes`).then(setNotes).catch(() => undefined);
    api<Waypoint[]>(`/trips/${tripId}/points`).then(setWaypoints).catch(() => undefined);
  }, [tripId]);

  const deleteWaypoint = useCallback(
    async (id: string) => {
      if (!tripId) return;
      await api(`/trips/${tripId}/points/${id}`, { method: 'DELETE' });
      setWaypoints((cur) => cur.filter((w) => w.id !== id));
      api<RouteCollection>(`/trips/${tripId}/route`).then(setRoutes).catch(() => undefined);
    },
    [tripId],
  );

  const saveNote = useCallback(
    async (day: string, body: string) => {
      if (!tripId) return;
      setNotes(await api<TripNote[]>(`/trips/${tripId}/notes`, { method: 'PUT', body: { day, body } }));
    },
    [tripId],
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!tripId) return;
      await api(`/trips/${tripId}/notes/${noteId}`, { method: 'DELETE' });
      setNotes((cur) => cur.filter((n) => n.id !== noteId));
    },
    [tripId],
  );

  useEffect(loadData, [loadData]);

  const handleMapClick = useCallback(
    (lngLat: { lng: number; lat: number }) => {
      // On the planner tab a tap picks the location for the next stop.
      if (tab === 'plan') {
        setPlanPick({ lat: lngLat.lat, lng: lngLat.lng });
        return;
      }
      if (!addPointMode) return;
      setPendingPoint(lngLat);
      setPointTime((current) => current || defaultPointTime(trip));
    },
    [addPointMode, trip, tab],
  );

  // Long-press a straight stretch → snap it to real roads (keyless OSM routing).
  const handleLongPress = useCallback(
    async (lngLat: { lng: number; lat: number }) => {
      if (!tripId || tab === 'plan') return;
      const ok = await confirmModal({
        title: 'Route via wegen tekenen?',
        body: 'Het dichtstbijzijnde rechte stuk zonder tracking wordt automatisch aangevuld via de snelste weg.',
        confirmLabel: 'Tekenen',
      });
      if (!ok) return;
      try {
        await api(`/trips/${tripId}/route-fill`, {
          method: 'POST',
          body: { lat: lngLat.lat, lng: lngLat.lng },
        });
        api<RouteCollection>(`/trips/${tripId}/route`).then(setRoutes).catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Route tekenen mislukt');
      }
    },
    [tripId, tab],
  );

  async function savePoint() {
    if (!tripId || !pendingPoint) return;
    try {
      await api(`/trips/${tripId}/points`, {
        method: 'POST',
        body: {
          latitude: pendingPoint.lat,
          longitude: pendingPoint.lng,
          recordedAt: new Date(pointTime).toISOString(),
        },
      });
      setPendingPoint(null);
      api<RouteCollection>(`/trips/${tripId}/route`).then(setRoutes).catch(() => undefined);
      api<Waypoint[]>(`/trips/${tripId}/points`).then(setWaypoints).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Punt opslaan mislukt');
    }
  }

  // Animate the sheet out before unmounting so the blur/backdrop don't snap.
  const closePeople = useCallback(() => {
    setPeopleClosing(true);
    window.setTimeout(() => {
      setPeopleOpen(false);
      setPeopleClosing(false);
    }, 240);
  }, []);

  const toggleUser = useCallback((userId: string) => {
    setVisibleUsers((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const visibleMedia = useMemo(
    () => media.filter((m) => visibleUsers.has(m.userId)),
    [media, visibleUsers],
  );

  // Your own "you are here" dot only belongs on a trip that is CURRENTLY running
  // (between start and end) — not on every past/future trip's map.
  const tripActive =
    !!trip &&
    trip.startDate.slice(0, 10) <= new Date().toISOString().slice(0, 10) &&
    new Date(trip.endDate).getTime() + 86_400_000 >= Date.now();

  // Animate the person dropdown out before it unmounts (mirrors the open pop).
  const togglePersonMenu = () => {
    if (personMenuOpen) {
      setPersonMenuClosing(true);
      window.setTimeout(() => {
        setPersonMenuOpen(false);
        setPersonMenuClosing(false);
      }, 150);
    } else {
      setPersonMenuOpen(true);
    }
  };

  // Keep the timeline in sync with the open photo: switch to the Tijdlijn tab
  // and scroll the matching thumbnail into view.
  const openPhoto = useCallback(
    (mediaId: string) => {
      const idx = visibleMedia.findIndex((m) => m.id === mediaId);
      if (idx === -1) return;
      setLightboxIndex(idx);
    },
    [visibleMedia],
  );

  const scrollTimelineTo = useCallback((mediaId: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-media-id="${mediaId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const item = visibleMedia[lightboxIndex];
    if (!item) return;
    scrollTimelineTo(item.id);
  }, [lightboxIndex, visibleMedia, scrollTimelineTo]);

  if (error) {
    return (
      <main className="page">
        <p className="error-text">{error}</p>
        <Link to="/" className="btn btn-ghost">
          <Icon name="arrow-left" size={16} /> Terug naar reizen
        </Link>
      </main>
    );
  }

  return (
    <main className="trip-detail fade-in" ref={scrollRef}>
      <div className="trip-map-panel card" ref={mapPanelRef}>
        <Link to="/" className="trip-fab trip-fab-back" aria-label="Alle reizen">
          <Icon name="arrow-left" size={20} />
        </Link>
        {trip && (
          <div className="trip-fabs">
            <button
              className="trip-fab"
              aria-label="Reisgenoten & delen"
              onClick={() => setPeopleOpen(true)}
            >
              <Icon name="people" size={20} />
            </button>
            {trip.ownerId === user?.id && (
              <Link
                to={`/trips/${tripId}/settings`}
                className="trip-fab"
                aria-label="Reisinstellingen"
              >
                <Icon name="gear" size={20} />
              </Link>
            )}
          </div>
        )}
        <TripMap
          routes={routes}
          media={media}
          stops={stops}
          waypoints={waypoints}
          onWaypointDelete={addPointMode ? deleteWaypoint : undefined}
          visibleUsers={visibleUsers}
          onMapClick={handleMapClick}
          onLongPress={handleLongPress}
          onPhotoOpen={openPhoto}
          onPhotoFocus={scrollTimelineTo}
          clickMode={addPointMode}
          styleUrl={getMapStyle()}
          currentLocation={tripActive ? currentLoc : null}
          liveFixes={liveFixes}
          selfUserId={user?.id}
          tripStarted={!!trip && trip.startDate.slice(0, 10) <= new Date().toISOString().slice(0, 10)}
          onReady={(api) => (mapApiRef.current = api)}
        />

        {liveTracking && (
          <button
            className="live-badge"
            onClick={() => currentLoc && mapApiRef.current?.flyTo(currentLoc.lng, currentLoc.lat, 13)}
            title="Ga naar mijn huidige locatie"
          >
            <span className="live-badge-dot" />
            Live
            <Icon name="pin" size={13} className="live-badge-go" />
          </button>
        )}

        {trip && trip.members.length > 1 && (
          <div className="person-select">
            {personMenuOpen && (
              <div className={`person-select-menu card ${personMenuClosing ? 'closing' : ''}`}>
                {trip.members.map((member) => {
                  const active = visibleUsers.has(member.userId);
                  return (
                    <button
                      key={member.userId}
                      className={active ? 'active' : ''}
                      onClick={() => toggleUser(member.userId)}
                    >
                      <span
                        className="person-chip-dot"
                        style={{ background: colorForUser(member.userId) }}
                      />
                      <span className="person-select-name">
                        {member.user.displayName}
                        {member.userId === user?.id && ' (ik)'}
                      </span>
                      <span className={`person-check ${active ? 'on' : ''}`}>
                        <Icon name="check" size={15} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <button
              className="person-select-btn"
              onClick={togglePersonMenu}
              aria-expanded={personMenuOpen}
            >
              <span
                className="person-chip-dot"
                style={{ background: colorForUser(user?.id ?? '') }}
              />
              <span className="person-select-name">
                {trip.members.find((m) => m.userId === user?.id)?.user.displayName ?? 'Ik'}
                {visibleUsers.size > 1 && ` +${visibleUsers.size - 1}`}
              </span>
              <Icon
                name="chevron-down"
                size={14}
                className={`person-select-caret ${personMenuOpen && !personMenuClosing ? 'open' : ''}`}
              />
            </button>
          </div>
        )}

        {pendingPoint && (
          <div className="add-point-panel card">
            <strong>Punt toevoegen</strong>
            <span className="muted">
              {pendingPoint.lat.toFixed(5)}, {pendingPoint.lng.toFixed(5)}
            </span>
            <div className="field">
              <label htmlFor="pt-time">Tijdstip op de route</label>
              <input
                id="pt-time"
                type="datetime-local"
                value={pointTime}
                onChange={(e) => setPointTime(e.target.value)}
              />
            </div>
            <div className="add-point-actions">
              <button className="btn btn-ghost" onClick={() => setPendingPoint(null)}>
                Annuleren
              </button>
              <button className="btn btn-primary" onClick={savePoint} disabled={!pointTime}>
                Opslaan
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="trip-side">
        <div className="sheet-grab" aria-hidden="true" />
        {trip?.resolvedCoverId ? (
          <div className="trip-hero">
            <AuthImage
              path={`/media/${trip.resolvedCoverId}/thumbnail`}
              alt=""
              className="trip-hero-img"
            />
            <div className="trip-hero-overlay">
              <h1>{trip.title}</h1>
              <p>
                {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
              </p>
            </div>
          </div>
        ) : (
          <>
            <h1>{trip?.title ?? '…'}</h1>
            {trip && (
              <p className="muted">
                {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
              </p>
            )}
          </>
        )}
        {trip?.description && <p>{trip.description}</p>}

        {stats && (
          <div className="trip-stats">
            {stats.distanceKm > 0 && (
              <div className="stat">
                <strong>{stats.distanceKm.toLocaleString('nl-NL')}</strong>
                <span>km</span>
              </div>
            )}
            <div className="stat">
              <strong>{stats.days}</strong>
              <span>dagen</span>
            </div>
            {stats.countries.length > 1 && (
              <div className="stat">
                <strong>{stats.countries.length}</strong>
                <span>landen</span>
              </div>
            )}
            {stats.photoCount > 0 && (
              <div className="stat">
                <strong>{stats.photoCount}</strong>
                <span>foto's</span>
              </div>
            )}
          </div>
        )}

        <div className="side-tabs" role="tablist">
          <button
            className={tab === 'timeline' ? 'active' : ''}
            role="tab"
            aria-selected={tab === 'timeline'}
            onClick={() => setTab('timeline')}
          >
            Tijdlijn
          </button>
          <button
            className={tab === 'plan' ? 'active' : ''}
            role="tab"
            aria-selected={tab === 'plan'}
            onClick={() => setTab('plan')}
          >
            Routeplanner
          </button>
        </div>

        {tab === 'timeline' ? (
          <Timeline
            media={visibleMedia}
            visibleUsers={visibleUsers}
            showOwner={(trip?.members.length ?? 0) > 1}
            onPhotoClick={(item) => setLightboxIndex(visibleMedia.indexOf(item))}
            notes={notes}
            canEditNotes={!!user && trip?.members.some((m) => m.userId === user.id)}
            ownUserId={user?.id}
            onSaveNote={saveNote}
            onDeleteNote={deleteNote}
            stops={stops.map((s) => ({
              name: s.name,
              countryCode: s.countryCode,
              latitude: s.latitude,
              longitude: s.longitude,
              arrivalDate: s.arrivalDate,
              departureDate: s.departureDate,
            }))}
          />
        ) : (
          <TripPlanner
            tripId={tripId!}
            trip={trip}
            stops={stops}
            onStopsChange={setStops}
            onChanged={loadData}
            pickedCoords={planPick}
            onPickConsumed={() => setPlanPick(null)}
            onFlyTo={(lng, lat) => mapApiRef.current?.flyTo(lng, lat)}
          />
        )}
      </aside>

      {peopleOpen && trip && (
        <div
          className={`people-sheet-backdrop ${peopleClosing ? 'closing' : ''}`}
          onClick={closePeople}
        >
          <div className="people-sheet card" onClick={(e) => e.stopPropagation()}>
            <div className="people-sheet-head">
              <h2>Reisgenoten &amp; delen</h2>
              <button
                className="people-sheet-close"
                aria-label="Sluiten"
                onClick={closePeople}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <MembersPanel trip={trip} onChanged={loadData} />
            {trip.ownerId === user?.id && tripId && <SharePanel tripId={tripId} />}
          </div>
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          items={visibleMedia}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          coverTripId={trip?.ownerId === user?.id ? tripId : undefined}
          onCoverSet={loadData}
        />
      )}
    </main>
  );
}

/** Default manual-point time: midday on the trip's first day, or now. */
function defaultPointTime(trip: Trip | null): string {
  const base = trip ? new Date(trip.startDate) : new Date();
  base.setHours(12, 0, 0, 0);
  return base.toISOString().slice(0, 16);
}
