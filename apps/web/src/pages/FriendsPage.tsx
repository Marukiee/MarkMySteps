import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { colorForUser } from '../lib/colors';
import './friends.css';

interface Friend {
  id: string;
  username: string;
  displayName: string;
  sharedTrips: number;
}

export function FriendsPage() {
  const [friends, setFriends] = useState<Friend[] | null>(null);

  useEffect(() => {
    api<Friend[]>('/users/friends').then(setFriends).catch(() => setFriends([]));
  }, []);

  return (
    <main className="page fade-in friends-page">
      <h1>Vrienden</h1>
      <p className="muted">
        Iedereen met wie je een reis deelt. Toevoegen doe je per reis: open een reis → Reisgenoten
        → @gebruikersnaam invullen.
      </p>

      {friends === null && <p className="muted">Laden…</p>}
      {friends?.length === 0 && (
        <div className="card friends-empty">
          <h2>Nog geen reisgenoten</h2>
          <p className="muted">
            Laat je vrienden een account maken op deze server en voeg ze toe aan een reis.
          </p>
        </div>
      )}

      <div className="friends-grid">
        {friends?.map((friend) => (
          <div key={friend.id} className="card friend-card">
            <span className="friend-avatar" style={{ background: colorForUser(friend.id) }}>
              {friend.displayName[0]}
            </span>
            <div>
              <strong>{friend.displayName}</strong>
              <p className="muted">
                @{friend.username} · {friend.sharedTrips} gedeelde reis
                {friend.sharedTrips === 1 ? '' : 'zen'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
