import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { colorForUser } from '../lib/colors';
import './members.css';

export function MembersPanel({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = trip.ownerId === user?.id;

  async function addMember(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/trips/${trip.id}/members`, { method: 'POST', body: { email } });
      setEmail('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

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
            <span className="member-dot" style={{ background: colorForUser(member.userId) }}>
              {member.user.displayName[0]}
            </span>
            <span className="members-name">
              {member.user.displayName}
              {member.userId === user?.id && ' (ik)'}
              {member.role === 'OWNER' && <small> · organisator</small>}
            </span>
            {isOwner && member.userId !== user?.id && (
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
            type="email"
            required
            placeholder="e-mail van je reisgenoot"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn btn-ghost" disabled={busy}>
            + Toevoegen
          </button>
        </form>
      )}
      {error && <p className="error-text">{error}</p>}
      {isOwner && (
        <p className="muted members-hint">
          Je reisgenoot maakt eerst zelf een account aan op deze server; daarna voeg je ze hier toe
          op e-mailadres. Hun route en foto's komen dan in deze reis.
        </p>
      )}
    </section>
  );
}
