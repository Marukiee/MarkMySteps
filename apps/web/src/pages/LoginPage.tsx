import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getServerBase, setServerBase } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_SERVER_URL } from '../config';
import { isNative } from '../tracking/tracker';
import { LocalModeSheet } from '../components/LocalModeSheet';
import { PasswordInput } from '../components/PasswordInput';
import './login.css';

export function LoginPage() {
  const { login, register, startLocalMode } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [server, setServer] = useState(getServerBase());
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localInfo, setLocalInfo] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNative()) setServerBase(server.trim() || DEFAULT_SERVER_URL);
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, username, displayName, password);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-hero">
        <h1>MarkMySteps</h1>
        <p>Jouw reizen, jouw server.</p>
      </div>

      <form className="card login-card fade-in" onSubmit={submit}>
        <div className="login-tabs" role="tablist">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            Inloggen
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            Account maken
          </button>
        </div>

        {isNative() && (
          <div className="field">
            <label htmlFor="server">Server-URL</label>
            <input
              id="server"
              type="url"
              placeholder={DEFAULT_SERVER_URL}
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
            <span className="muted">Leeg laten = standaard server</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="email">{mode === 'login' ? 'E-mail of gebruikersnaam' : 'E-mail'}</label>
          <input
            id="email"
            type={mode === 'login' ? 'text' : 'email'}
            required
            autoComplete={mode === 'login' ? 'username' : 'email'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {mode === 'register' && (
          <>
            <div className="field">
              <label htmlFor="username">Gebruikersnaam</label>
              <input
                id="username"
                required
                pattern="[a-zA-Z0-9._\-]{3,30}"
                autoComplete="username"
                placeholder="bijv. mark"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <span className="muted">Hiermee voegen vrienden je toe aan reizen</span>
            </div>
            <div className="field">
              <label htmlFor="name">Naam</label>
              <input
                id="name"
                required
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="password">Wachtwoord</label>
          <PasswordInput
            id="password"
            required
            minLength={10}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && <span className="muted">Minimaal 10 tekens</span>}
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Even geduld…' : mode === 'login' ? 'Inloggen' : 'Account maken'}
        </button>

        {/* The app is usable with nothing but the phone; saying so here is the
            only place anyone would look for it. */}
        <button type="button" className="login-nolink" onClick={() => setLocalInfo(true)}>
          Doorgaan <u>zonder server</u>
        </button>
      </form>

      {localInfo && (
        <LocalModeSheet
          onClose={() => setLocalInfo(false)}
          onContinue={() => {
            setLocalInfo(false);
            startLocalMode();
            navigate('/', { replace: true });
          }}
        />
      )}
    </div>
  );
}
