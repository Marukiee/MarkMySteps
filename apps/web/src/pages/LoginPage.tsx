import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getServerBase, setServerBase } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { isNative } from '../tracking/tracker';
import './login.css';

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [server, setServer] = useState(getServerBase());
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNative()) setServerBase(server);
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, displayName, password);
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
              required
              placeholder="https://reis.markmaaktmedia.nl"
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {mode === 'register' && (
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
        )}

        <div className="field">
          <label htmlFor="password">Wachtwoord</label>
          <input
            id="password"
            type="password"
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
      </form>
    </div>
  );
}
