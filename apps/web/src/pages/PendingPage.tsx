import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { t } from '../i18n';
import { notify } from '../lib/notify';
import './pending.css';

interface Status {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  justApproved: boolean;
}

const POLL_MS = 20_000;

/** "Net gecontroleerd" / "3 min geleden". */
function lastChecked(at: number | null): string {
  if (at === null) return t('auth.pending.notChecked');
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return t('auth.pending.justChecked');
  return t('auth.pending.checkedAgo', { minutes });
}

/**
 * The waiting room: shown instead of the app while an account has not been
 * approved yet.
 *
 * It is only a screen. The refusal itself is the server's: a pending account's
 * token is rejected by the guard on everything except the status check, so
 * getting past this page by fiddling with the client buys nothing.
 */
export function PendingPage() {
  const { logout, refresh } = useAuth();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  // When the last check came back, not how long the screen has been open: a
  // per-second counter suggests this is worth watching, and it is not.
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [, setNow] = useState(0);
  const notified = useRef(false);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      if (!alive) return;
      setChecking(true);
      try {
        const result = await api<Status>('/auth/status');
        if (!alive) return;
        setError(null);
        setCheckedAt(Date.now());
        if (result.status === 'REJECTED') {
          setRejected(true);
          return;
        }
        if (result.status === 'APPROVED') {
          // Said once, and only by the side that first saw it: the server hands
          // out `justApproved` exactly one time.
          if (result.justApproved && !notified.current) {
            notified.current = true;
            notify(t('auth.pending.approved.title'), t('auth.pending.approved.body'));
          }
          // The token still says "pending"; refreshing swaps it for a full one.
          await refresh();
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : t('auth.pending.statusFailed'));
      } finally {
        if (alive) setChecking(false);
      }
    };

    void check();
    const poll = window.setInterval(check, POLL_MS);
    // Coming back to the app is the most likely moment for news.
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    // Only to re-render the "x min geleden" line; minutes need no faster tick.
    const tick = window.setInterval(() => setNow((v) => v + 1), 30_000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (rejected) {
    return (
      <div className="pending-shell">
        <div className="pending-card card">
          <span className="pending-icon pending-icon-no">
            <Icon name="close" size={30} />
          </span>
          <h1>{t('auth.pending.rejected.title')}</h1>
          <p className="muted">{t('auth.pending.rejected.body')}</p>
          <button className="btn btn-ghost" onClick={logout}>
            {t('auth.pending.rejected.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pending-shell">
      <div className="pending-card card">
        {/* The compass needle sweeps round while you wait: something is
            happening, and it is not something you can hurry along. */}
        <span className="pending-brand">
          <LogoMark size={52} spin />
        </span>
        <h1>{t('auth.pending.title')}</h1>
        <p className="muted">{t('auth.pending.body')}</p>
        <p className="muted pending-hint">{t('auth.pending.hint')}</p>

        <div className="pending-foot">
          <span className="muted pending-status" data-busy={checking}>
            {error ? error : checking ? t('auth.pending.checking') : lastChecked(checkedAt)}
          </span>
          <button className="btn btn-ghost" onClick={logout}>
            {t('auth.pending.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
