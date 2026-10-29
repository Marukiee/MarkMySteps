import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { DateRangeSheet } from './DatePicker';
import { formatDateRange } from '../lib/colors';
import { confirmModal } from './confirm';
import { Icon } from './Icon';
import { MemberAdd } from './MemberAdd';
import { nativeMenusAvailable, showNativeMenu } from '../lib/nativeMenu';
import { t } from '../i18n';
import './members.css';

type Member = Trip['members'][number];

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

  async function setMember(
    memberId: string,
    patch: { role?: 'MEMBER' | 'GUEST'; canTrack?: boolean; fromDate?: string | null; toDate?: string | null },
  ) {
    setError(null);
    try {
      await api(`/trips/${trip.id}/members/${memberId}`, { method: 'PATCH', body: patch });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'));
    }
  }

  // Whose days are being picked: the calendar sheet is one for the panel.
  const [daysFor, setDaysFor] = useState<string | null>(null);
  // Whose menu is open on the page (not on the iPhone, which has its own).
  const [menuFor, setMenuFor] = useState<{ id: string; at: DOMRect } | null>(null);
  const tripFrom = trip.startDate.slice(0, 10);
  const tripTo = trip.endDate.slice(0, 10);
  const partial = (m: Member) => !!(m.fromDate || m.toDate);
  const daysLabel = (m: Member) =>
    partial(m) ? formatDateRange(m.fromDate ?? tripFrom, m.toDate ?? tripTo) : t('trips.members.wholeTrip');

  // Who travelled first, then who only follows along: the organiser, the
  // companions, the guests, each group by name. By name rather than as the
  // server sends them, which changed with every edit and made rows swap.
  const ORDER = { OWNER: 0, MEMBER: 1, GUEST: 2 } as const;
  const members = [...trip.members].sort(
    (a, b) =>
      ORDER[a.role] - ORDER[b.role] ||
      a.user.displayName.localeCompare(b.user.displayName) ||
      a.user.username.localeCompare(b.user.username),
  );

  /** The line under a name: what they are on this trip, in a few words. */
  const subtitle = (m: Member) =>
    [
      m.role === 'OWNER'
        ? t('trips.members.role.owner')
        : m.role === 'GUEST'
          ? t('trips.members.role.guest')
          : t('trips.members.role.member'),
      m.role !== 'GUEST' && partial(m) ? daysLabel(m) : null,
      m.role === 'MEMBER' && !m.canTrack ? t('trips.members.noTracking') : null,
    ]
      .filter(Boolean)
      .join(' · ');

  /** What can be done with someone, from the ⋯ beside their name. */
  async function act(m: Member, action: string) {
    if (action === 'MEMBER' || action === 'GUEST') {
      if (action !== m.role) await setMember(m.userId, { role: action });
    } else if (action === 'track') {
      await setMember(m.userId, { canTrack: !m.canTrack });
    } else if (action === 'days') {
      setDaysFor(m.userId);
    } else if (action === 'remove') {
      await removeMember(m.userId, m.user.displayName);
    }
  }

  function openMenu(m: Member, button: HTMLElement) {
    if (!nativeMenusAvailable()) {
      setMenuFor({ id: m.userId, at: button.getBoundingClientRect() });
      return;
    }
    const isOrganiser = m.role === 'OWNER';
    const sections = [
      ...(isOrganiser
        ? []
        : [
            [
              { id: 'MEMBER', title: t('trips.members.companion'), checked: m.role === 'MEMBER' },
              { id: 'GUEST', title: t('trips.members.guest'), checked: m.role === 'GUEST' },
            ],
          ]),
      [
        ...(m.role === 'MEMBER'
          ? [{ id: 'track', title: t('trips.members.trackItem'), symbol: 'location', checked: m.canTrack }]
          : []),
        ...(m.role !== 'GUEST'
          ? [{ id: 'days', title: t('trips.members.daysItem'), subtitle: daysLabel(m), symbol: 'calendar' }]
          : []),
      ],
      ...(canRemove(m.userId)
        ? [[{ id: 'remove', title: t('trips.members.remove'), symbol: 'trash', destructive: true }]]
        : []),
    ].filter((section) => section.length > 0);
    showNativeMenu(button, sections, m.user.displayName)
      .then((id) => id && void act(m, id))
      .catch(() => setMenuFor({ id: m.userId, at: button.getBoundingClientRect() }));
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
        {members.map((member) => (
          <li key={member.userId} className={member.role === 'GUEST' ? 'is-guest' : ''}>
            <Avatar
              userId={member.userId}
              displayName={member.user.displayName}
              hasAvatar={member.user.hasAvatar}
              size={36}
            />
            <span className="members-who">
              <span className="members-name">
                {member.user.displayName}
                <small> @{member.user.username}</small>
              </span>
              <span className={`members-sub ${member.role !== 'GUEST' && partial(member) ? 'partial' : ''}`}>
                {subtitle(member)}
              </span>
            </span>
            {/* Everything about one person sits behind their ⋯: the role, the
                tracking, the days they were there, taking them off the trip.
                The row itself stays one name and one line. */}
            {isOwner && (
              <button
                type="button"
                className="members-more"
                aria-label={t('trips.members.more', { name: member.user.displayName })}
                onClick={(e) => openMenu(member, e.currentTarget)}
              >
                <Icon name="dots" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {menuFor &&
        (() => {
          const member = trip.members.find((m) => m.userId === menuFor.id);
          if (!member) return null;
          return (
            <MemberMenu
              member={member}
              at={menuFor.at}
              daysText={daysLabel(member)}
              canRemove={canRemove(member.userId)}
              onClose={() => setMenuFor(null)}
              onAct={(action) => void act(member, action)}
            />
          );
        })()}

      {daysFor &&
        (() => {
          const member = trip.members.find((m) => m.userId === daysFor);
          if (!member) return null;
          return (
            <DateRangeSheet
              from={member.fromDate ?? tripFrom}
              to={member.toDate ?? tripTo}
              min={tripFrom}
              max={tripTo}
              resetLabel={t('trips.members.wholeTrip')}
              onClose={() => setDaysFor(null)}
              onPick={(from, to) => {
                setDaysFor(null);
                void setMember(member.userId, { fromDate: from || null, toDate: to || null });
              }}
            />
          );
        })()}

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

/**
 * The ⋯ menu for one person, on the page (the iPhone opens its own). The
 * same look as a trip card's menu: role as a segment on top, then what can
 * be switched or set, then taking them off the trip in red.
 */
function MemberMenu({
  member,
  at,
  daysText,
  canRemove,
  onClose,
  onAct,
}: {
  member: Member;
  at: DOMRect;
  daysText: string;
  canRemove: boolean;
  onClose: () => void;
  onAct: (action: string) => void;
}) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 150);
  };
  const pick = (action: string) => {
    close();
    onAct(action);
  };

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.('.member-menu')) close();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opens on top of the ⋯, growing upward when there is no room below.
  const up = at.bottom + 240 > window.innerHeight;
  const right = Math.max(8, window.innerWidth - at.right);
  const style = up ? { bottom: window.innerHeight - at.bottom, right } : { top: at.top, right };

  return createPortal(
    <div className={`member-menu card ${up ? 'up' : ''} ${closing ? 'closing' : ''}`} style={style}>
      {member.role !== 'OWNER' && (
        <div className="member-role-seg" data-role={member.role}>
          <span className="member-role-thumb" aria-hidden="true" />
          <button className={member.role === 'MEMBER' ? 'active' : ''} onClick={() => onAct('MEMBER')}>
            {t('trips.members.companion')}
          </button>
          <button className={member.role === 'GUEST' ? 'active' : ''} onClick={() => onAct('GUEST')}>
            {t('trips.members.guest')}
          </button>
        </div>
      )}
      {member.role === 'MEMBER' && (
        <button type="button" onClick={() => onAct('track')}>
          <Icon name="locate" size={17} />
          <span>{t('trips.members.trackItem')}</span>
          {member.canTrack && <Icon name="check" size={17} className="member-menu-check" />}
        </button>
      )}
      {member.role !== 'GUEST' && (
        <button type="button" onClick={() => pick('days')}>
          <Icon name="calendar" size={17} />
          <span>{t('trips.members.daysItem')}</span>
          <small>{daysText}</small>
        </button>
      )}
      {canRemove && (
        <button type="button" className="member-menu-danger" onClick={() => pick('remove')}>
          <Icon name="trash" size={17} />
          <span>{t('trips.members.remove')}</span>
        </button>
      )}
    </div>,
    document.body,
  );
}
