import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import './topbar.css';

export function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
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
      <Link to="/" className="topbar-brand">
        MarkMySteps
      </Link>

      <nav className="topbar-nav">
        <NavLink to="/" end>
          Reizen
        </NavLink>
        <NavLink to="/friends">Vrienden</NavLink>
      </nav>

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
              size={36}
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
    </header>
  );
}
