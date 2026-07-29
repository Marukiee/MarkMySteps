import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Icon, IconName } from './Icon';
import { LogoMark } from './Logo';
import { ThemeId, getThemeId, setThemeId } from '../lib/prefs';
import { Avatar } from './Avatar';
import './topbar.css';
import { travellersTabLabel } from '../lib/localMode';

const THEMES: { id: ThemeId; icon: IconName; label: string }[] = [
  { id: 'light', icon: 'sun', label: 'Licht' },
  { id: 'system', icon: 'monitor', label: 'Systeem' },
  { id: 'dark', icon: 'moon', label: 'Donker' },
];

/** Desktop-only chrome: brand, section nav, theme switch and the account menu. */
export function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(getThemeId());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand" aria-label="MarkMySteps">
        <LogoMark size={28} />
        <span>MarkMySteps</span>
      </Link>

      <nav className="topbar-nav">
        <NavLink to="/" end>
          <Icon name="compass" size={16} />
          Reizen
        </NavLink>
        <NavLink to="/friends">
          <Icon name="people" size={16} />
          {travellersTabLabel()}
        </NavLink>
        <NavLink to="/settings">
          <Icon name="settings" size={16} />
          Instellingen
        </NavLink>
      </nav>

      <div className="topbar-right">
        {/* Light / system / dark, right where you'd reach for it. */}
        <div className="topbar-theme" role="group" aria-label="Thema">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={theme === t.id ? 'active' : ''}
              title={t.label}
              aria-label={t.label}
              aria-pressed={theme === t.id}
              onClick={() => {
                setTheme(t.id);
                setThemeId(t.id);
              }}
            >
              <Icon name={t.icon} size={15} />
            </button>
          ))}
        </div>

        <div className="topbar-user" ref={menuRef}>
          <button
            className="topbar-avatar-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Accountmenu"
          >
            {user && (
              <Avatar
                userId={user.id}
                displayName={user.displayName}
                hasAvatar={user.hasAvatar}
                size={34}
              />
            )}
          </button>

          {menuOpen && (
            <div className="topbar-menu card fade-in">
              <div className="topbar-menu-head">
                <strong>{user?.displayName}</strong>
                <span className="muted">@{user?.username}</span>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/settings');
                }}
              >
                Instellingen
              </button>
              <button className="topbar-menu-danger" onClick={logout}>
                Uitloggen
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
