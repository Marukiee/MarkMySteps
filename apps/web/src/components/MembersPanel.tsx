import { useState } from 'react';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { confirmModal } from './confirm';
import { Icon } from './Icon';
import { MemberAdd } from './MemberAdd';
import { t } from '../i18n';
import './members.css';

export function MembersPanel({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = trip.ownerId === user?.id;

  async function addMembers(usernames: string[], role: 'MEMBER' | 'GUEST') {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Trip>(`/trips/${trip.id}/members`, {
        method: 'POST',
        body: { usernames },
      });
      // Everyone arrives as a reisgenoot; a guest is that same membership with
      // its role turned down straight afterwards. Done here rather than in the
      // request so an older server still accepts the call.
      if (role === 'GUEST') {
        const wanted = new Set(usernames.map((u) => u.toLowerCase().replace(/^@/, '')));
        await Promise.all(
          updated.members
            .filter((m) => wanted.has(m.user.username.toLowerCase()))
            .map((m) =>
              api(`/trips/${trip.id}/members/${m.userId}`, {
                method: 'PATCH',
                body: { role: 'GUEST' },
              }),
            ),
        );
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('trips.members.addFailed'));
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
      title: t('trips.members.removeTitle'),
      body: t('trips.members.removeBody', { name }),
      confirmLabel: t('trips.members.remove'),
      danger: true,
    });
    if (!ok) return;
    await api(`/trips/${trip.id}/members/${memberId}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <section className="members-panel">
      <h2 className="trip-side-heading">{t('trips.members.title')}</h2>
      {/* Said once, here, because the difference only matters when you are
          choosing between the two. */}
      <p className="muted members-hint">{t('trips.members.hint')}</p>
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
              {member.role === 'OWNER' && <small> · {t('trips.members.role.owner')}</small>}
              {member.role === 'GUEST' && <small> · {t('trips.members.role.guest')}</small>}
              {member.role === 'MEMBER' && <small> · {t('trips.members.role.member')}</small>}
            </span>
            {canRemove(member.userId) && (
              <button
                className="members-remove"
                onClick={() => void removeMember(member.userId, member.user.displayName)}
                aria-label={t('trips.members.remove')}
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
                    {t('trips.members.companion')}
                  </button>
                  <button
                    className={member.role === 'GUEST' ? 'active' : ''}
                    onClick={() => void setMember(member.userId, { role: 'GUEST' })}
                  >
                    {t('trips.members.guest')}
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
                      {t('trips.members.canTrack')}
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
