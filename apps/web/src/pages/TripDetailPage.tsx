import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { MediaItem, RouteCollection, SyncResult, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { Lightbox } from '../components/Lightbox';
import { MembersPanel } from '../components/MembersPanel';
import { SharePanel } from '../components/SharePanel';
import { Timeline } from '../components/Timeline';
import { TripMap, Waypoint } from '../components/TripMap';
import type { TripNote } from '../components/DayNote';
import type { StopPoint } from '../lib/arc';
import { colorForUser, flagEmoji, formatDate } from '../lib/colors';
import { getMapStyle } from '../lib/prefs';
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
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [addPointMode, setAddPointMode] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [sideTab, setSideTab] = useState<'timeline' | 'manage'>('timeline');
  const [pendingPoint, setPendingPoint] = useState<{ lng: number; lat: number } | null>(null);
  const [pointTime, setPointTime] = useState('');
  const [stops, setStops] = useState<StopPoint[]>([]);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [notes, setNotes] = useState<TripNote[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

  const loadData = useCallback(() => {
    if (!tripId) return;
    api<Trip>(`/trips/${tripId}`)
      .then((t) => {
        setTrip(t);
        setVisibleUsers(new Set(t.members.map((m) => m.userId)));
      })
      .catch((err: Error) => setError(err.message));
    api<RouteCollection>(`/trips/${tripId}/route`).then(setRoutes).catch(() => undefined);
    api<MediaItem[]>(`/trips/${tripId}/media`).then(setMedia).catch(() => undefined);
    api<StopPoint[]>(`/trips/${tripId}/stops`).then(setStops).catch(() => undefined);
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

  async function runSync() {
    if (!tripId) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await api<SyncResult>(`/trips/${tripId}/sync`, { method: 'POST' });
      setSyncMessage(
        `${result.assetsAdded} nieuwe foto's (${result.assetsFound} gevonden, ${result.usersSynced} reiziger${result.usersSynced === 1 ? '' : 's'})`,
      );
      loadData();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync mislukt');
    } finally {
      setSyncing(false);
    }
  }

  const handleMapClick = useCallback(
    (lngLat: { lng: number; lat: number }) => {
      if (!addPointMode) return;
      setPendingPoint(lngLat);
      setPointTime((current) => current || defaultPointTime(trip));
    },
    [addPointMode, trip],
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
    setSideTab('timeline');
    // Wait for the tab to render before scrolling.
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
          ← Terug naar reizen
        </Link>
      </main>
    );
  }

  return (
    <main className="trip-detail fade-in">
      <div className="trip-map-panel card">
        <TripMap
          routes={routes}
          media={media}
          stops={stops}
          waypoints={waypoints}
          onWaypointDelete={sideTab === 'manage' && addPointMode ? deleteWaypoint : undefined}
          visibleUsers={visibleUsers}
          onMapClick={handleMapClick}
          onPhotoOpen={openPhoto}
          onPhotoFocus={scrollTimelineTo}
          clickMode={addPointMode}
          styleUrl={getMapStyle()}
        />

        {trip && trip.members.length > 1 && (
          <div className="person-toggles">
            {trip.members.map((member) => {
              const active = visibleUsers.has(member.userId);
              return (
                <button
                  key={member.userId}
                  className={`person-chip ${active ? 'active' : ''}`}
                  onClick={() => toggleUser(member.userId)}
                >
                  <span
                    className="person-chip-dot"
                    style={{ background: colorForUser(member.userId) }}
                  />
                  {member.user.displayName}
                  {member.userId === user?.id && ' (ik)'}
                </button>
              );
            })}
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
              <Link to="/" className="trip-back-hero">
                ← Alle reizen
              </Link>
              <h1>{trip.title}</h1>
              <p>
                {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
              </p>
            </div>
          </div>
        ) : (
          <>
            <Link to="/" className="trip-back muted">
              ← Alle reizen
            </Link>
            <h1>{trip?.title ?? '…'}</h1>
            {trip && (
              <p className="muted">
                {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
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
            {stats.countries.length > 0 && (
              <div className="stat">
                <strong>{stats.countries.length}</strong>
                <span>{stats.countries.slice(0, 4).map((c) => flagEmoji(c)).join('')} landen</span>
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

        <div className="trip-actions">
          <button className="btn btn-primary" onClick={runSync} disabled={syncing}>
            {syncing ? 'Bezig…' : "Foto's syncen"}
          </button>
          <Link to={`/trips/${tripId}/plan`} className="btn btn-ghost">
            Routeplanner
          </Link>
          {trip?.ownerId === user?.id && (
            <Link to={`/trips/${tripId}/settings`} className="btn btn-ghost" aria-label="Instellingen">
              ⚙
            </Link>
          )}
        </div>
        {syncMessage && <p className="muted">{syncMessage}</p>}

        <div className="side-tabs" role="tablist">
          <button
            className={sideTab === 'timeline' ? 'active' : ''}
            onClick={() => setSideTab('timeline')}
          >
            Tijdlijn
          </button>
          <button
            className={sideTab === 'manage' ? 'active' : ''}
            onClick={() => setSideTab('manage')}
          >
            Beheer
          </button>
        </div>

        <div key={sideTab} className="tab-content fade-in">
        {sideTab === 'timeline' && (
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
        )}

        {sideTab === 'manage' && (
          <div className="manage-panel">
            <section className="manage-section">
              <h2 className="trip-side-heading">Route &amp; stops</h2>
              {stops.length > 0 && (
                <ol className="manage-stops">
                  {stops.map((stop, i) => (
                    <li key={stop.id}>
                      <span className="manage-stop-badge">
                        {stop.travelMode === 'FLIGHT' ? '✈' : i + 1}
                      </span>
                      <span>
                        {flagEmoji(stop.countryCode)} {stop.name}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="trip-actions">
                <Link to={`/trips/${tripId}/plan`} className="btn btn-ghost">
                  Stops &amp; vluchten bewerken
                </Link>
                <button
                  className={`btn ${addPointMode ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => {
                    setAddPointMode((v) => !v);
                    setPendingPoint(null);
                  }}
                >
                  {addPointMode ? 'Klaar met punten' : '+ Tussenpunten'}
                </button>
              </div>
              {addPointMode && (
                <p className="muted">
                  Klik op de kaart voor een tussenpunt om de route te verfijnen. Klik op een
                  bestaand punt (oranje stip) om het te verwijderen.
                </p>
              )}
            </section>
            {trip && <MembersPanel trip={trip} onChanged={loadData} />}
            {trip && trip.ownerId === user?.id && tripId && <SharePanel tripId={tripId} />}
          </div>
        )}
        </div>
      </aside>

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
