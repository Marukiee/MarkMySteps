import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './topbar.css';

export function TopBar() {
  const { user, logout } = useAuth();

  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        MarkMySteps
      </Link>
      <nav className="topbar-nav">
        <NavLink to="/" end>
          Reizen
        </NavLink>
        <NavLink to="/settings">Instellingen</NavLink>
      </nav>
      <div className="topbar-user">
        <span className="muted">{user?.displayName}</span>
        <button className="btn btn-ghost" onClick={logout}>
          Uitloggen
        </button>
      </div>
    </header>
  );
}
