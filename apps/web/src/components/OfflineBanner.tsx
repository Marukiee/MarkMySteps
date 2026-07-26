import { useEffect, useState } from 'react';
import { isServerReachable, onServerReachability } from '../api/client';
import { Icon } from './Icon';
import './offlinebanner.css';

/**
 * Shown while the server can't be reached. Trips you've opened before still
 * render from the offline cache and tracking keeps recording into its local
 * buffer, but nothing you change is saved anywhere else — that difference is
 * worth stating plainly rather than letting saves fail silently.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(!isServerReachable());

  useEffect(() => {
    const sync = () => setOffline(!isServerReachable());
    const off = onServerReachability(sync);
    // The browser's own signal reacts faster than our next failed request.
    const onOffline = () => setOffline(true);
    window.addEventListener('offline', onOffline);
    return () => {
      off();
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="offline-banner">
      <Icon name="cloud-off" size={16} />
      <span>
        <strong>Geen verbinding met de server.</strong> Je ziet opgeslagen gegevens. Je locatie
        wordt lokaal bewaard en later verstuurd; andere wijzigingen en nieuwe foto's nog niet.
      </span>
    </div>
  );
}
