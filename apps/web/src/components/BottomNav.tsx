import { Link, useLocation } from 'react-router-dom';
import './bottomnav.css';

const ICONS = {
  trips: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  ),
  friends: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M15.4 14.6a5 5 0 0 1 5.8 4.9" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
    </svg>
  ),
};

/** App-style tab bar; the primary navigation on phones and in the APK. */
export function BottomNav() {
  const { pathname } = useLocation();
  // "Reizen" stays highlighted inside a trip (/trips/...), not only on the root.
  const tripsActive = pathname === '/' || pathname.startsWith('/trips');
  const friendsActive = pathname.startsWith('/friends');
  const settingsActive = pathname.startsWith('/settings');

  return (
    <nav className="bottomnav">
      <Link to="/" className={tripsActive ? 'active' : ''}>
        {ICONS.trips}
        <span>Reizen</span>
      </Link>
      <Link to="/friends" className={friendsActive ? 'active' : ''}>
        {ICONS.friends}
        <span>Reizigers</span>
      </Link>
      <Link to="/settings" className={settingsActive ? 'active' : ''}>
        {ICONS.settings}
        <span>Instellingen</span>
      </Link>
    </nav>
  );
}
