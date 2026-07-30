import { useState } from 'react';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { confirmModal } from './confirm';
import { Icon } from './Icon';
import { MemberAdd } from './MemberAdd';
import './members.css';

export function MembersPanel({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = trip.ownerId === user?.id;

  async function addMembers(usernames: string[]) {
    setBusy(true);
    setError(null);
    try {
      await api(`/trips/${trip.id}/members`, { method: 'POST', body: { usernames } });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  const canRemove = (memberId: string) => isOwner && memberId !== user?.id;

  async function setMember(memberId: string, patch: { role?: 'MEMBER' | 'GUEST'; canTrack?: boolean }) {
    await api(`/trips/${trip.id}/members/${memberId}`, { method: 'PATCH', body: patch });
    onChanged();
  }

  async function removeMember(memberId: string, name: string) {
    const ok = await confirmModal({
      title: 'Reisgenoot verwijderen?',
      body: `${name} wordt uit de reis verwijderd.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    });
    if (!ok) return;
    await api(`/trips/${trip.id}/members/${memberId}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <section className="members-panel">
      <h2 className="trip-side-heading">Mensen</h2>
      {/* Said once, here, because the difference only matters when you are
          choosing between the two. */}
      <p className="muted members-hint">
        Reisgenoten waren erbij en tellen de reis mee in hun statistieken. Gasten kijken alleen
        mee: voor hen telt deze reis niet.
      </p>
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
              {member.role === 'GUEST' && <small> · gast</small>}
              {member.role === 'MEMBER' && <small> · reisgenoot</small>}
            </span>
            {canRemove(member.userId) && (
              <button
                className="members-remove"
                onClick={() => void removeMember(member.userId, member.user.displayName)}
                aria-label="Verwijderen"
              >
                <Icon name="close" size={15} />
              </button>
            )}

            {isOwner && member.role !== 'OWNER' && (
              <div className="member-controls">
                <div className="member-role-seg" data-role={member.role}>
                  {/* The highlight is one element that slides, so switching
                      role reads as a move rather than two separate repaints. */}
                  <span className="member-role-thumb" aria-hidden="true" />
                  <button
                    className={member.role === 'MEMBER' ? 'active' : ''}
                    onClick={() => void setMember(member.userId, { role: 'MEMBER' })}
                  >
                    Reisgenoot
                  </button>
                  <button
                    className={member.role === 'GUEST' ? 'active' : ''}
                    onClick={() => void setMember(member.userId, { role: 'GUEST' })}
                  >
                    Gast
                  </button>
                </div>
                {/* A guest cannot track, so the option folds away rather than
                    disappearing between one frame and the next. */}
                <div className="member-track-wrap" data-open={member.role === 'MEMBER'}>
                  <div>
                    <label className="member-track">
                      <input
                        type="checkbox"
                        checked={member.canTrack}
                        disabled={member.role !== 'MEMBER'}
                        onChange={(e) =>
                          void setMember(member.userId, { canTrack: e.target.checked })
                        }
                      />
                      mag tracken
                    </label>
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <MemberAdd
          busy={busy}
          exclude={trip.members.map((m) => m.user.username)}
          onAdd={addMembers}
        />
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
