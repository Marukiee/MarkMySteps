import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import {
  CountryPanel,
  RecentTrips,
  StatGrid,
  TravelStats,
  plural,
} from '../components/TravelStatsView';
import { isLocalMode, travellersTabLabel } from '../lib/localMode';
import './friends.css';

export interface Friend {
  id: string;
  username: string;
  displayName: string;
  hasAvatar: boolean;
  sharedTrips: number;
}

/**
 * Your own travelling, in numbers, plus everyone you did it with.
 *
 * Your figures are the reason to open this page, so they are the page; the
 * companions are a list underneath, each leading to the same thing about them.
 */
export function FriendsPage() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [mine, setMine] = useState<TravelStats | null>(null);
  const local = isLocalMode();

  useEffect(() => {
    if (local) return;
    api<Friend[]>('/users/friends')
      .then(setFriends)
      .catch(() => setFriends([]));
  }, [local]);

  useEffect(() => {
    if (!user) return;
    api<TravelStats>(`/users/${user.id}/stats`)
      .then(setMine)
      .catch(() => undefined);
  }, [user]);

  return (
    <main className="page fade-in friends-page">
      <h1>{travellersTabLabel()}</h1>

      {user && (
        <section className="card stats-hero">
          <header className="stats-hero-head">
            <Avatar
              userId={user.id}
              displayName={user.displayName}
              hasAvatar={user.hasAvatar}
              size={54}
            />
            <div className="stats-hero-name">
              <strong>{user.displayName}</strong>
              {/* Your own row does not need your handle back: you know who you
                  are. What it needs to say is whose numbers these are. */}
              <span className="muted">Jouw statistieken</span>
            </div>
            {!!mine?.ongoing && (
              <span className="stats-ongoing">
                <span className="stats-ongoing-dot" />
                {mine.ongoing === 1 ? 'onderweg' : `${mine.ongoing}× onderweg`}
              </span>
            )}
          </header>
          <StatGrid stats={mine} />
          <CountryPanel countries={mine?.countries ?? null} />
        </section>
      )}

      {mine && <RecentTrips trips={mine.recent} />}

      {!local && (
        <>
          <h2 className="friends-heading">Mensen op je reizen</h2>
          <p className="muted friends-intro">
            Iedereen met wie je een reis deelt, reisgenoot of gast. Toevoegen doe je per reis: open
            een reis, tik het mensen-icoon en vul de @gebruikersnaam in.
          </p>

          {friends?.length === 0 && (
            <div className="card friends-empty">
              <h2>Nog niemand</h2>
              <p className="muted">
                Laat je vrienden een account maken op deze server en voeg ze toe aan een reis.
              </p>
            </div>
          )}

          <div className="friends-grid">
            {friends?.map((friend, i) => (
              <Link
                key={friend.id}
                to={`/friends/${friend.id}`}
                className="card friend-card"
                style={{ animationDelay: `${i * 45}ms` }}
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
                    @{friend.username} · {plural(friend.sharedTrips, 'gedeelde reis', 'gedeelde reizen')}
                  </p>
                </div>
                <Icon name="chevron-right" size={18} className="friend-card-caret" />
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
