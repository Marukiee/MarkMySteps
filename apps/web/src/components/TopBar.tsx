import { CSSProperties, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Icon, IconName } from './Icon';
import { LogoMark } from './Logo';
import { ThemeId, getThemeId, setThemeId } from '../lib/prefs';
import { Avatar } from './Avatar';
import { AppMenu } from './AppMenu';
import { confirmModal } from './confirm';
import './topbar.css';
import { travellersTabLabel } from '../lib/localMode';
import { t } from '../i18n';

const THEMES: { id: ThemeId; icon: IconName; label: string }[] = [
  { id: 'light', icon: 'sun', label: t('ui.theme.light') },
  { id: 'system', icon: 'monitor', label: t('common.system') },
  { id: 'dark', icon: 'moon', label: t('ui.theme.dark') },
];

/** Desktop-only chrome: brand, section nav, theme switch and the account menu. */
export function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(getThemeId());
  const avatarRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  // Which tab the sliding thumb sits under. A trip, its planner and its
  // settings all live under Reizen — that is where you came in from, and the
  // tab you would press to go back.
  const tripsActive = pathname === '/' || pathname.startsWith('/trips');
  const navIndex = tripsActive
    ? 0
    : pathname.startsWith('/friends')
      ? 1
      : pathname.startsWith('/settings')
        ? 2
        : -1;
  const themeIndex = THEMES.findIndex((t) => t.id === theme);

  /** Logging out asks first, as on the native apps. */
  async function askLogout() {
    const ok = await confirmModal({
      title: t('ui.topBar.logout'),
      body: t('ui.topBar.logoutBody'),
      confirmLabel: t('ui.topBar.logout'),
      danger: true,
    });
    if (ok) logout();
  }

  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand" aria-label="MarkMySteps">
        <LogoMark size={28} />
        <span>MarkMySteps</span>
      </Link>

      <nav
        className={`topbar-nav pill-switch ${navIndex < 0 ? 'pill-switch-off' : ''}`}
        style={{ '--n': 3, '--i': Math.max(0, navIndex) } as CSSProperties}
      >
        <NavLink to="/" end className={tripsActive ? 'active' : ''}>
          <Icon name="compass" size={16} />
          {t('common.trips')}
        </NavLink>
        <NavLink to="/friends">
          <Icon name="people" size={16} />
          {travellersTabLabel()}
        </NavLink>
        <NavLink to="/settings">
          <Icon name="settings" size={16} />
          {t('common.settings')}
        </NavLink>
      </nav>

      <div className="topbar-right">
        {/* Light / system / dark, right where you'd reach for it. */}
        <div
          className="topbar-theme pill-switch"
          role="group"
          aria-label={t('ui.topBar.theme')}
          style={{ '--n': 3, '--i': Math.max(0, themeIndex) } as CSSProperties}
        >
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

        <div className="topbar-user">
          <button
            ref={avatarRef}
            className="topbar-avatar-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={t('ui.topBar.accountMenu')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {user && (
              <Avatar
                userId={user.id}
                displayName={user.displayName}
                hasAvatar={user.hasAvatar}
                size={40}
              />
            )}
          </button>
          <AppMenu
            anchor={avatarRef.current}
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            buttonColor="var(--surface-high)"
            header={
              <>
                <strong>{user?.displayName}</strong>
                <span>@{user?.username}</span>
              </>
            }
            groups={[
              [
                { label: t('common.settings'), icon: 'settings', onClick: () => navigate('/settings') },
                { label: t('ui.topBar.logout'), danger: true, onClick: () => void askLogout() },
              ],
            ]}
          />
        </div>
      </div>
    </header>
  );
}
