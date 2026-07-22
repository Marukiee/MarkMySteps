import { FormEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
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

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = trips?.filter((t) => t.endDate.slice(0, 10) >= today) ?? [];
  const past = trips?.filter((t) => t.endDate.slice(0, 10) < today) ?? [];

  return (
    <main className="page fade-in">
      <GlobeBackdrop trips={trips ?? []} />

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

      {upcoming.length > 0 && (
        <>
          <h2 className="trips-section-title">Aankomend &amp; onderweg</h2>
          <div className="trips-grid">
            {upcoming.map((trip, i) => (
              <TripCard key={trip.id} trip={trip} index={i} onChanged={load} />
            ))}
            <button className="trip-ghost" onClick={() => setShowNew(true)} aria-label="Nieuwe reis">
              <span>+ Nieuwe reis</span>
            </button>
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <h2 className="trips-section-title">Afgelopen reizen</h2>
          <div className="trips-grid">
            {past.map((trip, i) => (
              <TripCard key={trip.id} trip={trip} index={i} onChanged={load} />
            ))}
            {upcoming.length === 0 && (
              <button
                className="trip-ghost"
                onClick={() => setShowNew(true)}
                aria-label="Nieuwe reis"
              >
                <span>+ Nieuwe reis</span>
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function TripCard({ trip, index, onChanged }: { trip: Trip; index: number; onChanged: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(trip.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = trip.ownerId === user?.id;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    await api(`/trips/${trip.id}`, { method: 'PATCH', body: { title: newTitle.trim() } });
    setRenaming(false);
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`"${trip.title}" en alle routes/foto-koppelingen verwijderen?`)) return;
    await api(`/trips/${trip.id}`, { method: 'DELETE' });
    onChanged();
  }

  async function leave() {
    if (!window.confirm(`Reis "${trip.title}" verlaten?`)) return;
    await api(`/trips/${trip.id}/members/${user!.id}`, { method: 'DELETE' });
    onChanged();
  }

  // A <div> with programmatic navigation instead of a <Link>: nesting the
  // rename <form> inside an anchor makes Enter navigate instead of submit.
  return (
    <div
      className="card trip-card"
      style={{ animationDelay: `${index * 40}ms` }}
      role="link"
      tabIndex={0}
      onClick={() => {
        if (!renaming) navigate(`/trips/${trip.id}`);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !renaming) navigate(`/trips/${trip.id}`);
      }}
    >
      <div className="trip-card-cover" style={{ background: coverGradient(trip.id) }}>
        {trip.resolvedCoverId && (
          <AuthImage
            path={`/media/${trip.resolvedCoverId}/thumbnail`}
            alt=""
            className="trip-card-photo"
          />
        )}
        <span className="trip-card-dates">
          {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
        </span>
        <div className="trip-card-menu" ref={menuRef} onClick={stop}>
          <button
            className="trip-menu-btn"
            aria-label="Reis-opties"
            onClick={(e) => {
              stop(e);
              setMenuOpen((v) => !v);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="trip-menu card fade-in">
              {isOwner ? (
                <>
                  <button
                    onClick={(e) => {
                      stop(e);
                      setMenuOpen(false);
                      setRenaming(true);
                    }}
                  >
                    Hernoemen
                  </button>
                  <button
                    className="trip-menu-danger"
                    onClick={(e) => {
                      stop(e);
                      void remove();
                    }}
                  >
                    Verwijderen
                  </button>
                </>
              ) : (
                <button
                  className="trip-menu-danger"
                  onClick={(e) => {
                    stop(e);
                    void leave();
                  }}
                >
                  Reis verlaten
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="trip-card-body">
        {renaming ? (
          <form onSubmit={rename} onClick={stop} className="trip-rename">
            <input
              autoFocus
              value={newTitle}
              onClick={stop}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
            <button className="btn btn-primary" type="submit">
              OK
            </button>
          </form>
        ) : (
          <h2>{trip.title}</h2>
        )}
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
    </div>
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
