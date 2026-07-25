import { FormEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { Avatar } from '../components/Avatar';
import { confirmModal } from '../components/confirm';
import { DateField } from '../components/DatePicker';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { Icon } from '../components/Icon';
import { formatDate } from '../lib/colors';
import { getTripCardOverride, isTripCompact, setTripCardOverride } from '../lib/prefs';
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
            {upcoming.map((trip, i) => {
              const c = isTripCompact(trip.id, false);
              return (
                <TripCard
                  key={`${trip.id}-${c ? 'c' : 'l'}`}
                  trip={trip}
                  index={i}
                  onChanged={load}
                  compact={c}
                />
              );
            })}
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
            {past.map((trip, i) => {
              const c = isTripCompact(trip.id, true);
              return (
                <TripCard
                  key={`${trip.id}-${c ? 'c' : 'l'}`}
                  trip={trip}
                  index={i}
                  onChanged={load}
                  compact={c}
                />
              );
            })}
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

function TripCard({
  trip,
  index,
  onChanged,
  compact = false,
}: {
  trip: Trip;
  index: number;
  onChanged: () => void;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(trip.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = trip.ownerId === user?.id;

  // Animate the menu out before unmounting.
  const closeMenu = () => {
    setMenuClosing(true);
    window.setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 150);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) closeMenu();
    };
    // Close on outside click, on scroll, and when another card's menu opens.
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== trip.id) closeMenu();
    };
    document.addEventListener('click', close);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('mms-menu-open', onOther as EventListener);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('mms-menu-open', onOther as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const ok = await confirmModal({
      title: 'Reis verwijderen?',
      body: `"${trip.title}" en alle routes/foto-koppelingen worden verwijderd.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    });
    if (!ok) return;
    await api(`/trips/${trip.id}`, { method: 'DELETE' });
    onChanged();
  }

  async function leave() {
    const ok = await confirmModal({
      title: 'Reis verlaten?',
      body: `Je verlaat "${trip.title}".`,
      confirmLabel: 'Verlaten',
      danger: true,
    });
    if (!ok) return;
    await api(`/trips/${trip.id}/members/${user!.id}`, { method: 'DELETE' });
    onChanged();
  }

  function setSize(v: 'large' | 'compact' | null) {
    setTripCardOverride(trip.id, v);
    setMenuOpen(false);
    onChanged();
  }

  const month = new Date(trip.startDate).toLocaleDateString('nl-NL', { month: 'long' });
  const year = new Date(trip.startDate).getFullYear();
  const days =
    Math.round(
      (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86_400_000,
    ) + 1;

  // Countdown to the START (only for trips that haven't begun). The hourglass +
  // "over N dagen" wording makes clear it's the start, not the trip length.
  const startsInDays = daysUntil(trip.startDate);
  const countdown =
    startsInDays === null
      ? null
      : startsInDays === 0
        ? 'vandaag van start'
        : startsInDays === 1
          ? 'morgen van start'
          : `over ${startsInDays} dagen`;
  const countdownEl = countdown && (
    <span className="trip-countdown">
      <Icon name="hourglass" size={13} />
      {countdown}
    </span>
  );

  const menuEl = (
    <div className="trip-card-menu" ref={menuRef} onClick={stop}>
      <button
        className="trip-menu-btn"
        aria-label="Reis-opties"
        onClick={(e) => {
          stop(e);
          if (menuOpen) closeMenu();
          else {
            window.dispatchEvent(new CustomEvent('mms-menu-open', { detail: trip.id }));
            setMenuOpen(true);
          }
        }}
      >
        <Icon name="dots" size={22} />
      </button>
      {menuOpen && (
        <div className={`trip-menu card ${menuClosing ? 'closing' : ''}`}>
          <div className="trip-menu-seg" onClick={stop}>
            {(['auto', 'large', 'compact'] as const).map((opt) => {
              const cur = getTripCardOverride(trip.id) ?? 'auto';
              return (
                <button
                  key={opt}
                  className={cur === opt ? 'active' : ''}
                  onClick={(e) => {
                    stop(e);
                    setSize(opt === 'auto' ? null : opt);
                  }}
                >
                  {opt === 'auto' ? 'Auto' : opt === 'large' ? 'Groot' : 'Compact'}
                </button>
              );
            })}
          </div>
          {isOwner && (
            <>
              <button
                onClick={(e) => {
                  stop(e);
                  navigate(`/trips/${trip.id}/settings`);
                }}
              >
                Instellingen
              </button>
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
          )}
          {!isOwner && (
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
  );

  // Compact: a slim row — meta on the left, small photo on the right.
  if (compact) {
    return (
      <div
        className="trip-card-compact"
        style={{ animationDelay: `${index * 30}ms`, zIndex: menuOpen ? 30 : undefined }}
        role="link"
        tabIndex={0}
        onClick={() => !renaming && navigate(`/trips/${trip.id}`)}
        onKeyDown={(e) => e.key === 'Enter' && !renaming && navigate(`/trips/${trip.id}`)}
      >
        {trip.resolvedCoverId ? (
          <AuthImage path={`/media/${trip.resolvedCoverId}/thumbnail`} alt="" className="tcc-photo" />
        ) : (
          <div className="tcc-photo" style={{ background: coverGradient(trip.id) }} />
        )}
        <div className="tcc-body">
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
            <h3>{trip.title}</h3>
          )}
          <span className="tcc-meta">
            {month} {year} · {days} dagen
            {trip.distanceKm != null && trip.distanceKm > 0 && (
              <> · {trip.distanceKm.toLocaleString('nl-NL')} km</>
            )}
          </span>
          {countdownEl}
        </div>
        {menuEl}
      </div>
    );
  }

  // Full-bleed photo card (Polarsteps-style): title + meta overlaid, ⋯ top-right.
  const noImg = !trip.resolvedCoverId;
  return (
    <div
      className={`trip-card ${noImg ? 'trip-card-noimg' : ''}`}
      style={{
        animationDelay: `${index * 40}ms`,
        background: noImg ? tripCardBg(trip) : coverGradient(trip.id),
        zIndex: menuOpen ? 30 : undefined,
      }}
      role="link"
      tabIndex={0}
      onClick={() => {
        if (!renaming) navigate(`/trips/${trip.id}`);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !renaming) navigate(`/trips/${trip.id}`);
      }}
    >
      {trip.resolvedCoverId && (
        <AuthImage
          path={`/media/${trip.resolvedCoverId}/thumbnail`}
          alt=""
          className="trip-card-photo"
        />
      )}
      {noImg && (
        <span className="trip-card-glyph" aria-hidden="true">
          <Icon name="compass" size={120} />
        </span>
      )}
      {countdownEl}
      <div className="trip-card-overlay">
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
        <div className="trip-card-meta">
          <div className="tcm">
            <strong>
              {month} <small>{year}</small>
            </strong>
          </div>
          <div className="tcm">
            <strong>
              {days} <small>dagen</small>
            </strong>
          </div>
          {trip.distanceKm != null && trip.distanceKm > 0 && (
            <div className="tcm">
              <strong>
                {trip.distanceKm.toLocaleString('nl-NL')} <small>km</small>
              </strong>
            </div>
          )}
          <div className="trip-card-members">
            {[...trip.members]
              .sort((a, b) =>
                a.userId === trip.ownerId ? -1 : b.userId === trip.ownerId ? 1 : 0,
              )
              .map((m, i, arr) => (
                <Avatar
                  key={m.userId}
                  userId={m.userId}
                  displayName={m.user.displayName}
                  hasAvatar={m.user.hasAvatar}
                  size={28}
                  className="member-dot"
                  // Owner first + earlier avatars stack on top of later ones.
                  style={{ zIndex: arr.length - i }}
                />
              ))}
          </div>
        </div>

        {menuEl}
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
      <DateField id="nt-start" label="Van" value={startDate} onChange={setStartDate} />
      <DateField id="nt-end" label="Tot" value={endDate} onChange={setEndDate} />
      {error && <p className="error-text">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>
        Aanmaken
      </button>
    </form>
  );
}

/** Whole days from today until a trip's start; null once it has started. */
function daysUntil(startDate: string): number | null {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((start.getTime() - today.getTime()) / 86_400_000);
  return diff < 0 ? null : diff;
}

/** Background for a photo-less card: the trip's custom colour as a soft duotone,
 *  else the deterministic warm gradient. */
function tripCardBg(trip: Trip): string {
  if (trip.color) return `linear-gradient(145deg, ${trip.color}, ${trip.color}b0)`;
  return coverGradient(trip.id);
}

/** Deterministic warm gradient per trip — placeholder until hero photos land. */
function coverGradient(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const hue1 = hash % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 45% 72%), hsl(${hue2} 50% 58%))`;
}
