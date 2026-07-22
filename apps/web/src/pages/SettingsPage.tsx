import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ConnectionStatus, ImportedTripSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDate } from '../lib/colors';
import './settings.css';

export function SettingsPage() {
  return (
    <main className="page fade-in settings-page">
      <h1>Instellingen</h1>
      <ProfileSection />
      <ImmichSection />
      <PolarstepsSection />
    </main>
  );
}

function ProfileSection() {
  const { user, logout } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/users/me', { method: 'PATCH', body: { displayName, username } });
      setMessage('Profiel bijgewerkt — zichtbaar na opnieuw laden.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan mislukt');
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api('/users/me/password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setMessage('Wachtwoord gewijzigd. Andere sessies zijn uitgelogd — log opnieuw in.');
      setCurrentPassword('');
      setNewPassword('');
      window.setTimeout(logout, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wijzigen mislukt');
    }
  }

  return (
    <section className="card settings-card">
      <h2>Profiel</h2>
      <form onSubmit={saveName} className="settings-form">
        <div className="field">
          <label htmlFor="pr-name">Naam</label>
          <input
            id="pr-name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pr-user">Gebruikersnaam</label>
          <input
            id="pr-user"
            required
            pattern="[a-zA-Z0-9._\-]{3,30}"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <span className="muted">Hiermee voegen vrienden je toe aan reizen</span>
        </div>
        <div className="settings-actions">
          <button className="btn btn-ghost">Profiel opslaan</button>
        </div>
      </form>

      <form onSubmit={savePassword} className="settings-form">
        <div className="field">
          <label htmlFor="pr-cur">Huidig wachtwoord</label>
          <input
            id="pr-cur"
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pr-new">Nieuw wachtwoord</label>
          <input
            id="pr-new"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary">Wachtwoord wijzigen</button>
        </div>
      </form>

      {message && <p className="settings-ok">{message}</p>}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

function ImmichSection() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ConnectionStatus>('/immich/connection')
      .then((s) => {
        setStatus(s);
        setServerUrl(s.serverUrl);
      })
      .catch((err: unknown) => {
        // 404 simply means: not configured yet.
        if (!(err instanceof ApiError && err.status === 404)) {
          setError('Kon Immich-status niet laden');
        }
      });
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const s = await api<ConnectionStatus>('/immich/connection', {
        method: 'PUT',
        body: { serverUrl, apiKey },
      });
      setStatus(s);
      setApiKey('');
      setMessage('Verbonden met Immich — API-key gevalideerd en versleuteld opgeslagen.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan mislukt');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await api('/immich/connection', { method: 'DELETE' });
    setStatus(null);
    setServerUrl('');
    setMessage('Verbinding verwijderd.');
  }

  return (
    <section className="card settings-card">
      <h2>Immich</h2>
      <p className="muted">
        Koppel je eigen Immich-server. Foto's blijven dáár staan — MarkMySteps bewaart alleen
        verwijzingen (asset-id, tijdstip, GPS uit EXIF).
      </p>

      {status && (
        <div className="immich-status">
          <span className="immich-status-ok">● Verbonden</span>
          <span className="muted">
            {status.serverUrl} · key {status.apiKeyPreview}
            {status.lastSyncAt && ` · laatste sync ${formatDate(status.lastSyncAt)}`}
          </span>
          {status.lastSyncError && <span className="error-text">{status.lastSyncError}</span>}
        </div>
      )}

      <form onSubmit={save} className="settings-form">
        <div className="field">
          <label htmlFor="im-url">Server-URL</label>
          <input
            id="im-url"
            type="url"
            required
            placeholder="https://immich.example.com"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="im-key">API-key</label>
          <input
            id="im-key"
            type="password"
            required
            placeholder={status ? 'Nieuwe key invoeren om te vervangen' : 'Immich API-key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span className="muted">
            Immich → Accountinstellingen → API-keys. Wordt AES-256 versleuteld opgeslagen.
          </span>
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Valideren…' : status ? 'Bijwerken' : 'Verbinden'}
          </button>
          {status && (
            <button type="button" className="btn btn-danger" onClick={disconnect}>
              Verbinding verwijderen
            </button>
          )}
        </div>
      </form>

      {message && <p className="settings-ok">{message}</p>}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

function PolarstepsSection() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportedTripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      setResult(
        await api<ImportedTripSummary[]>('/import/polarsteps', { method: 'POST', formData }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-card">
      <h2>Polarsteps importeren</h2>
      <p className="muted">
        Vraag je export op via polarsteps.com → Settings → Privacy → “Download my data” en upload
        de zip hier. Elke reis in de export wordt aangemaakt met de volledige GPS-route.
      </p>

      <form onSubmit={upload} className="settings-form">
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="settings-actions">
          <button className="btn btn-primary" disabled={!file || busy}>
            {busy ? 'Importeren…' : 'Importeren'}
          </button>
        </div>
      </form>

      {result && (
        <ul className="import-result">
          {result.map((trip) => (
            <li key={trip.tripId}>
              <strong>{trip.title}</strong> — {formatDate(trip.startDate)} t/m{' '}
              {formatDate(trip.endDate)}, {trip.pointsImported.toLocaleString('nl-NL')} routepunten
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
