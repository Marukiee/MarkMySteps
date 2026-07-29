import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { notify } from '../lib/notify';
import './pending.css';

interface Status {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  justApproved: boolean;
}

const POLL_MS = 20_000;

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
  const [waited, setWaited] = useState(0);
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
        if (result.status === 'REJECTED') {
          setRejected(true);
          return;
        }
        if (result.status === 'APPROVED') {
          // Said once, and only by the side that first saw it: the server hands
          // out `justApproved` exactly one time.
          if (result.justApproved && !notified.current) {
            notified.current = true;
            notify('Je account is goedgekeurd', 'Je kunt MarkMySteps nu gebruiken.');
          }
          // The token still says "pending"; refreshing swaps it for a full one.
          await refresh();
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Kon de status niet ophalen');
      } finally {
        if (alive) setChecking(false);
      }
    };

    void check();
    const poll = window.setInterval(check, POLL_MS);
    // Coming back to the app is the most likely moment for news.
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    const tick = window.setInterval(() => setWaited((v) => v + 1), 1000);
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
          <h1>Niet goedgekeurd</h1>
          <p className="muted">
            De beheerder van deze server heeft je aanvraag afgewezen. Neem contact met diegene op als
            je denkt dat dat niet klopt.
          </p>
          <button className="btn btn-ghost" onClick={logout}>
            Terug naar inloggen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pending-shell">
      <div className="pending-card card">
        <span className="pending-brand">
          <LogoMark size={34} />
        </span>
        {/* Three dots that fill in turn: something is happening, and it is not
            something you can hurry along. */}
        <span className="pending-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <h1>Even wachten op goedkeuring</h1>
        <p className="muted">
          Je aanvraag staat klaar bij de beheerder van deze server. Zodra die je toelaat, ga je
          vanzelf door naar de app.
        </p>
        <p className="muted pending-hint">
          Je mag de app sluiten. Staat 'ie open of op de achtergrond, dan krijg je een melding.
        </p>

        <div className="pending-foot">
          <span className="muted pending-status" data-busy={checking}>
            {error ? error : checking ? 'Controleren…' : `Gecontroleerd, ${waited}s geleden`}
          </span>
          <button className="btn btn-ghost" onClick={logout}>
            Uitloggen
          </button>
        </div>
      </div>
    </div>
  );
}
