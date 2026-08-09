import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './bottomnav.css';
import { travellersTabLabel } from '../lib/localMode';
import { getNavBarMode, type NavBarMode } from '../lib/prefs';

const ICONS = {
  // The same compass the site's nav and the wordmark use: a pin said "a place",
  // and the tab is about journeys.
  trips: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5Z" />
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

  const [mode, setMode] = useState<NavBarMode>(getNavBarMode);
  useEffect(() => {
    const listen = (e: Event) => setMode((e as CustomEvent<NavBarMode>).detail);
    window.addEventListener('mms-navbar', listen);
    return () => window.removeEventListener('mms-navbar', listen);
  }, []);

  // Everything under /trips/ is "inside a trip": the trip itself, its planner
  // and its settings. The list of trips is the home screen and keeps the bar.
  const tucked = mode === 'auto' && pathname.startsWith('/trips/');

  // The bar slides away rather than unmounting, so it comes back with the same
  // movement. The class on <body> hands the space it was reserving back to the
  // page — without it every trip page ended in 88px of nothing.
  useEffect(() => {
    document.body.classList.toggle('nav-tucked', tucked);
    return () => document.body.classList.remove('nav-tucked');
  }, [tucked]);

  return (
    <nav className={`bottomnav ${tucked ? 'tucked' : ''}`} aria-hidden={tucked}>
      <Link to="/" className={tripsActive ? 'active' : ''}>
        {ICONS.trips}
        <span>Reizen</span>
      </Link>
      <Link to="/friends" className={friendsActive ? 'active' : ''}>
        {ICONS.friends}
        <span>{travellersTabLabel()}</span>
      </Link>
      <Link to="/settings" className={settingsActive ? 'active' : ''}>
        {ICONS.settings}
        <span>Instellingen</span>
      </Link>
    </nav>
  );
}
