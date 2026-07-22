import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import './members.css';

export function MembersPanel({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = trip.ownerId === user?.id;

  async function addMember(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/trips/${trip.id}/members`, { method: 'POST', body: { username } });
      setUsername('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  const canRemove = (memberId: string) => isOwner && memberId !== user?.id;

  async function removeMember(memberId: string, name: string) {
    if (!window.confirm(`${name} uit de reis verwijderen?`)) return;
    await api(`/trips/${trip.id}/members/${memberId}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <section className="members-panel">
      <h2 className="trip-side-heading">Reisgenoten</h2>
      <ul className="members-list">
        {trip.members.map((member) => (
          <li key={member.userId}>
            <Avatar
              userId={member.userId}
              displayName={member.user.displayName}
              hasAvatar={member.user.hasAvatar}
              size={30}
            />
            <span className="members-name">
              {member.user.displayName}
              <small> @{member.user.username}</small>
              {member.role === 'OWNER' && <small> · organisator</small>}
            </span>
            {canRemove(member.userId) && (
              <button
                className="members-remove"
                onClick={() => void removeMember(member.userId, member.user.displayName)}
                title="Verwijderen"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form className="members-add" onSubmit={addMember}>
          <input
            required
            placeholder="@gebruikersnaam"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button className="btn btn-ghost" disabled={busy}>
            + Toevoegen
          </button>
        </form>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
