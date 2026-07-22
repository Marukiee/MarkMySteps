import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { MediaItem, RouteCollection, SyncResult, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Lightbox } from '../components/Lightbox';
import { MembersPanel } from '../components/MembersPanel';
import { SharePanel } from '../components/SharePanel';
import { Timeline } from '../components/Timeline';
import { TrackButton } from '../components/TrackButton';
import { TripMap } from '../components/TripMap';
import { colorForUser, formatDate } from '../lib/colors';
import './tripdetail.css';

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
  }, [tripId]);

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
      setAddPointMode(false);
      api<RouteCollection>(`/trips/${tripId}/route`).then(setRoutes).catch(() => undefined);
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
          visibleUsers={visibleUsers}
          onMapClick={handleMapClick}
          clickMode={addPointMode}
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
        <Link to="/" className="trip-back muted">
          ← Alle reizen
        </Link>
        <h1>{trip?.title ?? '…'}</h1>
        {trip && (
          <p className="muted">
            {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
          </p>
        )}
        {trip?.description && <p>{trip.description}</p>}

        <div className="trip-actions">
          <button className="btn btn-primary" onClick={runSync} disabled={syncing}>
            {syncing ? 'Bezig…' : "Foto's syncen"}
          </button>
          <Link to={`/trips/${tripId}/plan`} className="btn btn-ghost">
            Planning
          </Link>
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

        {sideTab === 'timeline' && (
          <Timeline
            media={visibleMedia}
            visibleUsers={visibleUsers}
            onPhotoClick={(item) => setLightboxIndex(visibleMedia.indexOf(item))}
          />
        )}

        {sideTab === 'manage' && (
          <div className="manage-panel">
            <section className="manage-section">
              <h2 className="trip-side-heading">Tracking &amp; route</h2>
              <div className="trip-actions">
                {tripId && <TrackButton tripId={tripId} />}
                <button
                  className={`btn ${addPointMode ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => {
                    setAddPointMode((v) => !v);
                    setPendingPoint(null);
                  }}
                >
                  {addPointMode ? 'Klik op de kaart…' : '+ Routepunt'}
                </button>
              </div>
            </section>
            {trip && <MembersPanel trip={trip} onChanged={loadData} />}
            {trip && trip.ownerId === user?.id && tripId && <SharePanel tripId={tripId} />}
          </div>
        )}
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
