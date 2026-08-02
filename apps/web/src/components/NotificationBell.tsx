import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { NotificationItem } from '../api/types';
import { DEMO_NOTIFICATIONS } from '../lib/demoNotifications';
import { useExit } from '../lib/useExit';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import './notifications.css';

/**
 * The bell, and everything under it.
 *
 * Two kinds of line live here. Most are news — somebody put you on a trip —
 * and they go away when you have read them. One is a question: somebody wants
 * onto a trip of yours, and that line stays, unread or not, until you answer
 * it. Answering sends the answer back to them as a line of their own.
 */
export function NotificationBell({ demo = false }: { demo?: boolean }) {
  const [open, setOpen] = useState(demo);
  const [items, setItems] = useState<NotificationItem[] | null>(demo ? DEMO_NOTIFICATIONS : null);
  const [count, setCount] = useState(() =>
    demo ? { unread: 2, pending: 1 } : { unread: 0, pending: 0 },
  );

  const loadCount = useCallback(() => {
    if (demo) return;
    api<{ unread: number; pending: number }>('/notifications/count')
      .then(setCount)
      .catch(() => undefined);
  }, [demo]);

  const loadItems = useCallback(() => {
    if (demo) return;
    api<NotificationItem[]>('/notifications')
      .then(setItems)
      .catch(() => setItems([]));
  }, [demo]);

  useEffect(() => {
    loadCount();
    // Cheap enough to ask now and then: it is two counts, and a request that
    // has been sitting there for an hour is exactly the one you want to see.
    const timer = window.setInterval(loadCount, 90_000);
    return () => window.clearInterval(timer);
  }, [loadCount]);

  useEffect(() => {
    if (!open) return;
    loadItems();
  }, [open, loadItems]);

  /** Opening the list is reading it — except for questions still unanswered. */
  async function openSheet() {
    setOpen(true);
    if (demo) return;
    try {
      await api('/notifications/read', { method: 'POST' });
      loadCount();
    } catch {
      /* offline; the badge simply stays until next time */
    }
  }

  async function answer(requestId: string, approve: boolean) {
    if (demo) {
      // The row says what happened; nothing leaves the phone.
      setCount((c) => ({ ...c, pending: Math.max(0, c.pending - 1) }));
      return;
    }
    // Always as a guest: this is somebody asking to look at a trip, not asking
    // to have travelled on it. Making them a reisgenoot is a separate decision,
    // and it lives where the rest of the roles do — mensen & delen.
    await api(`/access-requests/${requestId}/${approve ? 'approve' : 'deny'}`, {
      method: 'POST',
      body: approve ? { role: 'GUEST' } : undefined,
    });
    loadItems();
    loadCount();
  }

  async function dismiss(id: string) {
    setItems((cur) => cur?.filter((n) => n.id !== id) ?? cur);
    if (demo) return;
    await api(`/notifications/${id}`, { method: 'DELETE' }).catch(() => undefined);
    loadCount();
  }

  const badge = count.unread + count.pending;

  return (
    <>
      <button
        type="button"
        className={`notif-bell ${badge > 0 ? 'has-news' : ''}`}
        aria-label={badge > 0 ? `Meldingen (${badge})` : 'Meldingen'}
        onClick={() => void openSheet()}
      >
        <Icon name="bell" size={20} />
        {/* Stays mounted so the dot can grow in rather than appear. */}
        <span className={`notif-badge ${badge > 0 ? 'on' : ''}`}>
          <span key={badge}>{badge > 9 ? '9+' : badge}</span>
        </span>
      </button>

      <NotificationSheet
        open={open}
        items={items}
        onClose={() => setOpen(false)}
        onAnswer={answer}
        onDismiss={dismiss}
      />
    </>
  );
}

/**
 * The list itself, with no idea where its lines came from.
 *
 * Split out so developer options can open it filled with examples: the design
 * is otherwise only visible when somebody happens to ask for access.
 */
export function NotificationSheet({
  open,
  items,
  onClose,
  onAnswer,
  onDismiss,
}: {
  open: boolean;
  /** null while loading. */
  items: NotificationItem[] | null;
  onClose: () => void;
  onAnswer: (requestId: string, approve: boolean) => Promise<void>;
  onDismiss: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [shown, closing] = useExit(open, 260);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Requests answered in this sheet, so the row can say so straight away. */
  const [answered, setAnswered] = useState<Record<string, 'in' | 'out'>>({});

  async function answer(requestId: string, approve: boolean) {
    setBusy(requestId);
    setError(null);
    try {
      // Shows the outcome on the row before the list is fetched again, so the
      // buttons are replaced by an answer rather than by a flicker.
      setAnswered((cur) => ({ ...cur, [requestId]: approve ? 'in' : 'out' }));
      await onAnswer(requestId, approve);
    } catch (err) {
      setAnswered((cur) => {
        const next = { ...cur };
        delete next[requestId];
        return next;
      });
      setError(err instanceof Error ? err.message : 'Dat lukte niet');
    } finally {
      setBusy(null);
    }
  }

  if (!shown) return null;

  return createPortal(
    <div className={`notif-backdrop ${closing ? 'closing' : ''}`} onClick={onClose}>
      <div className="notif-sheet card" onClick={(e) => e.stopPropagation()}>
        <div className="notif-head">
          <h2>Meldingen</h2>
          <button type="button" className="notif-close" aria-label="Sluiten" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {error && <p className="error-text notif-error">{error}</p>}

        {items === null ? (
          <p className="muted notif-empty">Laden…</p>
        ) : items.length === 0 ? (
          <div className="notif-empty">
            <span className="notif-empty-icon" aria-hidden="true">
              <Icon name="bell" size={26} />
            </span>
            <p className="muted">Niets nieuws. Hier komen verzoeken en uitnodigingen.</p>
          </div>
        ) : (
          <ul className="notif-list">
            {items.map((item, i) => {
              const justAnswered = item.request ? answered[item.request.id] : undefined;
              const pending =
                item.kind === 'ACCESS_REQUESTED' &&
                item.request?.status === 'PENDING' &&
                !justAnswered;
              return (
                <li
                  key={item.id}
                  className={`notif-item ${item.read ? '' : 'unread'}`}
                  style={{ animationDelay: `${Math.min(i, 8) * 0.035}s` }}
                >
                  <span className="notif-avatar">
                    {item.actor ? (
                      <Avatar
                        userId={item.actor.id}
                        displayName={item.actor.displayName}
                        hasAvatar={item.actor.hasAvatar}
                        size={38}
                      />
                    ) : (
                      <span className="notif-avatar-fallback">
                        <Icon name="bell" size={17} />
                      </span>
                    )}
                    <span className={`notif-kind kind-${item.kind}`} aria-hidden="true">
                      <Icon name={kindIcon(item.kind)} size={11} />
                    </span>
                  </span>

                  <div className="notif-body">
                    <p className="notif-text">{describe(item)}</p>
                    {item.request?.message && <p className="notif-quote">“{item.request.message}”</p>}
                    <span className="notif-when">{ago(item.createdAt)}</span>

                    {pending && (
                      <div className="notif-actions">
                        <button
                          type="button"
                          className="btn btn-primary notif-act"
                          disabled={busy === item.request!.id}
                          onClick={() => void answer(item.request!.id, true)}
                        >
                          Toelaten
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost notif-act notif-deny"
                          disabled={busy === item.request!.id}
                          onClick={() => void answer(item.request!.id, false)}
                        >
                          Afwijzen
                        </button>
                      </div>
                    )}

                    {justAnswered && (
                      <p className={`notif-outcome ${justAnswered === 'in' ? 'yes' : 'no'}`}>
                        <Icon name={justAnswered === 'in' ? 'check' : 'close'} size={13} />
                        {justAnswered === 'in'
                          ? `${item.actor?.displayName ?? 'Toegelaten'} kijkt nu mee als gast.`
                          : 'Afgewezen.'}
                      </p>
                    )}

                    {item.trip && item.kind !== 'ACCESS_DENIED' && !pending && (
                      <button
                        type="button"
                        className="notif-open"
                        onClick={() => {
                          onClose();
                          navigate(`/trips/${item.trip!.id}`);
                        }}
                      >
                        Reis openen <Icon name="chevron-right" size={12} />
                      </button>
                    )}
                  </div>

                  {/* Ignoring is an answer too: the line goes, the request
                      itself stays open, so nothing is decided behind the
                      asker's back. */}
                  <button
                    type="button"
                    className="notif-dismiss"
                    aria-label={pending ? 'Verzoek negeren' : 'Melding weghalen'}
                    onClick={() => onDismiss(item.id)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

function kindIcon(kind: NotificationItem['kind']) {
  switch (kind) {
    case 'ACCESS_REQUESTED':
      return 'people' as const;
    case 'ACCESS_APPROVED':
      return 'check' as const;
    case 'ACCESS_DENIED':
      return 'close' as const;
    default:
      return 'compass' as const;
  }
}

function describe(item: NotificationItem): string {
  const who = item.actor?.displayName ?? 'Iemand';
  const trip = item.trip?.title ?? 'een reis';
  switch (item.kind) {
    case 'TRIP_ADDED':
      return `${who} heeft je toegevoegd aan ${trip}.`;
    case 'ACCESS_REQUESTED':
      return `${who} vraagt toegang tot ${trip}.`;
    case 'ACCESS_APPROVED':
      return `${who} heeft je toegelaten tot ${trip}.`;
    case 'ACCESS_DENIED':
      return `${who} heeft je verzoek voor ${trip} afgewezen.`;
    default:
      return `${who} · ${trip}`;
  }
}

/** "net", "3 uur", "gisteren", "12 jul" — the same scale the map markers use. */
function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return 'net';
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} uur geleden`;
  if (hours < 48) return 'gisteren';
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} dagen geleden`;
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}
