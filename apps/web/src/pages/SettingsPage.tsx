import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ConnectionStatus, ImportedTripSummary } from '../api/types';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { confirmModal } from '../components/confirm';
import { Icon } from '../components/Icon';
import { formatDate } from '../lib/colors';
import {
  MAP_STYLES,
  MapStyleId,
  ThemeId,
  TripCardSize,
  clearTripCardOverrides,
  getMapStyleId,
  getThemeId,
  getTrackingIntervalMin,
  getTripCardSize,
  hasTripCardOverrides,
  setMapStyleId,
  setThemeId,
  setTrackingIntervalMin,
  setTripCardSize,
} from '../lib/prefs';
import {
  TrackerState,
  getTrackingLog,
  isNative,
  onTrackerChange,
  startTracking,
  stopTracking,
} from '../tracking/tracker';
import './settings.css';

type SectionId = 'profile' | 'display' | 'immich' | 'import' | 'tracking' | 'accounts' | 'about';

export function SettingsPage() {
  const { user } = useAuth();
  const [section, setSection] = useState<SectionId>('profile');

  const sections: { id: SectionId; label: string; show: boolean }[] = [
    { id: 'profile', label: 'Profiel', show: true },
    { id: 'display', label: 'Weergave', show: true },
    { id: 'immich', label: 'Immich', show: true },
    { id: 'import', label: 'Importeren', show: true },
    { id: 'tracking', label: 'Tracking', show: isNative() },
    { id: 'accounts', label: 'Accounts', show: user?.role === 'ADMIN' },
    { id: 'about', label: 'Over', show: true },
  ];

  return (
    <main className="page fade-in settings-page">
      <h1>Instellingen</h1>
      <div className="settings-layout">
        <div className="settings-nav-scroll">
          <nav className="settings-nav">
            {sections
              .filter((s) => s.show)
              .map((s) => (
                <button
                  key={s.id}
                  className={section === s.id ? 'active' : ''}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
          </nav>
        </div>
        <div className="settings-content">
          {section === 'profile' && <ProfileSection />}
          {section === 'display' && <DisplaySection />}
          {section === 'immich' && <ImmichSection />}
          {section === 'import' && <PolarstepsSection />}
          {section === 'tracking' && <TrackingSection />}
          {section === 'accounts' && <AccountsSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </main>
  );
}

function DisplaySection() {
  const [style, setStyle] = useState<MapStyleId>(getMapStyleId());
  const [theme, setTheme] = useState<ThemeId>(getThemeId());
  const [cardSize, setCardSize] = useState<TripCardSize>(getTripCardSize());
  const [hasOverrides, setHasOverrides] = useState(hasTripCardOverrides());

  const themes: { id: ThemeId; label: string }[] = [
    { id: 'system', label: 'Systeem' },
    { id: 'light', label: 'Licht' },
    { id: 'dark', label: 'Donker' },
  ];
  const cardSizes: { id: TripCardSize; label: string }[] = [
    { id: 'auto', label: 'Automatisch' },
    { id: 'large', label: 'Groot' },
    { id: 'compact', label: 'Compact' },
  ];

  return (
    <section className="card settings-card">
      <h2>Weergave</h2>
      <div className="field">
        <label>Thema</label>
        <div className="theme-choice">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-opt ${theme === t.id ? 'active' : ''}`}
              onClick={() => {
                setTheme(t.id);
                setThemeId(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="muted">“Systeem” volgt de licht/donker-stand van je toestel.</span>
      </div>
      <div className="field">
        <label>Reiskaarten op de homepage</label>
        <div className="theme-choice">
          {cardSizes.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`theme-opt ${cardSize === c.id ? 'active' : ''}`}
              onClick={() => {
                setCardSize(c.id);
                setTripCardSize(c.id);
                setHasOverrides(hasTripCardOverrides());
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <span className="muted">
          Standaardgrootte voor alle reizen. “Automatisch”: aankomende reizen groot, afgelopen
          reizen compact. Per reis kun je dit overschrijven via het ⋯-menu op de kaart.
        </span>
        {hasOverrides && (
          <button
            type="button"
            className="btn btn-ghost settings-reset-sizes"
            onClick={() => {
              clearTripCardOverrides();
              setHasOverrides(false);
            }}
          >
            Handmatige keuzes wissen
          </button>
        )}
      </div>
      <div className="field">
        <label>Kaartstijl</label>
        <div className="map-style-grid">
          {MAP_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`map-style-opt ${style === s.id ? 'active' : ''}`}
              onClick={() => {
                setStyle(s.id);
                setMapStyleId(s.id);
              }}
            >
              <span className={`map-style-preview map-style-${s.id}`} aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>
        <span className="muted">Geldt voor alle kaarten op dit apparaat.</span>
      </div>
    </section>
  );
}

/** Native-only: route tracking lives here, not on the trip page. */
function TrackingSection() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selected, setSelected] = useState('');
  const [tracker, setTracker] = useState<TrackerState>({
    tripId: null,
    buffered: 0,
    lastError: null,
    lastFix: null,
  });
  const [now, setNow] = useState(Date.now());
  const [interval, setIntervalMin] = useState(getTrackingIntervalMin());
  const INTERVALS = [1, 5, 10, 15];

  useEffect(() => {
    api<Trip[]>('/trips').then(setTrips).catch(() => undefined);
    return onTrackerChange(setTracker);
  }, []);

  // Tick so the "x sec geleden" freshness stays live while tracking.
  useEffect(() => {
    if (!tracker.tripId) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [tracker.tripId]);

  const activeTrip = trips.find((t) => t.id === tracker.tripId);
  const fixAge = tracker.lastFix ? Math.round((now - tracker.lastFix.at) / 1000) : null;

  return (
    <section className="card settings-card">
      <h2>Route-tracking</h2>
      <p className="muted">
        Zuinig met batterij: een GPS-punt bij ≥50 m verplaatsing, hooguit één keer per interval.
        Offline wordt alles gebufferd en later geüpload. Vereist locatie op “Altijd toestaan”.
      </p>

      <div className="field">
        <label>Locatie opslaan elke</label>
        <div className="theme-choice theme-choice-wrap">
          {INTERVALS.map((m) => (
            <button
              key={m}
              type="button"
              className={`theme-opt ${interval === m ? 'active' : ''}`}
              onClick={() => {
                setIntervalMin(m);
                setTrackingIntervalMin(m);
              }}
            >
              {m} min
            </button>
          ))}
        </div>
      </div>

      {tracker.tripId ? (
        <div className="tracking-status">
          <span className="settings-ok">● Actief — {activeTrip?.title ?? 'reis'}</span>

          <div className="tracking-live">
            {tracker.lastFix ? (
              <>
                <span className="tracking-live-dot" />
                <div>
                  <strong>
                    {tracker.lastFix.lat.toFixed(5)}, {tracker.lastFix.lng.toFixed(5)}
                  </strong>
                  <span className="muted">
                    laatste fix {fixAge === null ? '' : fixAge < 2 ? 'zojuist' : `${fixAge}s geleden`}
                    {tracker.lastFix.accuracy ? ` · ±${Math.round(tracker.lastFix.accuracy)} m` : ''}
                  </span>
                </div>
              </>
            ) : (
              <span className="muted">Wachten op eerste GPS-fix…</span>
            )}
          </div>
          {activeTrip && (
            <a className="tracking-view-link" href={`/trips/${activeTrip.id}`}>
              Bekijk het gelopen pad op de kaart
            </a>
          )}

          {tracker.buffered > 0 && (
            <span className="muted">{tracker.buffered} punten in buffer (wacht op netwerk)</span>
          )}
          {tracker.lastError && <span className="error-text">{tracker.lastError}</span>}
          <button className="btn btn-danger" onClick={() => void stopTracking()}>
            <Icon name="stop" size={15} /> Stop tracking
          </button>
        </div>
      ) : (
        <div className="settings-form">
          <div className="field">
            <label htmlFor="tr-trip">Reis</label>
            <select id="tr-trip" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Kies een reis…</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
          {tracker.lastError && <p className="error-text">{tracker.lastError}</p>}
          <div className="settings-actions">
            <button
              className="btn btn-primary"
              disabled={!selected}
              onClick={() => void startTracking(selected)}
            >
              <Icon name="play" size={15} /> Start tracking
            </button>
          </div>
        </div>
      )}

      <TrackingLog now={now} />
    </section>
  );
}

/** Persisted recent-fix log — proof tracking keeps recording, even backgrounded. */
function TrackingLog({ now }: { now: number }) {
  const log = getTrackingLog();
  if (log.length === 0) return null;
  return (
    <details className="tracking-log">
      <summary>
        <Icon name="chevron-right" size={16} className="tracking-log-caret" />
        Locatie-log · {log.length} fixes
      </summary>
      <ul>
        {log.slice(0, 25).map((e, i) => {
          const ago = Math.round((now - e.at) / 1000);
          return (
            <li key={i}>
              <span>
                {new Date(e.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                {ago < 3600 ? ` · ${Math.max(0, Math.round(ago / 60))}m geleden` : ''}
              </span>
              <span className="muted">
                {e.lat.toFixed(4)}, {e.lng.toFixed(4)}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function AboutSection() {
  return (
    <section className="card settings-card">
      <h2>Over MarkMySteps</h2>
      <p className="muted">
        Self-hosted reis-tracker over je eigen Immich-server. Open source (AGPL-3.0).
      </p>
      <ul className="about-list">
        <li>
          <a
            href="https://github.com/Marukiee/MarkMySteps"
            target="_blank"
            rel="noreferrer"
            className="ext-link"
          >
            Broncode op GitHub <Icon name="chevron-right" size={14} />
          </a>
        </li>
        <li>
          <a
            href="https://github.com/Marukiee/MarkMySteps/actions"
            target="_blank"
            rel="noreferrer"
            className="ext-link"
          >
            Android-app (APK) downloaden <Icon name="chevron-right" size={14} />
          </a>
        </li>
      </ul>
    </section>
  );
}

/** Client-side resize to keep stored avatars tiny. */
async function resizeImage(file: File, maxSize = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('resize failed'))),
      'image/jpeg',
      0.85,
    ),
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

  async function uploadAvatar(file: File) {
    setError(null);
    try {
      const resized = await resizeImage(file);
      const formData = new FormData();
      formData.append('file', resized, 'avatar.jpg');
      await api('/users/me/avatar', { method: 'POST', formData });
      setMessage('Profielfoto opgeslagen — zichtbaar na opnieuw laden.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload mislukt');
    }
  }

  return (
    <section className="card settings-card">
      <h2>Profiel</h2>

      <div className="avatar-row">
        <label className="avatar-edit" title="Profielfoto wijzigen">
          {user && (
            <Avatar
              userId={user.id}
              displayName={user.displayName}
              hasAvatar={user.hasAvatar}
              size={72}
            />
          )}
          <span className="avatar-edit-badge">
            <Icon name="camera" size={15} />
          </span>
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadAvatar(file);
            }}
          />
        </label>
        <div className="avatar-meta">
          <strong>{user?.displayName}</strong>
          <span className="muted">Tik op de foto om te wijzigen</span>
          {user?.hasAvatar && (
            <button
              className="avatar-remove"
              onClick={() =>
                void api('/users/me/avatar', { method: 'DELETE' }).then(() =>
                  setMessage('Profielfoto verwijderd — zichtbaar na opnieuw laden.'),
                )
              }
            >
              Verwijderen
            </button>
          )}
        </div>
      </div>

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
  const [publicUrl, setPublicUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ConnectionStatus>('/immich/connection')
      .then((s) => {
        setStatus(s);
        setServerUrl(s.serverUrl);
        setPublicUrl(s.publicUrl ?? '');
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
        body: { serverUrl, apiKey, publicUrl: publicUrl || undefined },
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
          <span className="muted inline-path">
            Immich <Icon name="chevron-right" size={12} /> Accountinstellingen{' '}
            <Icon name="chevron-right" size={12} /> API-keys. Wordt AES-256 versleuteld opgeslagen.
          </span>
        </div>
        <div className="field">
          <label htmlFor="im-public">Publieke URL (optioneel)</label>
          <input
            id="im-public"
            type="url"
            placeholder="https://fotos.markmaaktmedia.nl"
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
          />
          <span className="muted">
            Voor de “Openen in Immich”-knop. De server-URL hierboven mag een intern LAN-adres zijn;
            deze is het adres waarmee jij Immich in je browser/app opent.
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

interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  mustChangePassword: boolean;
  tripCount: number;
}

/** Admin-only: manage every account on this server. */
function AccountsSection() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<AdminUserRow[]>('/admin/users').then(setUsers).catch(() => undefined);
  }
  useEffect(load, []);

  function generatePassword() {
    const raw = crypto.getRandomValues(new Uint8Array(9));
    setTempPassword(btoa(String.fromCharCode(...raw)).replace(/[+/=]/g, 'x'));
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: { email, username, displayName, tempPassword },
      });
      setMessage(
        `Account @${username} aangemaakt. Geef het tijdelijke wachtwoord door: ${tempPassword}`,
      );
      setEmail('');
      setUsername('');
      setDisplayName('');
      setTempPassword('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aanmaken mislukt');
    }
  }

  async function resetPassword(row: AdminUserRow) {
    const temp = window.prompt(`Nieuw tijdelijk wachtwoord voor @${row.username} (min. 10 tekens):`);
    if (!temp) return;
    try {
      await api(`/admin/users/${row.id}/reset-password`, {
        method: 'POST',
        body: { tempPassword: temp },
      });
      setMessage(`Wachtwoord van @${row.username} gereset — alle sessies uitgelogd.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset mislukt');
    }
  }

  async function removeAccount(row: AdminUserRow) {
    const ok = await confirmModal({
      title: 'Account verwijderen?',
      body: `Account @${row.username} wordt verwijderd, samen met hun eigen reizen en routes.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    });
    if (!ok) return;
    await api(`/admin/users/${row.id}`, { method: 'DELETE' });
    load();
  }

  async function toggleRole(row: AdminUserRow) {
    await api(`/admin/users/${row.id}/role`, {
      method: 'POST',
      body: { role: row.role === 'ADMIN' ? 'USER' : 'ADMIN' },
    });
    load();
  }

  return (
    <section className="card settings-card">
      <h2>Accounts (beheer)</h2>
      <p className="muted">
        Maak accounts voor vrienden met een tijdelijk wachtwoord. Bij de eerste login kiezen ze een
        eigen wachtwoord (overslaan kan, ze blijven een herinnering zien).
      </p>

      <ul className="admin-users">
        {users.map((row) => (
          <li key={row.id}>
            <div className="admin-user-info">
              <strong>
                {row.displayName} <small className="muted">@{row.username}</small>
              </strong>
              <span className="muted">
                {row.email} · {row.tripCount} {row.tripCount === 1 ? 'reis' : 'reizen'}
                {row.role === 'ADMIN' && ' · admin'}
                {row.mustChangePassword && ' · tijdelijk wachtwoord'}
              </span>
            </div>
            {row.id !== me?.id && (
              <div className="admin-user-actions">
                <button className="btn btn-ghost" onClick={() => void resetPassword(row)}>
                  Reset
                </button>
                <button className="btn btn-ghost" onClick={() => void toggleRole(row)}>
                  {row.role === 'ADMIN' ? 'Demoveer' : 'Maak admin'}
                </button>
                <button
                  className="btn btn-danger btn-icon-sm"
                  aria-label="Account verwijderen"
                  onClick={() => void removeAccount(row)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={createAccount} className="settings-form">
        <div className="admin-create-grid">
          <div className="field">
            <label htmlFor="ac-name">Naam</label>
            <input id="ac-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ac-user">Gebruikersnaam</label>
            <input
              id="ac-user"
              required
              pattern="[a-zA-Z0-9._\-]{3,30}"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ac-mail">E-mail</label>
            <input id="ac-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ac-pass">Tijdelijk wachtwoord</label>
            <div className="admin-pass-row">
              <input
                id="ac-pass"
                required
                minLength={10}
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
              />
              <button type="button" className="btn btn-ghost" onClick={generatePassword}>
                Genereer
              </button>
            </div>
          </div>
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary">Account aanmaken</button>
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
        Vraag je export op via{' '}
        <span className="inline-path">
          polarsteps.com <Icon name="chevron-right" size={12} /> Settings{' '}
          <Icon name="chevron-right" size={12} /> Privacy <Icon name="chevron-right" size={12} />
          “Download my data”
        </span>{' '}
        en upload de zip hier. Elke reis in de export wordt aangemaakt met de volledige GPS-route.
      </p>

      <form onSubmit={upload} className="settings-form">
        <label className="file-drop">
          <input
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="file-drop-icon">
            <Icon name="archive" size={26} />
          </span>
          <span>{file ? file.name : 'Kies je Polarsteps-zip'}</span>
        </label>
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
