import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { colorForUser, formatDate } from '../lib/colors';
import './trips.css';

export function TripsPage() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<Trip[]>('/trips')
      .then(setTrips)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  return (
    <main className="page fade-in">
      <div className="trips-head">
        <h1>Reizen</h1>
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Annuleren' : '+ Nieuwe reis'}
        </button>
      </div>

      {showNew && (
        <NewTripForm
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}

      {error && <p className="error-text">{error}</p>}
      {trips === null && !error && <p className="muted">Laden…</p>}
      {trips?.length === 0 && (
        <div className="card trips-empty">
          <h2>Nog geen reizen</h2>
          <p className="muted">
            Maak je eerste reis aan, of importeer je Polarsteps-data via Instellingen.
          </p>
        </div>
      )}

      <div className="trips-grid">
        {trips?.map((trip, i) => (
          <Link
            key={trip.id}
            to={`/trips/${trip.id}`}
            className="card trip-card"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div
              className="trip-card-cover"
              style={{ background: coverGradient(trip.id) }}
            >
              <span className="trip-card-dates">
                {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
              </span>
            </div>
            <div className="trip-card-body">
              <h2>{trip.title}</h2>
              {trip.description && <p className="muted">{trip.description}</p>}
              <div className="trip-card-members">
                {trip.members.map((m) => (
                  <span
                    key={m.userId}
                    className="member-dot"
                    style={{ background: colorForUser(m.userId) }}
                    title={m.user.displayName}
                  >
                    {m.user.displayName[0]}
                  </span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

function NewTripForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/trips', { method: 'POST', body: { title, startDate, endDate } });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card new-trip-form fade-in" onSubmit={submit}>
      <div className="field">
        <label htmlFor="nt-title">Titel</label>
        <input id="nt-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="nt-start">Van</label>
        <input
          id="nt-start"
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="nt-end">Tot</label>
        <input
          id="nt-end"
          type="date"
          required
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>
        Aanmaken
      </button>
    </form>
  );
}

/** Deterministic warm gradient per trip — placeholder until hero photos land. */
function coverGradient(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const hue1 = hash % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 45% 72%), hsl(${hue2} 50% 58%))`;
}
