import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { SyncResult, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { Icon } from '../components/Icon';
import { MembersPanel } from '../components/MembersPanel';
import './tripsettings.css';

/** Polarsteps-style "Edit trip" screen. */
export function TripSettingsPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [autoTrack, setAutoTrack] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  function load() {
    if (!tripId) return;
    api<Trip>(`/trips/${tripId}`)
      .then((t) => {
        setTrip(t);
        setTitle(t.title);
        setStartDate(t.startDate.slice(0, 10));
        setEndDate(t.endDate.slice(0, 10));
        setAutoTrack(t.autoTrack);
      })
      .catch((e: Error) => setError(e.message));
  }
  useEffect(load, [tripId]);

  const isOwner = trip?.ownerId === user?.id;

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!tripId) return;
    setError(null);
    try {
      await api(`/trips/${tripId}`, {
        method: 'PATCH',
        body: { title, startDate, endDate, autoTrack },
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan mislukt');
    }
  }

  async function remove() {
    if (!tripId || !window.confirm(`"${trip?.title}" definitief verwijderen?`)) return;
    await api(`/trips/${tripId}`, { method: 'DELETE' });
    navigate('/');
  }

  async function runSync() {
    if (!tripId) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await api<SyncResult>(`/trips/${tripId}/sync`, { method: 'POST' });
      setSyncMessage(
        `${result.assetsAdded} nieuwe foto's (${result.assetsFound} gevonden, ${result.usersSynced} reiziger${result.usersSynced === 1 ? '' : 's'})`,
      );
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync mislukt');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="page fade-in trip-settings">
      <div className="ts-head">
        <Link to={`/trips/${tripId}`} className="btn btn-ghost">
          <Icon name="arrow-left" size={16} /> Terug
        </Link>
        <h1>Reisinstellingen</h1>
      </div>

      {trip?.resolvedCoverId && (
        <div className="ts-cover">
          <AuthImage path={`/media/${trip.resolvedCoverId}/thumbnail`} alt="" className="ts-cover-img" />
          <span className="ts-cover-hint">Kies een coverfoto via een foto → “Als cover”</span>
        </div>
      )}

      {isOwner ? (
        <form onSubmit={save} className="ts-form">
          <div className="field">
            <label htmlFor="ts-title">Naam</label>
            <input id="ts-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="ts-dates">
            <div className="field">
              <label htmlFor="ts-start">Startdatum</label>
              <input
                id="ts-start"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ts-end">Einddatum</label>
              <input
                id="ts-end"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <label className="ts-toggle">
            <div>
              <strong>Automatisch tracken</strong>
              <span className="muted">
                Start route-tracking automatisch zodra de reis begint (app, op de achtergrond).
              </span>
            </div>
            <input
              type="checkbox"
              checked={autoTrack}
              onChange={(e) => setAutoTrack(e.target.checked)}
            />
          </label>

          {error && <p className="error-text">{error}</p>}
        </form>
      ) : (
        <p className="muted">Alleen de organisator kan de reisinstellingen wijzigen.</p>
      )}

      <section className="ts-sync">
        <div>
          <strong>Foto's syncen</strong>
          <span className="muted">
            Haal nieuwe foto's met GPS uit Immich op voor deze reis.
          </span>
        </div>
        <button className="btn btn-ghost" onClick={runSync} disabled={syncing}>
          {syncing ? 'Bezig…' : "Foto's syncen"}
        </button>
      </section>
      {syncMessage && <p className="muted ts-sync-msg">{syncMessage}</p>}

      {trip && <MembersPanel trip={trip} onChanged={load} />}

      {isOwner && (
        <div className="ts-actions ts-actions-bottom">
          <button className="btn btn-danger" onClick={remove}>
            Reis verwijderen
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            {saved ? 'Opgeslagen ✓' : 'Wijzigingen opslaan'}
          </button>
        </div>
      )}
    </main>
  );
}
