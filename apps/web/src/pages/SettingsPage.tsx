import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { isNativeApp, openExternal, resetOnboarding } from '../lib/native';
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
import { ServerSteps } from '../components/LocalModeSheet';
import { LogoMark } from '../components/Logo';
import { TrackPointsEditor } from '../components/TrackPointsEditor';
import {
  checkForUpdate,
  isUpdateBannerSimulated,
  setUpdateBannerSimulated,
} from '../components/UpdateBanner';
import {
  backupSize,
  createBackup,
  readBackupFile,
  restoreBackup,
  saveBackup,
} from '../lib/backup';
import { formatDate } from '../lib/colors';
import { reversePlaceName } from '../lib/geocode';
import { clearThumbCache, enforceThumbBudget, thumbCacheUsage } from '../lib/offlineCache';
import { isLocalMode } from '../lib/localMode';
import { useExit } from '../lib/useExit';
import {
  MAP_STYLES,
  MapStyleId,
  ThemeId,
  TripCardSize,
  clearTripCardOverrides,
  getMapStyleId,
  getThemeId,
  getShowSelfOnHome,
  getMapStyle,
  getThumbCacheLimitMb,
  getTrackingIntervalMin,
  getTripCardSize,
  hasTripCardOverrides,
  setMapStyleId,
  setShowSelfOnHome,
  setThemeId,
  setThumbCacheLimitMb,
  setTrackingIntervalMin,
  setTripCardSize,
} from '../lib/prefs';
import {
  FixLogEntry,
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

  // The app keeps the scroll position of the page you came from, which lands
  // you halfway down a settings page you have just opened.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.scrollingElement?.scrollTo({ top: 0 });
  }, [section]);
  const [devUnlocked, setDevUnlocked] = useState(localStorage.getItem('mms.dev') === '1');

  const sections: { id: SectionId; label: string; show: boolean }[] = [
    { id: 'profile', label: 'Profiel', show: true },
    { id: 'display', label: 'Weergave', show: true },
    { id: 'preferences', label: 'Voorkeuren', show: true },
    { id: 'immich', label: 'Diensten', show: true },
    { id: 'import', label: 'Gegevens', show: true },
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
          {section === 'profile' && (
            <>
              <LocalModeCard />
              <ProfileSection />
            </>
          )}
          {section === 'display' && <DisplaySection />}
          {section === 'preferences' && <PreferencesSection />}
          {section === 'immich' && <ImmichSection />}
          {section === 'import' && (
            <>
              <BackupSection />
              <PolarstepsSection />
              <PhotoCacheSection />
            </>
          )}
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
    { id: 'compact', label: 'Klein' },
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

/**
 * Photos you have looked at are kept for offline viewing. Without a ceiling
 * that quietly grows into hundreds of megabytes on a photo-heavy account, so
 * the ceiling is a choice — and it lives here, next to the other things that
 * move data in and out of the app.
 */
function PhotoCacheSection() {
  const LIMITS = [100, 250, 500, 1000];
  const [limit, setLimit] = useState(getThumbCacheLimitMb());
  const [customOpen, setCustomOpen] = useState(
    !LIMITS.includes(getThumbCacheLimitMb()) && getThumbCacheLimitMb() !== 0,
  );
  const [customValue, setCustomValue] = useState(String(getThumbCacheLimitMb()));
  const [usage, setUsage] = useState(0);
  const [clearing, setClearing] = useState(false);

  const refreshUsage = () => {
    void thumbCacheUsage().then(setUsage);
  };
  useEffect(refreshUsage, []);

  const applyLimit = (mb: number) => {
    setLimit(mb);
    setThumbCacheLimitMb(mb);
    // Lowering it should take effect now, not the next time a photo loads.
    void enforceThumbBudget().then(refreshUsage);
  };

  const limitBytes = limit * 1024 * 1024;
  const filled = limitBytes > 0 ? Math.min(1, usage / limitBytes) : 0;

  return (
    <section className="card settings-card">
      <h2>
        Foto-cache
        <HelpTip>
          Foto's die je bekijkt worden bewaard, zodat je ze zonder internet terugziet. Zonder
          grens groeit dat op een volle account door tot honderden megabytes; bereikt de cache de
          grens, dan verdwijnen de foto's die je het langst niet hebt bekeken als eerste.
        </HelpTip>
      </h2>

      <div className="cache-meter" data-full={filled > 0.9}>
        <div className="cache-meter-bar" style={{ width: `${Math.round(filled * 100)}%` }} />
      </div>
      <span className="muted cache-usage">
        {formatBytes(usage)} in gebruik
        {limit > 0 ? ` van ${limit >= 1000 ? `${limit / 1000} GB` : `${limit} MB`}` : ' (geen grens)'}
      </span>

      <div className="field">
        <label>Maximale grootte</label>
        <div className="theme-choice theme-choice-wrap">
          {LIMITS.map((mb) => (
            <button
              key={mb}
              type="button"
              className={`theme-opt ${!customOpen && limit === mb ? 'active' : ''}`}
              onClick={() => {
                setCustomOpen(false);
                applyLimit(mb);
              }}
            >
              {mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`}
            </button>
          ))}
          <button
            type="button"
            className={`theme-opt ${limit === 0 ? 'active' : ''}`}
            onClick={() => {
              setCustomOpen(false);
              applyLimit(0);
            }}
          >
            Geen grens
          </button>
          <button
            type="button"
            className={`theme-opt theme-opt-icon ${customOpen ? 'active' : ''}`}
            title="Eigen grootte"
            aria-label="Eigen grootte"
            onClick={() => {
              setCustomValue(String(limit));
              setCustomOpen(true);
            }}
          >
            <Icon name="pencil" size={15} />
          </button>
        </div>
        <div className="cache-custom" data-open={customOpen}>
          <div className="cache-custom-inner">
            <div className="interval-custom">
              <input
                type="number"
                min={20}
                max={20000}
                value={customValue}
                onChange={(e) => {
                  setCustomValue(e.target.value);
                  const mb = Number(e.target.value);
                  if (mb >= 20) applyLimit(mb);
                }}
              />
              <span>MB</span>
            </div>
          </div>
        </div>
      </div>

      <button
        className="btn btn-ghost"
        disabled={clearing || usage === 0}
        onClick={async () => {
          const ok = await confirmModal({
            title: 'Cache leegmaken?',
            body: "Bewaarde foto's worden gewist. Ze worden opnieuw opgehaald zodra je online bent — er gaat niets van je reizen verloren.",
            confirmLabel: 'Leegmaken',
            danger: true,
          });
          if (!ok) return;
          setClearing(true);
          await clearThumbCache();
          refreshUsage();
          setClearing(false);
        }}
      >
        <Icon name="trash" size={15} /> Cache leegmaken
      </button>
    </section>
  );
}

/** One file with everything, and the way to read it back. */
function BackupSection() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null,
  );
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Held on screen while it fades, and holding its text while it does.
  const [resultShown, resultClosing] = useExit(result !== null, 240);
  const lastResultRef = useRef('');
  if (result) lastResultRef.current = result;
  const lastResult = lastResultRef.current;

  async function runBackup() {
    setBusy(true);
    setResult(null);
    try {
      const backup = await createBackup((done, total, label) =>
        setProgress({ done, total, label }),
      );
      const where = await saveBackup(backup);
      setResult(`Opgeslagen als ${where} · ${formatBytes(backupSize(backup))}`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Back-up mislukt');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /**
   * Restores a picked file. Asks first — it can add trips to what is already
   * here, and that is not something to discover afterwards.
   */
  async function runRestore(file: File) {
    setResult(null);
    let backup;
    try {
      backup = await readBackupFile(file);
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Bestand kon niet gelezen worden');
      return;
    }
    const made = new Date(backup.createdAt).toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const ok = await confirmModal({
      title: 'Back-up terugzetten?',
      body: `Deze back-up is van ${made} en bevat ${backup.trips.length} ${
        backup.trips.length === 1 ? 'reis' : 'reizen'
      }. Reizen die je al hebt blijven zoals ze zijn; de rest wordt toegevoegd.`,
      confirmLabel: 'Terugzetten',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const restored = await restoreBackup(backup, { settings: true }, (done, total, label) =>
        setProgress({ done, total, label }),
      );
      const parts = [
        `${restored.tripsAdded} ${restored.tripsAdded === 1 ? 'reis' : 'reizen'} teruggezet`,
      ];
      if (restored.tripsSkipped > 0) parts.push(`${restored.tripsSkipped} overgeslagen`);
      if (restored.points > 0) parts.push(`${restored.points} routepunten`);
      if (restored.coversLost > 0) {
        parts.push("covers komen terug zodra je foto's gekoppeld zijn");
      }
      setResult(`${parts.join(' · ')}. Herlaad de app om alles te zien.`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Terugzetten mislukt');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <section className="card settings-card">
      <h2>
        Back-up
        <HelpTip>
          Eén bestand met al je reizen, stops, routepunten en notities, plus je instellingen.
          Foto's zitten er als verwijzing in, niet als bestand — die staan al in je galerij of op
          je Immich-server.
        </HelpTip>
      </h2>
      <p className="muted">
        Zet alles in één bestand in je Downloads-map, met daarna de deel-knop zodat je het meteen
        ergens veilig kunt neerzetten. Terugzetten voegt toe wat je nog niet hebt en laat
        bestaande reizen met rust.
      </p>

      {/* Grows out of the button while it runs, so a long export shows where
          it is instead of freezing on a spinner. */}
      <div className="backup-progress" data-open={busy}>
        <div className="backup-progress-inner">
          <div className="cache-meter">
            <div
              className="cache-meter-bar"
              style={{
                width: progress && progress.total > 0
                  ? `${Math.round((progress.done / progress.total) * 100)}%`
                  : '8%',
              }}
            />
          </div>
          <span className="muted">
            {progress?.label ? `${progress.label}…` : 'Verzamelen…'}
          </span>
        </div>
      </div>

      <div className="backup-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void runBackup()}>
          <Icon name="download" size={16} /> {busy ? 'Bezig…' : 'Back-up maken'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="archive" size={16} /> Terugzetten
        </button>
      </div>
      {/* The system picker is enough here: a WebView handles <input type=file>
          fine, and a plugin would only add a second way to do the same. */}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // so picking the same file twice still fires
          if (file) void runRestore(file);
        }}
      />
      {resultShown && (
        <p className={`muted settings-ok backup-result ${resultClosing ? 'leaving' : ''}`}>
          {lastResult}
        </p>
      )}
    </section>
  );
}

/** "1,4 GB" / "820 MB" / "64 kB". */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Shown only without a server: says where the data lives and offers the way
 * back to one. Leaving local mode keeps everything on the device — it just
 * returns to the login screen.
 */
function LocalModeCard() {
  const { logout } = useAuth();
  if (!isLocalMode()) return null;
  return (
    <section className="card settings-card local-card">
      <h2>
        <Icon name="cloud-off" size={18} /> Zonder server
      </h2>
      <p className="muted">
        Al je reizen, punten en notities staan op dit toestel. Er gaat niets naar buiten, en er is
        geen account nodig.
      </p>
      <p className="muted">
        Reisgenoten, deel-links en automatische back-ups hebben wel een server nodig. Koppel je er
        later een, dan wordt alles wat hier staat in één keer geüpload.
      </p>
      <button className="btn btn-ghost" onClick={logout}>
        Server koppelen
      </button>
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
  const [editDay, setEditDay] = useState(false);

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

  // Ongoing trips first, then the ones that haven't started. Anything already
  // finished is left out entirely.
  const today = new Date().toISOString().slice(0, 10);
  const trackableTrips = trips
    .filter((t) => t.endDate.slice(0, 10) >= today)
    .sort((a, b) => {
      const started = (t: Trip) => (t.startDate.slice(0, 10) <= today ? 0 : 1);
      return started(a) - started(b) || a.startDate.localeCompare(b.startDate);
    });

  return (
    <section className="card settings-card">
      <h2>
        Route-tracking
        <HelpTip>
          Elk interval zet de app de GPS heel even aan voor precies één positie en daarna weer
          uit; daartussen kost tracking niets. Blijf je op dezelfde plek, dan worden die metingen
          samengevoegd tot één punt in plaats van een wirwar van stipjes. Een groter interval
          scheelt dus flink batterij. Offline wordt alles gebufferd en later geüpload. Vereist
          locatie op “Altijd toestaan”.
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
        <div className="tracking-status tracking-swap">
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
              {tracker.lastFix ? (
                <LastFix
                  fix={tracker.lastFix}
                  ageSeconds={fixAge}
                  tripId={tracker.tripId}
                  onOpenMap={() => setEditDay(true)}
                />
              ) : (
                <div className="tracking-live">
                  <span className="muted">Wachten op eerste GPS-fix…</span>
                </div>
              )}
              {/* The trip page shows the same route with the photos mixed in;
                  what you want while checking the tracker is the bare fixes,
                  which is exactly what this opens. */}
              <button
                type="button"
                className="tracking-view-link"
                onClick={() => setEditDay(true)}
              >
                Punten van vandaag op de kaart
              </button>
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
        <div className="settings-form tracking-swap">
          <div className="field">
            <label>Reis</label>
            {/* Only trips you could still be travelling on: a finished trip has
                nothing left to record. */}
            <TripPicker trips={trackableTrips} value={selected} onChange={setSelected} />
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

      {editDay && tracker.tripId && (
        <TrackPointsEditor tripId={tracker.tripId} onClose={() => setEditDay(false)} />
      )}
    </section>
  );
}

/**
 * Trip chooser for tracking. A native <select> opens the system's own list,
 * which looks nothing like the rest of the app and can't show whether a trip is
 * already under way, so this is a plain popover instead.
 */
function TripPicker({
  trips,
  value,
  onChange,
}: {
  trips: Trip[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const chosen = trips.find((t) => t.id === value);

  const close = () => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 150);
  };

  // Tapping anywhere else puts it away.
  useEffect(() => {
    if (!open || closing) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, closing]);

  return (
    <div className="trip-picker" ref={wrapRef}>
      <button
        type="button"
        className="trip-picker-btn"
        aria-expanded={open}
        onClick={() => (open && !closing ? close() : setOpen(true))}
      >
        <span className={chosen ? '' : 'muted'}>{chosen?.title ?? 'Kies een reis'}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={`trip-picker-caret ${open && !closing ? 'open' : ''}`}
        />
      </button>
      {open && (
        <div className={`trip-picker-menu card ${closing ? 'closing' : ''}`}>
          {trips.map((t, i) => (
            <button
              key={t.id}
              type="button"
              className={t.id === value ? 'active' : ''}
              style={{ animationDelay: `${Math.min(i, 6) * 28}ms` }}
              onClick={() => {
                onChange(t.id);
                close();
              }}
            >
              <span className="trip-picker-name">
                {t.title}
                <small>{formatDate(t.startDate)}</small>
              </span>
              {t.startDate.slice(0, 10) <= today && (
                <span className="trip-picker-now">onderweg</span>
              )}
              <span className={`person-check ${t.id === value ? 'on' : ''}`}>
                <Icon name="check" size={15} />
              </span>
            </button>
          ))}
          {trips.length === 0 && (
            <span className="trip-picker-empty muted">
              Geen lopende of komende reizen. Maak er eerst een aan.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Persisted check log — one line per interval, proof tracking keeps running. */
function TrackingLog({ now }: { now: number }) {
  const log = getTrackingLog();
  const [full, setFull] = useState(false);
  if (log.length === 0) return null;
  return (
    <>
      <Collapsible
        className="tracking-log"
        // It sits inside the "Details" expander; needing a second press to see
        // anything was one press too many.
        defaultOpen
        summary={
          <>
            Locatie-log · {log.length} checks
            <button
              type="button"
              className="log-expand"
              aria-label="Log op volledig scherm"
              onClick={(e) => {
                e.stopPropagation();
                setFull(true);
              }}
            >
              <Icon name="external" size={14} />
            </button>
          </>
        }
      >
        <ul className="log-list">
          {log.slice(0, 25).map((entry, i) => (
            <LogRow key={entry.at + '-' + i} entry={entry} now={now} />
          ))}
        </ul>
      </Collapsible>
      {full && <TrackingLogSheet log={log} now={now} onClose={() => setFull(false)} />}
    </>
  );
}

/**
 * Where the last check landed.
 *
 * A pair of coordinates says nothing about whether the tracker is in the right
 * place. A name and a map do — so the place is looked up and the point is drawn
 * on it, and the numbers move to the second line where they belong.
 */
function LastFix({
  fix,
  ageSeconds,
  tripId,
  onOpenMap,
}: {
  fix: { lat: number; lng: number; at: number; accuracy?: number };
  ageSeconds: number | null;
  /** Whose route to draw behind the dot. */
  tripId: string | null;
  onOpenMap: () => void;
}) {
  const [place, setPlace] = useState<string | null>(null);
  const mapRef = useRef<HTMLButtonElement>(null);
  const mapObj = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // Rounded, so drifting a few metres doesn't re-ask on every fix.
  const key = `${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}`;
  useEffect(() => {
    let alive = true;
    void reversePlaceName(fix.lat, fix.lng).then((name) => alive && setPlace(name));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: getMapStyle(),
      center: [fix.lng, fix.lat],
      zoom: 13,
      interactive: false,
      attributionControl: false,
    });
    mapObj.current = map;
    const el = document.createElement('div');
    el.className = 'fix-marker';
    markerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([fix.lng, fix.lat])
      .addTo(map);
    return () => {
      map.remove();
      mapObj.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow later fixes without rebuilding the map.
  useEffect(() => {
    markerRef.current?.setLngLat([fix.lng, fix.lat]);
    mapObj.current?.easeTo({ center: [fix.lng, fix.lat], duration: 600 });
  }, [fix.lat, fix.lng]);

  /**
   * The day's own line behind the dot.
   *
   * One dot on a patch of forest says nothing about whether the tracker is
   * following you; the road you came in on does. Today's raw points, not the
   * smoothed trip route: this is the tracker's own view.
   */
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    const day = new Date().toISOString().slice(0, 10);
    void api<{ latitude: number; longitude: number }[]>(
      `/trips/${tripId}/points/day?day=${day}`,
    )
      .then((points) => {
        const map = mapObj.current;
        if (!alive || !map || points.length < 2) return;
        const coords = points.map((p) => [p.longitude, p.latitude] as [number, number]);
        const data: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        };
        const draw = () => {
          const existing = map.getSource('fix-line') as maplibregl.GeoJSONSource | undefined;
          if (existing) {
            existing.setData(data);
            return;
          }
          map.addSource('fix-line', { type: 'geojson', data });
          map.addLayer({
            id: 'fix-line',
            type: 'line',
            source: 'fix-line',
            paint: { 'line-color': '#3884ff', 'line-width': 2.5, 'line-opacity': 0.9 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
        };
        if (map.isStyleLoaded()) draw();
        else map.once('load', draw);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Re-read on every new fix: the line grows as you move.
  }, [tripId, fix.at]);

  return (
    <div className="last-fix">
      <button
        type="button"
        className="last-fix-map"
        aria-label="Punten van vandaag op de kaart"
        ref={mapRef}
        onClick={onOpenMap}
      />
      <div className="last-fix-body">
        <strong className="last-fix-place">
          <span className="tracking-live-dot" />
          <span>{place ?? 'Plaats opzoeken…'}</span>
        </strong>
        <span className="muted">
          laatste fix{' '}
          {ageSeconds === null ? '' : ageSeconds < 2 ? 'zojuist' : `${ageSeconds}s geleden`}
          {fix.accuracy ? ` · ±${Math.round(fix.accuracy)} m` : ''}
        </span>
        <span className="muted last-fix-coords">
          {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
        </span>
      </div>
    </div>
  );
}

/**
 * One check.
 *
 * Three columns rather than a run-on line: the time, what the check did, and
 * where. Wrapping a single sentence pushed the "same place" chip onto its own
 * line and left the coordinates dangling, which is what made the log hard to
 * read at a glance.
 */
function LogRow({ entry, now }: { entry: FixLogEntry; now: number }) {
  const ago = Math.round((now - entry.at) / 1000);
  const stayed = !!entry.stayCount;
  return (
    <li className="log-row" data-stay={stayed}>
      <span className="log-time">
        {new Date(entry.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
        <small>{ago < 3600 ? `${Math.max(0, Math.round(ago / 60))} min` : ''}</small>
      </span>
      <span className="log-what">
        <span className="log-moved">
          {entry.movedM !== undefined ? `${entry.movedM} m` : 'start'}
        </span>
        {entry.accuracyM !== undefined && (
          <span className="log-acc">±{entry.accuracyM} m</span>
        )}
        {stayed && (
          <span className="log-stay" title={`Zelfde plek, ${entry.stayCount} metingen samengevoegd`}>
            ×{entry.stayCount}
          </span>
        )}
      </span>
      <span className="log-coords">
        {entry.lat.toFixed(4)}
        <br />
        {entry.lng.toFixed(4)}
      </span>
    </li>
  );
}

/** The same log, full screen, where every row fits on one line. */
function TrackingLogSheet({
  log,
  now,
  onClose,
}: {
  log: FixLogEntry[];
  now: number;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    // Back closes the sheet rather than leaving the settings page.
    window.history.pushState({ mmsLog: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      close();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      if (!popped) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className={`log-layer ${closing ? 'closing' : ''}`}>
      <header className="log-head">
        <button type="button" className="te-icon-btn" aria-label="Sluiten" onClick={close}>
          <Icon name="close" size={20} />
        </button>
        <div className="log-head-title">
          <strong>Locatie-log</strong>
          <small>{log.length} checks</small>
        </div>
      </header>
      <ul className="log-list log-list-full">
        {log.map((entry, i) => (
          <LogRow key={entry.at + '-' + i} entry={entry} now={now} />
        ))}
      </ul>
    </div>,
    document.body,
  );
}

/**
 * Expander with a real open/close animation in both directions. `<details>`
 * snaps open, so the body is a 0fr→1fr grid row that transitions instead.
 */
function Collapsible({
  summary,
  className = '',
  defaultOpen = false,
  children,
}: {
  summary: ReactNode;
  className?: string;
  /** For an expander that lives inside another one: opening the outer should
   *  not leave you with a second thing to press before you see anything. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
      {/* The brand row doubles as the seven-tap target for developer options —
          a second "MarkMySteps" underneath was just repeating itself. */}
      <button type="button" className="about-brand" onClick={tapVersion}>
        <LogoMark size={44} />
        <span className="about-brand-name">MarkMySteps</span>
      </button>
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
      {/* Without a server, this is also the answer to "how do I get back?" —
          so it lives where you would go looking for it. */}
      {isLocalMode() && <ServerSteps />}
      {isNativeApp() && <UpdateCheck />}
      {hint && <span className="muted">{hint}</span>}
    </section>
  );
}

/**
 * Manual "am I up to date?".
 *
 * The banner only appears for a version you have not dismissed, so there was
 * no way to ask on purpose. This one ignores that: if there is a newer build
 * it says so, even one you waved away earlier.
 */
function UpdateCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; url?: string } | null>(null);
  const [shown, closing] = useExit(result !== null, 240);
  const lastRef = useRef<{ text: string; url?: string } | null>(null);
  if (result) lastRef.current = result;
  const last = lastRef.current;

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const { current, latest, newer } = await checkForUpdate(true);
      if (newer && latest?.url) {
        setResult({ text: `Versie ${latest.version} is beschikbaar.`, url: latest.url });
      } else {
        setResult({ text: `Je bent bij. Build ${current} is de nieuwste.` });
      }
    } catch {
      setResult({ text: 'Kon niet controleren. Ben je online?' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="update-check">
      <button className="btn btn-ghost" disabled={busy} onClick={() => void run()}>
        <Icon name="download" size={15} /> {busy ? 'Controleren…' : 'Check op updates'}
      </button>
      {shown && last && (
        <p className={`muted update-check-result ${closing ? 'leaving' : ''}`}>
          {last.text}
          {last.url && (
            <button className="ext-link" onClick={() => openExternal(last.url!)}>
              Downloaden <Icon name="chevron-right" size={13} />
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Hidden tab (unlocked from About) for testing-only tools. */
function DeveloperSection({ onLock }: { onLock: () => void }) {
  const navigate = useNavigate();
  const [simulating, setSimulating] = useState(isUpdateBannerSimulated());
  return (
    <section className="card settings-card">
      <h2>Ontwikkelaar</h2>
      <p className="muted">Verborgen opties om dingen te testen.</p>
      <div className="field">
        <label>Schermen bekijken</label>
        <div className="dev-buttons">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              resetOnboarding();
              navigate('/onboarding');
            }}
          >
            Onboarding
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/login')}>
            Inlogscherm
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/preview/pending')}
          >
            Wachten op goedkeuring
          </button>
        </div>
        <span className="muted">
          Dit zijn de echte schermen, niet een kopie — wat je hier ziet is wat een nieuwe gebruiker
          ziet. De onboarding toont de vragen over je naam en je fotobibliotheek alleen zonder
          server; met een server hoort dat er niet te staan.
        </span>
      </div>
      <div className="field">
        <label>Update-melding</label>
        <button
          type="button"
          className="btn btn-ghost settings-reset-sizes"
          onClick={() => {
            setUpdateBannerSimulated(!simulating);
            setSimulating(!simulating);
          }}
        >
          {simulating ? 'Nepbanner uitzetten' : 'Nepbanner tonen'}
        </button>
        <span className="muted">
          Toont de balk alsof er een nieuwe versie klaarstaat. Downloaden doet niets.
        </span>
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
          Immich is een gratis, open-source fotobibliotheek die je zelf draait: je eigen Google
          Photos, maar op je eigen server. Heb je die niet, dan hoef je hier niets in te vullen —
          MarkMySteps gebruikt dan de galerij van je toestel.
          <br />
          <br />
          Koppel je 'm wel, dan blijven je foto's dáár staan. MarkMySteps bewaart alleen
          verwijzingen: het asset-id, het tijdstip en de GPS uit de EXIF. Je API-sleutel gaat
          versleuteld de database in.
          <br />
          <br />
          <a
            href="https://immich.app"
            target="_blank"
            rel="noreferrer"
            className="ext-link"
            onClick={(e) => e.stopPropagation()}
          >
            immich.app <Icon name="external" size={12} />
          </a>
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
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  mustChangePassword: boolean;
  createdAt: string;
  tripCount: number;
}

/**
 * Sign-up requests, at the top because they are the only thing on this page
 * that is waiting on you.
 *
 * The refusal is the server's: a pending account's token is rejected
 * everywhere except the status check. This is only where the decision is made.
 */
function PendingRequests({
  rows,
  onDecide,
}: {
  rows: AdminUserRow[];
  onDecide: (row: AdminUserRow, approve: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, closing] = useExit(rows.length > 0, 260);
  const lastRows = useRef<AdminUserRow[]>(rows);
  if (rows.length > 0) lastRows.current = rows;
  if (!shown) return null;

  return (
    <section className={`card settings-card admin-pending ${closing ? 'leaving' : ''}`}>
      <h2>
        <Icon name="people" size={18} />
        {lastRows.current.length === 1 ? '1 aanvraag' : `${lastRows.current.length} aanvragen`}
      </h2>
      <p className="muted">
        Deze mensen hebben zich aangemeld op je server. Tot je ze toelaat kunnen ze niets: hun
        sessie wordt overal geweigerd.
      </p>
      <ul className="admin-users">
        {lastRows.current.map((row) => (
          <li key={row.id} className="admin-request">
            <div className="admin-user-info">
              <strong>
                {row.displayName} <small className="muted">@{row.username}</small>
              </strong>
              <span className="muted">
                {row.email} · aangemeld {formatDate(row.createdAt)}
              </span>
            </div>
            <div className="admin-user-actions">
              <button
                className="btn btn-ghost"
                disabled={busy === row.id}
                onClick={async () => {
                  setBusy(row.id);
                  await onDecide(row, false);
                  setBusy(null);
                }}
              >
                Afwijzen
              </button>
              <button
                className="btn btn-primary"
                disabled={busy === row.id}
                onClick={async () => {
                  setBusy(row.id);
                  await onDecide(row, true);
                  setBusy(null);
                }}
              >
                <Icon name="check" size={15} /> Toelaten
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
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

  async function decideRequest(row: AdminUserRow, approve: boolean) {
    setError(null);
    setMessage(null);
    if (!approve) {
      const ok = await confirmModal({
        title: `Aanvraag van ${row.displayName} afwijzen?`,
        body: 'Diegene kan niet inloggen. Het account blijft bestaan, zodat dezelfde naam en e-mail niet meteen opnieuw gebruikt kunnen worden.',
        confirmLabel: 'Afwijzen',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await api(`/admin/users/${row.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' });
      setMessage(
        approve
          ? `${row.displayName} is toegelaten. Diegene krijgt bericht zodra de app kijkt.`
          : `Aanvraag van ${row.displayName} afgewezen.`,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mislukt');
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

  const requests = users.filter((u) => u.status === 'PENDING');
  const settled = users.filter((u) => u.status !== 'PENDING');

  return (
    <>
      <PendingRequests rows={requests} onDecide={decideRequest} />

      <section className="card settings-card">
      <h2>
        Accounts (beheer)
        <HelpTip>
          Wie zich aanmeldt komt eerst in de wachtrij: pas als jij die aanvraag toelaat kan diegene
          iets. Maak je hier zelf een account aan, dan is dat meteen goedgekeurd. Bij de eerste
          login kiezen ze een eigen wachtwoord; overslaan kan, dan blijven ze een herinnering zien.
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
        {settled.map((row) => (
          <li key={row.id}>
            <div className="admin-user-info">
              <strong>
                {row.displayName} <small className="muted">@{row.username}</small>
              </strong>
              <span className="muted">
                {row.email} · {row.tripCount} {row.tripCount === 1 ? 'reis' : 'reizen'}
                {row.role === 'ADMIN' && ' · admin'}
                {row.status === 'REJECTED' && ' · afgewezen'}
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
    </>
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
