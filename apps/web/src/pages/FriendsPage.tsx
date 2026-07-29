import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Icon, IconName } from '../components/Icon';
import { flagEmoji } from '../lib/colors';
import { useExit } from '../lib/useExit';
import './friends.css';

interface Friend {
  id: string;
  username: string;
  displayName: string;
  hasAvatar: boolean;
  sharedTrips: number;
}

export interface TravelStats {
  trips: number;
  ongoing: number;
  days: number;
  countries: string[];
  distanceKm: number;
  photoCount: number;
  recent: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    color: string | null;
  }[];
}

/**
 * Everyone you travel with, and what that adds up to.
 *
 * Your own numbers sit at the top, because they are the ones you came for; a
 * companion's are one tap away, in a sheet rather than a page, so you never
 * lose your place in the list.
 */
export function FriendsPage() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [mine, setMine] = useState<TravelStats | null>(null);
  const [open, setOpen] = useState<Friend | null>(null);

  useEffect(() => {
    api<Friend[]>('/users/friends').then(setFriends).catch(() => setFriends([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    api<TravelStats>(`/users/${user.id}/stats`).then(setMine).catch(() => undefined);
  }, [user]);

  return (
    <main className="page fade-in friends-page">
      <h1>Reizigers</h1>

      {user && (
        <section className="card stats-hero">
          <header className="stats-hero-head">
            <Avatar
              userId={user.id}
              displayName={user.displayName}
              hasAvatar={user.hasAvatar}
              size={52}
            />
            <div className="stats-hero-name">
              <strong>{user.displayName}</strong>
              <span className="muted">@{user.username}</span>
            </div>
            {!!mine?.ongoing && (
              <span className="stats-ongoing">
                <span className="stats-ongoing-dot" />
                {mine.ongoing === 1 ? 'onderweg' : `${mine.ongoing}× onderweg`}
              </span>
            )}
          </header>
          <StatGrid stats={mine} big />
          {mine && mine.countries.length > 0 && <CountryRow countries={mine.countries} />}
        </section>
      )}

      <h2 className="friends-heading">Reisgenoten</h2>
      <p className="muted friends-intro">
        Iedereen met wie je een reis deelt. Toevoegen doe je per reis: open een reis, tik het
        mensen-icoon en vul de @gebruikersnaam in.
      </p>

      {friends?.length === 0 && (
        <div className="card friends-empty">
          <h2>Nog geen reisgenoten</h2>
          <p className="muted">
            Laat je vrienden een account maken op deze server en voeg ze toe aan een reis.
          </p>
        </div>
      )}

      <div className="friends-grid">
        {friends?.map((friend, i) => (
          <button
            key={friend.id}
            type="button"
            className="card friend-card"
            style={{ animationDelay: `${i * 45}ms` }}
            onClick={() => setOpen(friend)}
          >
            <Avatar
              userId={friend.id}
              displayName={friend.displayName}
              hasAvatar={friend.hasAvatar}
              size={44}
            />
            <div className="friend-card-body">
              <strong>{friend.displayName}</strong>
              <p className="muted">
                @{friend.username} · {friend.sharedTrips} gedeelde reis
                {friend.sharedTrips === 1 ? '' : 'zen'}
              </p>
            </div>
            <Icon name="chevron-right" size={18} className="friend-card-caret" />
          </button>
        ))}
      </div>

      <FriendSheet friend={open} onClose={() => setOpen(null)} />
    </main>
  );
}

/** One traveller's numbers, in a sheet over the list. */
function FriendSheet({ friend, onClose }: { friend: Friend | null; onClose: () => void }) {
  const [mounted, closing] = useExit(friend !== null, 240);
  const [stats, setStats] = useState<TravelStats | null>(null);
  // Held, so the sheet keeps its contents while it animates away.
  const [shown, setShown] = useState<Friend | null>(friend);

  useEffect(() => {
    if (!friend) return;
    setShown(friend);
    setStats(null);
    api<TravelStats>(`/users/${friend.id}/stats`).then(setStats).catch(() => undefined);
  }, [friend]);

  useEffect(() => {
    if (!friend) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // Back closes the profile rather than leaving the page.
    window.history.pushState({ mmsFriend: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      if (!popped) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friend]);

  if (!mounted || !shown) return null;

  return (
    <div className={`fs-layer ${closing ? 'closing' : ''}`}>
      <div className="fs-scrim" onClick={onClose} />
      <div className="fs-sheet" role="dialog" aria-modal="true" aria-label={shown.displayName}>
        <div className="fs-grab" aria-hidden="true" />
        <header className="fs-head">
          <Avatar
            userId={shown.id}
            displayName={shown.displayName}
            hasAvatar={shown.hasAvatar}
            size={64}
          />
          <strong>{shown.displayName}</strong>
          <span className="muted">@{shown.username}</span>
          <span className="fs-shared">
            {shown.sharedTrips} reis{shown.sharedTrips === 1 ? '' : 'zen'} samen
          </span>
        </header>

        <StatGrid stats={stats} />
        {stats && stats.countries.length > 0 && <CountryRow countries={stats.countries} />}

        {stats && stats.recent.length > 0 && (
          <section className="fs-recent">
            <h3>Laatste reizen</h3>
            <ul>
              {stats.recent.map((trip, i) => (
                <li key={trip.id} style={{ animationDelay: `${i * 50}ms` }}>
                  <Link to={`/trips/${trip.id}`} onClick={onClose}>
                    <span
                      className="fs-recent-dot"
                      style={{ background: trip.color ?? 'var(--accent)' }}
                    />
                    <span className="fs-recent-name">
                      <strong>{trip.title}</strong>
                      <small>
                        {new Date(trip.startDate).toLocaleDateString('nl-NL', {
                          month: 'long',
                          year: 'numeric',
                        })}
                      </small>
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button className="btn btn-ghost fs-close" onClick={onClose}>
          Sluiten
        </button>
      </div>
    </div>
  );
}

const TILES: {
  key: 'trips' | 'days' | 'distanceKm' | 'photoCount';
  label: string;
  icon: IconName;
  format?: (v: number) => string;
}[] = [
  { key: 'trips', label: 'reizen', icon: 'compass' },
  { key: 'days', label: 'dagen op reis', icon: 'hourglass' },
  { key: 'distanceKm', label: 'kilometer', icon: 'pin', format: (v) => v.toLocaleString('nl-NL') },
  { key: 'photoCount', label: "foto's", icon: 'camera' },
];

/**
 * The numbers. Each tile counts up on arrival rather than appearing at its
 * final value — a number that lands reads as an achievement; one that was
 * simply there reads as a label.
 */
function StatGrid({ stats, big }: { stats: TravelStats | null; big?: boolean }) {
  return (
    <div className={`stat-grid ${big ? 'stat-grid-big' : ''}`}>
      {TILES.map((tile, i) => (
        <div key={tile.key} className="stat-tile" style={{ animationDelay: `${i * 60}ms` }}>
          <span className="stat-tile-icon">
            <Icon name={tile.icon} size={16} />
          </span>
          <strong>
            {stats ? (
              <CountUp value={stats[tile.key]} format={tile.format} />
            ) : (
              <span className="stat-skeleton" />
            )}
          </strong>
          <small>{tile.label}</small>
        </div>
      ))}
      <div className="stat-tile" style={{ animationDelay: '240ms' }}>
        <span className="stat-tile-icon">
          <Icon name="people" size={16} />
        </span>
        <strong>
          {stats ? <CountUp value={stats.countries.length} /> : <span className="stat-skeleton" />}
        </strong>
        <small>landen</small>
      </div>
    </div>
  );
}

/** Counts from zero to `value`, eased out. */
function CountUp({ value, format }: { value: number; format?: (v: number) => string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (value <= 0) {
      setShown(0);
      return;
    }
    const DURATION = 900;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      // Ease-out cubic: quick at first, settling onto the real number.
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format ? format(shown) : shown}</>;
}

/** Flags of every country visited. */
function CountryRow({ countries }: { countries: string[] }) {
  return (
    <div className="country-row">
      {countries.map((code, i) => (
        <span key={code} className="country-flag" style={{ animationDelay: `${i * 35}ms` }}>
          {flagEmoji(code) || code}
        </span>
      ))}
    </div>
  );
}
