import { CSSProperties, FormEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { Avatar } from '../components/Avatar';
import { confirmModal } from '../components/confirm';
import { DateField } from '../components/DatePicker';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { LogoMark } from '../components/Logo';
import { Icon } from '../components/Icon';
import { coverGradient, formatDate, tripCoverBg } from '../lib/colors';
import {
  getShowSelfOnHome,
  getTripCardOverride,
  isTripCompact,
  setTripCardOverride,
} from '../lib/prefs';
import { canEditTrip } from '../lib/perm';
import { onTrackerChange } from '../tracking/tracker';
import './trips.css';

export function TripsPage() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newClosing, setNewClosing] = useState(false);
  // The wordmark's compass follows the globe's zoom: in one way, out the
  // other, and back to north whenever the globe is back where it started.
  // Written straight to the element, because this arrives at frame rate and
  // has no business re-rendering the page.
  const needleRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const onScale = (e: Event) => {
      const scale = (e as CustomEvent<number>).detail;
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${(scale - 1) * 660}deg)`;
      }
    };
    window.addEventListener('mms-globe-scale', onScale);
    return () => window.removeEventListener('mms-globe-scale', onScale);
  }, []);

  // The form collapses away instead of vanishing, so the sections below slide
  // back up rather than jumping.
  const closeNew = () => {
    setNewClosing(true);
    window.setTimeout(() => {
      setShowNew(false);
      setNewClosing(false);
    }, 260);
  };
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'past' | 'friends'>('past');
  /** Which side the incoming panel slides in from: 1 = from the right. */
  const [tabDir, setTabDir] = useState(1);
  const switchTab = (next: 'past' | 'friends') => {
    if (next === tab) return;
    setTabDir(next === 'friends' ? 1 : -1);
    setTab(next);
  };
  // Bumped when a card switches size; the layout is read back from localStorage.
  const [, setSizeTick] = useState(0);
  // Own position on the globe — opt-in, and only ever from the tracker (the page
  // never asks the browser for a location).
  const [self, setSelf] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!getShowSelfOnHome()) return;
    return onTrackerChange((s) => {
      setSelf(s.lastFix ? [s.lastFix.lng, s.lastFix.lat] : null);
    });
  }, []);

  /** Switch one card between large and compact. */
  function applySize(id: string, value: 'large' | 'compact' | null) {
    setTripCardOverride(id, value);
    setSizeTick((t) => t + 1);
  }

  function load() {
    api<Trip[]>('/trips')
      .then(setTrips)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  const today = new Date().toISOString().slice(0, 10);
  // Yours = the ones you travelled, as organiser or reisgenoot. A trip you were
  // invited to look at is somebody else's, and gets its own tab.
  const mine = (trips ?? []).filter((t) => canEditTrip(t, user?.id));
  const friends = (trips ?? []).filter((t) => !canEditTrip(t, user?.id));
  const startedFirst = (a: Trip, b: Trip) => {
    const aStarted = a.startDate.slice(0, 10) <= today ? 0 : 1;
    const bStarted = b.startDate.slice(0, 10) <= today ? 0 : 1;
    if (aStarted !== bStarted) return aStarted - bStarted;
    return a.startDate.localeCompare(b.startDate);
  };
  // Ongoing trips (already started, not finished) are the most relevant → they
  // sort above trips that haven't begun yet.
  const upcoming = mine.filter((t) => t.endDate.slice(0, 10) >= today).sort(startedFirst);
  const past = mine.filter((t) => t.endDate.slice(0, 10) < today);
  // Somebody who is away right now is the reason you opened this tab.
  const friendTrips = [...friends].sort((a, b) => {
    const aOver = a.endDate.slice(0, 10) < today ? 1 : 0;
    const bOver = b.endDate.slice(0, 10) < today ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;
    return aOver ? b.startDate.localeCompare(a.startDate) : startedFirst(a, b);
  });
  // The globe is where YOU have been — guests' trips draw no route on it.
  const myGlobeTrips = mine;

  // Which of the two lower tabs is open, and which way it came in. Opens on the
  // friends' tab when you have nothing finished of your own but they do, so the
  // section is never an empty panel under a pill you have to find first.
  const tabTrips = tab === 'past' ? past : friendTrips;
  const hasPast = past.length > 0;
  const hasFriends = friendTrips.length > 0;
  useEffect(() => {
    if (!hasPast && hasFriends) setTab('friends');
  }, [hasPast, hasFriends]);

  return (
    <main className="page fade-in trips-page">
      {/* The wordmark sits in the globe's own box, which is the thing that
          actually reaches the top of the screen — positioning it against the
          page put it below the page's padding instead. On a wide window the top
          bar already carries the brand, so this only shows where that bar is
          gone (phone, and the app). */}
      <div className="trips-globe">
        <GlobeBackdrop trips={myGlobeTrips} selfLocation={self} />
        <span className="trips-brand" aria-label="MarkMySteps">
          <LogoMark size={40} needleRef={needleRef} />
          <span>MarkMySteps</span>
        </span>
      </div>

      <div className="trips-head">
        <h1>Reizen</h1>
        <button
          className="btn btn-primary"
          onClick={() => (showNew ? closeNew() : setShowNew(true))}
        >
          {showNew && !newClosing ? 'Annuleren' : '+ Nieuwe reis'}
        </button>
      </div>

      {showNew && (
        <div className={`new-trip-wrap ${newClosing ? 'closing' : ''}`}>
          <div>
            <NewTripForm
              onCreated={() => {
                closeNew();
                load();
              }}
            />
          </div>
        </div>
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
                  key={trip.id}
                  trip={trip}
                  index={i}
                  onChanged={load}
                  onResize={applySize}
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

      {(past.length > 0 || friendTrips.length > 0) && (
        <>
          {/* The heading was a heading; now it is the choice between your own
              finished trips and the ones you were invited to watch. One pill
              slides between the two, and the grid under it slides the way you
              moved — left tab from the left, right tab from the right. */}
          <div className="trips-tabs" role="tablist" data-tab={tab}>
            <span className="trips-tabs-thumb" aria-hidden="true" />
            <button
              role="tab"
              aria-selected={tab === 'past'}
              className={tab === 'past' ? 'active' : ''}
              onClick={() => switchTab('past')}
            >
              Afgelopen reizen
              {past.length > 0 && <small>{past.length}</small>}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'friends'}
              className={tab === 'friends' ? 'active' : ''}
              onClick={() => switchTab('friends')}
            >
              Van vrienden
              {friendTrips.length > 0 && <small>{friendTrips.length}</small>}
            </button>
          </div>

          <div className="trips-panel" key={tab} data-dir={tabDir}>
            {tabTrips.length === 0 ? (
              <p className="muted trips-tab-empty">
                {tab === 'past'
                  ? 'Nog geen afgelopen reizen.'
                  : 'Nog niemand heeft een reis met je gedeeld.'}
              </p>
            ) : (
              <div className="trips-grid">
                {tabTrips.map((trip, i) => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    index={i}
                    onChanged={load}
                    onResize={applySize}
                    compact={isTripCompact(trip.id, true)}
                  />
                ))}
                {tab === 'past' && upcoming.length === 0 && (
                  <button
                    className="trip-ghost"
                    onClick={() => setShowNew(true)}
                    aria-label="Nieuwe reis"
                  >
                    <span>+ Nieuwe reis</span>
                  </button>
                )}
              </div>
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
  onResize,
  compact = false,
}: {
  trip: Trip;
  index: number;
  onChanged: () => void;
  onResize: (id: string, value: 'large' | 'compact' | null) => void;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  /** Where the menu sits against the viewport (it is portalled out of the card,
   *  which clips its own contents when it has a cover photo). */
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(trip.title);
  const renameRef = useRef<HTMLFormElement>(null);
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

  // Tapping anywhere else abandons a rename, the same way the ⋯ menu closes.
  useEffect(() => {
    if (!renaming) return;
    const close = (e: Event) => {
      if (!renameRef.current?.contains(e.target as Node)) cancelRename();
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming]);

  function cancelRename() {
    setRenaming(false);
    // Discard the half-typed title, or reopening shows it again.
    setNewTitle(trip.title);
  }

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
      body: `"${trip.title}" wordt definitief verwijderd, samen met de route, de notities en de foto-koppelingen. Dit kan niet ongedaan gemaakt worden.`,
      confirmLabel: 'Verwijderen',
      danger: true,
      typeToConfirm: trip.title,
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
    // The menu stays open: you are looking at three sizes and you may well want
    // to see the other two. It closes when you click away, like any menu.
    onResize(trip.id, v);
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
  // An ongoing trip (started, not finished) gets its own "onderweg" pill in the
  // same spot as the countdown — those are mutually exclusive.
  const todayStr = new Date().toISOString().slice(0, 10);
  const ongoing =
    trip.startDate.slice(0, 10) <= todayStr && trip.endDate.slice(0, 10) >= todayStr;
  // On somebody else's trip the pill says who is away — "onderweg" on a card
  // you are only watching read as though you were the one travelling.
  // A reisgenoot is away too, so this is about guests only.
  const travellerName = canEditTrip(trip, user?.id)
    ? null
    : trip.members.find((m) => m.userId === trip.ownerId)?.user.displayName ?? null;
  const statusEl = ongoing ? (
    <span className="trip-countdown trip-ongoing">
      <span className="trip-ongoing-dot" />
      {travellerName ? `${travellerName} is onderweg` : 'onderweg'}
    </span>
  ) : (
    countdown && (
      <span className="trip-countdown">
        <Icon name="hourglass" size={13} />
        {countdown}
      </span>
    )
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
            // A card with a cover clips its own contents, so the menu is
            // rendered against the viewport instead — anchored to the button.
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            // Anchored to the button's own corner, so the menu opens ON TOP of
            // the ⋯ rather than hanging below it.
            const up = r.bottom + 260 > window.innerHeight;
            setMenuUp(up);
            setMenuAt({
              top: up ? r.bottom : r.top,
              right: Math.max(8, window.innerWidth - r.right),
            });
            window.dispatchEvent(new CustomEvent('mms-menu-open', { detail: trip.id }));
            setMenuOpen(true);
          }
        }}
      >
        <Icon name="dots" size={22} />
      </button>
      {menuOpen &&
        menuAt &&
        createPortal(
        <div
          className={`trip-menu card ${menuUp ? 'up' : ''} ${menuClosing ? 'closing' : ''}`}
          style={
            menuUp
              ? { bottom: window.innerHeight - menuAt.top, right: menuAt.right }
              : { top: menuAt.top, right: menuAt.right }
          }
          onClick={stop}
        >
          <div
            className="trip-menu-seg pill-switch"
            onClick={stop}
            style={
              {
                '--n': 3,
                '--i': ['auto', 'large', 'compact'].indexOf(getTripCardOverride(trip.id) ?? 'auto'),
              } as CSSProperties
            }
          >
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
                  {opt === 'auto' ? 'Auto' : opt === 'large' ? 'Groot' : 'Klein'}
                </button>
              );
            })}
          </div>
          {isOwner && (
            <>
              <button
                onClick={(e) => {
                  stop(e);
                  closeMenu();
                  navigate(`/trips/${trip.id}/settings`);
                }}
              >
                Instellingen
              </button>
              <button
                onClick={(e) => {
                  stop(e);
                  closeMenu();
                  setRenaming(true);
                }}
              >
                Hernoemen
              </button>
              <button
                className="trip-menu-danger"
                onClick={(e) => {
                  stop(e);
                  closeMenu();
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
                closeMenu();
                void leave();
              }}
            >
              Reis verlaten
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );

  // Compact: a slim row — meta on the left, small photo on the right.
  if (compact) {
    return (
      <div
        className={`trip-card-compact ${trip.resolvedCoverId ? 'has-cover' : ''}`}
        style={{
          animationDelay: `${index * 30}ms`,
          zIndex: menuOpen || menuClosing ? 30 : undefined,
        }}
        role="link"
        tabIndex={0}
        onClick={() => !renaming && navigate(`/trips/${trip.id}`)}
        onKeyDown={(e) => e.key === 'Enter' && !renaming && navigate(`/trips/${trip.id}`)}
      >
        {trip.resolvedCoverId && (
          <div className="tcc-bg" aria-hidden="true">
            <AuthImage
              path={`/media/${trip.resolvedCoverId}/thumbnail`}
              alt=""
              className="tcc-bg-img"
            />
            <span className="tcc-bg-scrim" />
          </div>
        )}
        {/* No cover yet (an upcoming trip) → no thumbnail slot at all. A block of
            gradient standing in for a photo reads as a broken image. */}
        {trip.resolvedCoverId && (
          <AuthImage path={`/media/${trip.resolvedCoverId}/thumbnail`} alt="" className="tcc-photo" />
        )}
        <div className="tcc-body">
          {renaming ? (
            <form ref={renameRef} onSubmit={rename} onClick={stop} className="trip-rename">
              <input
                autoFocus
                value={newTitle}
                onClick={stop}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') cancelRename();
                }}
              />
              <button
                type="button"
                className="trip-rename-cancel"
                aria-label="Annuleren"
                onClick={(e) => {
                  stop(e);
                  cancelRename();
                }}
              >
                <Icon name="close" size={16} />
              </button>
              <button className="btn btn-primary trip-rename-ok" type="submit">
                <Icon name="check" size={16} />
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
          {statusEl}
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
        background: noImg ? tripCoverBg(trip) : coverGradient(trip.id),
        zIndex: menuOpen || menuClosing ? 30 : undefined,
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
      {statusEl}
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
          <TripCardMembers members={trip.members} ownerId={trip.ownerId} />
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
      <DateField
        id="nt-end"
        label="Tot"
        value={endDate}
        nearDate={startDate}
        onChange={setEndDate}
      />
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

/** At most two avatars, stacked tight; any extras collapse to a +N chip. */
function TripCardMembers({
  members,
  ownerId,
}: {
  members: Trip['members'];
  ownerId: string;
}) {
  const sorted = [...members].sort((a, b) =>
    a.userId === ownerId ? -1 : b.userId === ownerId ? 1 : 0,
  );
  const visible = sorted.slice(0, 2);
  const extra = sorted.length - visible.length;

  return (
    <div className="trip-card-members">
      {visible.map((m, i) => (
        <Avatar
          key={m.userId}
          userId={m.userId}
          displayName={m.user.displayName}
          hasAvatar={m.user.hasAvatar}
          size={26}
          className="member-dot"
          style={{ zIndex: visible.length - i }}
        />
      ))}
      {extra > 0 && <span className="member-more">+{extra}</span>}
    </div>
  );
}

