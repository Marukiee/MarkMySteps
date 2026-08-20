import { useEffect, useState } from 'react';
import { isServerReachable, onServerReachability } from '../api/client';
import { useExit } from '../lib/useExit';
import { Icon } from './Icon';
import './offlinebanner.css';

/**
 * Shown while the server can't be reached. Trips you've opened before still
 * render from the offline cache and tracking keeps recording into its local
 * buffer, but nothing you change is saved anywhere else — that difference is
 * worth stating plainly rather than letting saves fail silently.
 *
 * It can be put away, like the update banner: on a train with no signal the
 * message is true for an hour, and after the first read it is only a strip
 * eating the top of every page. Dismissing forgets itself the moment the
 * server answers again, so the next outage says so.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(!isServerReachable());
  const [dismissed, setDismissed] = useState(false);
  const [shown, closing] = useExit(offline && !dismissed, 300);

  useEffect(() => {
    const sync = (ok: boolean) => {
      setOffline(!ok);
      // Back online: the banner that gets dismissed is this outage's banner,
      // not every future one.
      if (ok) setDismissed(false);
    };
    const off = onServerReachability(sync);
    // The browser's own signal reacts faster than our next failed request.
    const onOffline = () => setOffline(true);
    window.addEventListener('offline', onOffline);
    return () => {
      off();
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!shown) return null;

  return (
    <div className={`offline-banner ${closing ? 'closing' : ''}`}>
      <Icon name="cloud-off" size={16} />
      <span>
        <strong>Geen verbinding met de server.</strong> Je ziet opgeslagen gegevens. Je locatie
        wordt lokaal bewaard en later verstuurd; andere wijzigingen en nieuwe foto's nog niet.
      </span>
      <button
        type="button"
        className="offline-banner-close"
        aria-label="Verbergen"
        onClick={() => setDismissed(true)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
