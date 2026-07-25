import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resetOnboarding } from '../lib/native';
import { api, ApiError, fetchBlobUrl } from '../api/client';
import { AirportPrefs } from '../components/AirportPrefs';
import { AvatarCrop } from '../components/AvatarCrop';
import type { ConnectionStatus, ImportedTripSummary } from '../api/types';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar, bumpAvatar } from '../components/Avatar';
import { confirmModal } from '../components/confirm';
import { HelpTip } from '../components/HelpTip';
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
  getShowSelfOnHome,
  getTrackingIntervalMin,
  getTripCardSize,
  hasTripCardOverrides,
  setMapStyleId,
  setShowSelfOnHome,
  setThemeId,
  setTrackingIntervalMin,
  setTripCardSize,
} from '../lib/prefs';
import {
  TrackerState,
  getTrackingLog,
  isNative,
  onTrackerChange,
  refreshTrackingInterval,
  startTracking,
  stopTracking,
} from '../tracking/tracker';
import './settings.css';

type SectionId =
  | 'profile'
  | 'display'
  | 'preferences'
  | 'immich'
  | 'import'
  | 'tracking'
  | 'accounts'
  | 'about'
  | 'developer';

export function SettingsPage() {
  const { user } = useAuth();
  const [section, setSection] = useState<SectionId>('profile');
  const [devUnlocked, setDevUnlocked] = useState(localStorage.getItem('mms.dev') === '1');

  const sections: { id: SectionId; label: string; show: boolean }[] = [
    { id: 'profile', label: 'Profiel', show: true },
    { id: 'display', label: 'Weergave', show: true },
    { id: 'preferences', label: 'Voorkeuren', show: true },
    { id: 'immich', label: 'Immich', show: true },
    { id: 'import', label: 'Importeren', show: true },
    { id: 'accounts', label: 'Accounts', show: user?.role === 'ADMIN' },
    { id: 'about', label: 'Over', show: true },
    { id: 'developer', label: 'Ontwikkelaar', show: devUnlocked },
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
        <div className="settings-content" key={section}>
          {section === 'profile' && <ProfileSection />}
          {section === 'display' && <DisplaySection />}
          {section === 'preferences' && <PreferencesSection />}
          {section === 'immich' && <ImmichSection />}
          {section === 'import' && <PolarstepsSection />}
          {section === 'accounts' && <AccountsSection />}
          {section === 'about' && (
            <AboutSection
              onUnlockDev={() => {
                localStorage.setItem('mms.dev', '1');
                setDevUnlocked(true);
                setSection('developer');
              }}
            />
          )}
          {section === 'developer' && (
            <DeveloperSection
              onLock={() => {
                localStorage.removeItem('mms.dev');
                setDevUnlocked(false);
                setSection('about');
              }}
            />
          )}
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

/** Travel preferences: home airports + (native) route tracking, merged. */
function PreferencesSection() {
  return (
    <>
      <section className="card settings-card">
        <h2>
          Standaard vliegvelden
          <HelpTip>
            Voeg er zoveel toe als je wilt. Tik een vliegveld aan om het je standaard te maken —
            dat is degene die vooraf ingevuld wordt als vertrek bij een nieuwe vlucht.
          </HelpTip>
        </h2>
        <p className="muted">Je thuis-vliegvelden, voor het invullen van vluchten.</p>
        <AirportPrefs />
      </section>
      {isNative() && <SelfLocationSection />}
      {isNative() && <TrackingSection />}
    </>
  );
}

/** Where your own live position may be drawn. */
function SelfLocationSection() {
  const [onHome, setOnHome] = useState(getShowSelfOnHome());
  return (
    <section className="card settings-card">
      <h2>
        Eigen locatie
        <HelpTip>
          Je positie komt van de route-tracking, dus je ziet jezelf alleen terwijl je een reis aan
          het tracken bent. De app vraagt nooit apart je locatie op.
        </HelpTip>
      </h2>
      <p className="muted">Op de kaart van een reis zie je jezelf altijd tijdens het tracken.</p>
      <label className="settings-toggle">
        <div>
          <strong>Ook op de homepage</strong>
          <span className="muted">Zet je positie ook als stip op de globe.</span>
        </div>
        <input
          type="checkbox"
          checked={onHome}
          onChange={(e) => {
            setOnHome(e.target.checked);
            setShowSelfOnHome(e.target.checked);
          }}
        />
      </label>
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
    lastStatus: null,
  });
  const [now, setNow] = useState(Date.now());
  const [interval, setIntervalMin] = useState(getTrackingIntervalMin());
  // This is the provider's minTime, so a bigger value directly means fewer GPS
  // wake-ups. Four presets plus a free field, rather than a long row of chips.
  const INTERVALS = [1, 5, 10, 15];
  const [customOpen, setCustomOpen] = useState(!INTERVALS.includes(interval));
  const [customValue, setCustomValue] = useState(String(interval));

  const applyInterval = (minutes: number) => {
    setIntervalMin(minutes);
    setTrackingIntervalMin(minutes);
    // A running watcher keeps its old interval/distanceFilter otherwise.
    void refreshTrackingInterval();
  };

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
      <h2>
        Route-tracking
        <HelpTip>
          Elk interval zet de app de GPS heel even aan voor één positie en daarna weer uit. Ligt
          die positie minder dan ~50 m van de vorige, dan wordt hij weggegooid in plaats van
          opgeslagen — zo blijft je route strak zonder een hoop punten op dezelfde plek. Blijf je
          langere tijd op dezelfde plek, dan stopt het meten helemaal en wacht de app op de
          bewegingssensor van je toestel. Een groter interval scheelt dus flink batterij. Offline
          wordt alles gebufferd en later geüpload. Vereist locatie op “Altijd toestaan”.
        </HelpTip>
      </h2>
      <p className="muted">Houdt je route bij tijdens een reis, ook met het scherm uit.</p>

      <div className="field">
        <label>Locatie opslaan elke</label>
        <div className="theme-choice theme-choice-wrap">
          {INTERVALS.map((m) => (
            <button
              key={m}
              type="button"
              className={`theme-opt ${!customOpen && interval === m ? 'active' : ''}`}
              onClick={() => {
                setCustomOpen(false);
                applyInterval(m);
              }}
            >
              {m} min
            </button>
          ))}
          {/* An "Anders" label pushed the row onto two lines — a pencil says
              the same in one chip's width. */}
          <button
            type="button"
            className={`theme-opt theme-opt-icon ${customOpen ? 'active' : ''}`}
            title="Eigen aantal minuten"
            aria-label="Eigen aantal minuten"
            onClick={() => {
              setCustomValue(String(interval));
              setCustomOpen(true);
            }}
          >
            <Icon name="pencil" size={15} />
          </button>
        </div>
        {customOpen && (
          <div className="interval-custom fade-slide-in">
            <input
              type="number"
              min={1}
              max={240}
              inputMode="numeric"
              aria-label="Interval in minuten"
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value);
                const minutes = Number(e.target.value);
                if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 240) {
                  applyInterval(minutes);
                }
              }}
            />
            <span>minuten</span>
          </div>
        )}
      </div>

      {tracker.tripId ? (
        <div className="tracking-status">
          <button
            className="btn btn-danger"
            onClick={async () => {
              const ok = await confirmModal({
                title: 'Stoppen met tracken?',
                body: `De route van "${activeTrip?.title ?? 'deze reis'}" wordt niet verder bijgehouden. Wat al opgenomen is blijft staan.`,
                confirmLabel: 'Stoppen',
                danger: true,
              });
              if (ok) void stopTracking();
            }}
          >
            <Icon name="stop" size={15} /> Stop tracking
          </button>
          {tracker.lastError && <span className="error-text">{tracker.lastError}</span>}

          {/* The technical live-status bits are tucked behind an expander. */}
          <Collapsible summary="Details" className="tracking-advanced">
            <div className="tracking-advanced-body">
              <span className="settings-ok">● Actief: {activeTrip?.title ?? 'reis'}</span>
              <div className="tracking-live">
                {tracker.lastFix ? (
                  <>
                    <span className="tracking-live-dot" />
                    <div>
                      <strong>
                        {tracker.lastFix.lat.toFixed(5)}, {tracker.lastFix.lng.toFixed(5)}
                      </strong>
                      <span className="muted">
                        laatste fix{' '}
                        {fixAge === null ? '' : fixAge < 2 ? 'zojuist' : `${fixAge}s geleden`}
                        {tracker.lastFix.accuracy
                          ? ` · ±${Math.round(tracker.lastFix.accuracy)} m`
                          : ''}
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
                <span className="muted">
                  {tracker.buffered} punten in buffer (wacht op netwerk)
                </span>
              )}
              {tracker.lastStatus && (
                <span className="muted">Service: {tracker.lastStatus}</span>
              )}
              <TrackingLog now={now} />
            </div>
          </Collapsible>
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

      {!tracker.tripId && <TrackingLog now={now} />}
    </section>
  );
}

/** Persisted recent-fix log — proof tracking keeps recording, even backgrounded. */
function TrackingLog({ now }: { now: number }) {
  const log = getTrackingLog();
  if (log.length === 0) return null;
  return (
    <Collapsible className="tracking-log" summary={`Locatie-log · ${log.length} fixes`}>
      <ul>
        {log.slice(0, 25).map((e, i) => {
          const ago = Math.round((now - e.at) / 1000);
          return (
            <li key={i}>
              <span>
                {new Date(e.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                {ago < 3600 ? ` · ${Math.max(0, Math.round(ago / 60))}m geleden` : ''}
                {/* Whether this fix was stored, and how far it had moved — so a
                    working GPS is visible even when nothing is being saved. */}
                <em className={e.kept === false ? 'fix-skipped' : 'fix-kept'}>
                  {e.kept === false ? 'overgeslagen' : 'opgeslagen'}
                  {e.movedM !== undefined ? ` · ${e.movedM} m` : ''}
                </em>
              </span>
              <span className="muted">
                {e.lat.toFixed(4)}, {e.lng.toFixed(4)}
              </span>
            </li>
          );
        })}
      </ul>
    </Collapsible>
  );
}

/**
 * Expander with a real open/close animation in both directions. `<details>`
 * snaps open, so the body is a 0fr→1fr grid row that transitions instead.
 */
function Collapsible({
  summary,
  className = '',
  children,
}: {
  summary: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`collapsible ${className} ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="collapsible-summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="chevron-right" size={16} className="tracking-log-caret" />
        {summary}
      </button>
      <div className="collapsible-body">
        <div>{children}</div>
      </div>
    </div>
  );
}

function AboutSection({ onUnlockDev }: { onUnlockDev: () => void }) {
  const tapsRef = useRef(0);
  const [hint, setHint] = useState<string | null>(null);

  // Tap the version 7× to reveal the hidden Ontwikkelaar tab (Android-style).
  const tapVersion = () => {
    if (localStorage.getItem('mms.dev') === '1') return;
    tapsRef.current += 1;
    const left = 7 - tapsRef.current;
    if (left <= 0) {
      setHint(null);
      onUnlockDev();
    } else if (left <= 4) {
      setHint(`Nog ${left} keer tikken voor ontwikkelaarsopties…`);
    }
  };

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
      <button type="button" className="settings-version" onClick={tapVersion}>
        MarkMySteps
      </button>
      {hint && <span className="muted">{hint}</span>}
    </section>
  );
}

/** Hidden tab (unlocked from About) for testing-only tools. */
function DeveloperSection({ onLock }: { onLock: () => void }) {
  const navigate = useNavigate();
  return (
    <section className="card settings-card">
      <h2>Ontwikkelaar</h2>
      <p className="muted">Verborgen opties om dingen te testen.</p>
      <div className="field">
        <label>Rondleiding</label>
        <button
          type="button"
          className="btn btn-ghost settings-reset-sizes"
          onClick={() => {
            resetOnboarding();
            navigate('/onboarding');
          }}
        >
          Onboarding opnieuw bekijken
        </button>
      </div>
      <button type="button" className="btn btn-ghost settings-reset-sizes" onClick={onLock}>
        Ontwikkelaarsmodus verbergen
      </button>
    </section>
  );
}

/** Client-side resize to keep stored avatars tiny. */
function ProfileSection() {
  const { user, logout, refresh } = useAuth();
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
      setMessage('Profiel bijgewerkt. Zichtbaar na opnieuw laden.');
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
      setMessage('Wachtwoord gewijzigd. Andere sessies zijn uitgelogd, log opnieuw in.');
      setCurrentPassword('');
      setNewPassword('');
      window.setTimeout(logout, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wijzigen mislukt');
    }
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [photoMenuClosing, setPhotoMenuClosing] = useState(false);

  // Animate the popover away instead of unmounting it mid-frame.
  const closePhotoMenu = () => {
    setPhotoMenuClosing(true);
    window.setTimeout(() => {
      setPhotoMenu(false);
      setPhotoMenuClosing(false);
    }, 150);
  };
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [viewSrc, setViewSrc] = useState<string | null>(null);

  // Close the photo menu on any outside click.
  useEffect(() => {
    if (!photoMenu) return;
    document.addEventListener('click', closePhotoMenu);
    return () => document.removeEventListener('click', closePhotoMenu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoMenu]);

  async function uploadBlob(blob: Blob) {
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', blob, 'avatar.jpg');
      await api('/users/me/avatar', { method: 'POST', formData });
      await refresh(); // ensure hasAvatar is set
      if (user) bumpAvatar(user.id); // reload the image everywhere, now
      setMessage('Profielfoto opgeslagen.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload mislukt');
    }
  }

  // Load the current avatar (authorized) into an object URL for view/crop.
  async function currentAvatarUrl(): Promise<string | null> {
    if (!user) return null;
    try {
      return await fetchBlobUrl(`/users/${user.id}/avatar?v=${Date.now()}`);
    } catch {
      return null;
    }
  }

  async function removeAvatar() {
    await api('/users/me/avatar', { method: 'DELETE' });
    await refresh();
    if (user) bumpAvatar(user.id);
    setMessage('Profielfoto verwijderd.');
  }

  return (
    <section className="card settings-card">
      <h2>Profiel</h2>

      <div className="avatar-row">
        <button
          type="button"
          className="avatar-edit"
          title="Profielfoto"
          onClick={(e) => {
            e.stopPropagation();
            if (photoMenu) closePhotoMenu();
            else setPhotoMenu(true);
          }}
        >
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
          {photoMenu && (
            <div
              className={`avatar-menu card ${photoMenuClosing ? 'closing' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {user?.hasAvatar && (
                <button
                  type="button"
                  onClick={async () => {
                    closePhotoMenu();
                    setViewSrc(await currentAvatarUrl());
                  }}
                >
                  Foto bekijken
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  closePhotoMenu();
                  fileRef.current?.click();
                }}
              >
                Andere foto kiezen
              </button>
              {user?.hasAvatar && (
                <button
                  type="button"
                  onClick={async () => {
                    closePhotoMenu();
                    const url = await currentAvatarUrl();
                    if (url) setCropSrc(url);
                  }}
                >
                  Foto bijsnijden
                </button>
              )}
              {user?.hasAvatar && (
                <button
                  type="button"
                  className="avatar-menu-danger"
                  onClick={() => {
                    closePhotoMenu();
                    void removeAvatar();
                  }}
                >
                  Foto verwijderen
                </button>
              )}
            </div>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setCropSrc(URL.createObjectURL(file));
            e.target.value = '';
          }}
        />
        <div className="avatar-meta">
          <strong>{user?.displayName}</strong>
          {user?.username && <span className="avatar-handle">@{user.username}</span>}
        </div>
      </div>

      {cropSrc && (
        <AvatarCrop
          source={cropSrc}
          onCancel={() => setCropSrc(null)}
          onCropped={(blob) => {
            setCropSrc(null);
            void uploadBlob(blob);
          }}
        />
      )}
      {viewSrc && (
        <div className="avatar-view-backdrop" onClick={() => setViewSrc(null)}>
          <img src={viewSrc} alt="Profielfoto" />
        </div>
      )}

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
  // Until the request lands we hold the connection panel's space open, so the
  // card doesn't suddenly grow and shove the form down.
  const [loaded, setLoaded] = useState(false);
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
      })
      .finally(() => setLoaded(true));
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
      setMessage('Verbonden met Immich. API-key gevalideerd en versleuteld opgeslagen.');
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
      <h2>
        Immich
        <HelpTip>
          Koppel je eigen Immich-server. Foto's blijven dáár staan. MarkMySteps bewaart alleen
          verwijzingen (asset-id, tijdstip, GPS uit EXIF).
        </HelpTip>
      </h2>

      {!loaded && <div className="immich-status-skeleton" aria-hidden="true" />}
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
            <span className="inline-path">
              Immich <Icon name="chevron-right" size={12} /> Accountinstellingen{' '}
              <Icon name="chevron-right" size={12} /> API-keys
            </span>
            . Wordt AES-256 versleuteld opgeslagen.
          </span>
        </div>
        <div className="field">
          <label htmlFor="im-public">
            Publieke URL (optioneel)
            <HelpTip>
              Voor de “Openen in Immich”-knop. De server-URL hierboven mag een intern LAN-adres
              zijn; deze is het adres waarmee jij Immich in je browser/app opent.
            </HelpTip>
          </label>
          <input
            id="im-public"
            type="url"
            placeholder="https://fotos.markmaaktmedia.nl"
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
          />
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

  const [loaded, setLoaded] = useState(false);

  function load() {
    api<AdminUserRow[]>('/admin/users')
      .then(setUsers)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
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
      <h2>
        Accounts (beheer)
        <HelpTip>
          Bij de eerste login kiezen ze zelf een eigen wachtwoord. Overslaan kan, dan blijven ze
          een herinnering zien tot ze het alsnog doen.
        </HelpTip>
      </h2>
      <p className="muted">Maak accounts voor vrienden met een tijdelijk wachtwoord.</p>

      {/* Hold the list's space while it loads, so the card doesn't jump. */}
      {!loaded && (
        <ul className="admin-users" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="admin-user-skeleton" />
          ))}
        </ul>
      )}
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
              <strong>{trip.title}</strong> · {formatDate(trip.startDate)} t/m{' '}
              {formatDate(trip.endDate)}, {trip.pointsImported.toLocaleString('nl-NL')} routepunten
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
