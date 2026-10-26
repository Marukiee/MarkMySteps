import { CSSProperties, FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from '../lib/mapgl';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { downloadAndInstall } from '../lib/appUpdate';
import { alwaysLabel, isAndroidApp, isIosApp, isNativeApp } from '../lib/native';
import { api, ApiError, fetchBlobUrl, getServerBase, setServerBase } from '../api/client';
import { CHANGELOG } from '../lib/changelog';
import { AirportPrefs } from '../components/AirportPrefs';
import { AvatarCrop } from '../components/AvatarCrop';
import type { ConnectionStatus, ImportedTripSummary } from '../api/types';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_SERVER_URL } from '../config';
import { Avatar, bumpAvatar } from '../components/Avatar';
import { confirmModal } from '../components/confirm';
import { TrackFiles } from '../components/TrackFiles';
import { TwoFactorSection } from '../components/TwoFactorSection';
import { HelpTip } from '../components/HelpTip';
import { previewInvitePopup } from '../components/InvitePopup';
import { Icon } from '../components/Icon';
import { ServerSteps } from '../components/LocalModeSheet';
import { LogoMark } from '../components/Logo';
import { PasswordStrength } from '../components/PasswordStrength';
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
import { isLocalMode, travellersTabLabel } from '../lib/localMode';
import {
  backgroundNotifyOn,
  disableBackgroundNotify,
  enableBackgroundNotify,
} from '../lib/notify';
import { applyDynamicAccent, dynamicAccentAvailable } from '../lib/dynamicColor';
import { MapStylePicker } from '../components/MapStylePicker';
import { tr } from '../i18n/rich';
import { getLangSetting, intlLocale, LANGUAGES, LangSetting, setLangSetting, t } from '../i18n';
import { skipNextPop, useBackToClose } from '../lib/backStack';
import { useExit } from '../lib/useExit';
import {
  GlobeStopsMode,
  NavBarMode,
  ThemeId,
  TripCardSize,
  clearTripCardOverrides,
  getGlobeStops,
  getNavBarMode,
  setNavBarMode,
  isDynamicAccent,
  getThemeId,
  getShowSelfOnHome,
  getMapStyle,
  getThumbCacheLimitMb,
  getTrackingIntervalMin,
  getTripCardSize,
  hasTripCardOverrides,
  setGlobeStops,
  setShowSelfOnHome,
  setDynamicAccent,
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

/**
 * The section a link asks for. Only the requests are linked to: the bell's line
 * about a sign-up, and the phone notification behind it, land on them.
 */
function linkedSection(params: URLSearchParams): SectionId | null {
  return params.get('section') === 'accounts' ? 'accounts' : null;
}

export function SettingsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [section, setSection] = useState<SectionId>(() => linkedSection(params) ?? 'profile');

  // Also when Settings is already open behind the bell. The address is put
  // back after, so a later visit opens on the profile as always.
  useEffect(() => {
    const linked = linkedSection(params);
    if (!linked) return;
    setSection(linked);
    setParams({}, { replace: true });
  }, [params, setParams]);

  // The app keeps the scroll position of the page you came from, which lands
  // you halfway down a settings page you have just opened.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.scrollingElement?.scrollTo({ top: 0 });
  }, [section]);
  const [devUnlocked, setDevUnlocked] = useState(localStorage.getItem('mms.dev') === '1');

  const sections: { id: SectionId; label: string; show: boolean }[] = [
    { id: 'profile', label: t('settings.nav.profile'), show: true },
    { id: 'display', label: t('settings.nav.display'), show: true },
    { id: 'preferences', label: t('settings.nav.preferences'), show: true },
    { id: 'immich', label: t('settings.nav.services'), show: true },
    { id: 'import', label: t('settings.nav.data'), show: true },
    { id: 'accounts', label: t('settings.nav.accounts'), show: user?.role === 'ADMIN' },
    { id: 'about', label: t('settings.nav.about'), show: true },
    { id: 'developer', label: t('settings.nav.developer'), show: devUnlocked },
  ];

  return (
    <main className="page fade-in settings-page">
      <h1>{t('common.settings')}</h1>
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
          {section === 'immich' && (
            <>
              {/* Coupling a server IS a service, and this is the tab someone
                  opens looking for one. It also sits under Profiel, because
                  that is where the account it replaces lives. */}
              <LocalModeCard />
              {!isLocalMode() && <ServerSection />}
              <ImmichSection />
            </>
          )}
          {section === 'import' && (
            <>
              <BackupSection />
              <PolarstepsSection />
              <TrackFiles />
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

/**
 * Which language the app speaks. The names of the languages are always in
 * their own language, so someone who cannot read the current one still finds
 * theirs.
 */
function LanguageCard() {
  const current = getLangSetting();
  const options: { id: LangSetting; label: string }[] = [
    { id: 'system', label: t('common.system') },
    ...LANGUAGES.map((l) => ({ id: l.id, label: l.name })),
  ];
  return (
    <section className="card settings-card">
      <h2>{t('app.language.title')}</h2>
      {/* The wrapping kind, not the sliding pill: a language's own name is as
          long as it is, and three equal columns of them do not fit on a phone. */}
      <div className="theme-choice theme-choice-wrap">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`theme-opt ${current === o.id ? 'active' : ''}`}
            onClick={() => setLangSetting(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="muted">{t('app.language.hint')}</span>
    </section>
  );
}

function DisplaySection() {
  const [theme, setTheme] = useState<ThemeId>(getThemeId());
  const [wallpaperAccent, setWallpaperAccent] = useState(isDynamicAccent());
  const [cardSize, setCardSize] = useState<TripCardSize>(getTripCardSize());
  const [hasOverrides, setHasOverrides] = useState(hasTripCardOverrides());
  const [navBar, setNavBar] = useState<NavBarMode>(getNavBarMode());

  const themes: { id: ThemeId; label: string }[] = [
    { id: 'system', label: t('common.system') },
    { id: 'light', label: t('settings.display.theme.light') },
    { id: 'dark', label: t('settings.display.theme.dark') },
  ];
  const cardSizes: { id: TripCardSize; label: string }[] = [
    // "Automatisch" needs more room than a third of the switch, and wrapped to
    // two lines inside its own pill. The ⋯ menu on a card says "Auto" too.
    { id: 'auto', label: t('common.auto') },
    { id: 'large', label: t('settings.display.cards.large') },
    { id: 'compact', label: t('settings.display.cards.compact') },
  ];
  const navBars: { id: NavBarMode; label: string }[] = [
    { id: 'auto', label: t('common.automatic') },
    { id: 'always', label: t('common.always') },
  ];

  return (
    <>
      <LanguageCard />
      <section className="card settings-card">
        <h2>{t('settings.display.theme.title')}</h2>
        <div
          className="theme-choice pill-switch"
          style={{ '--n': themes.length, '--i': Math.max(0, themes.findIndex((th) => th.id === theme)) } as CSSProperties}
        >
          {themes.map((th) => (
            <button
              key={th.id}
              type="button"
              className={`theme-opt ${theme === th.id ? 'active' : ''}`}
              onClick={() => {
                setTheme(th.id);
                setThemeId(th.id);
              }}
            >
              {th.label}
            </button>
          ))}
        </div>
        <span className="muted">{t('settings.display.theme.hint')}</span>
        {isNative() && dynamicAccentAvailable() && (
          <label className="settings-toggle">
            <div>
              <strong>{t('settings.display.wallpaperAccent.title')}</strong>
              <span className="muted">
                {t('settings.display.wallpaperAccent.hint')}
              </span>
            </div>
            <input
              type="checkbox"
              checked={wallpaperAccent}
              onChange={(e) => {
                setWallpaperAccent(e.target.checked);
                setDynamicAccent(e.target.checked);
                applyDynamicAccent();
              }}
            />
          </label>
        )}
      </section>
      <section className="card settings-card">
        <h2>{t('settings.display.cards.title')}</h2>
        <div
          className="theme-choice pill-switch"
          style={{ '--n': cardSizes.length, '--i': Math.max(0, cardSizes.findIndex((c) => c.id === cardSize)) } as CSSProperties}
        >
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
          {t('settings.display.cards.hint')}
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
            {t('settings.display.cards.reset')}
          </button>
        )}
      </section>
      <section className="card settings-card">
        <h2>{t('settings.display.navBar.title')}</h2>
        <div
          className="theme-choice pill-switch"
          style={{ '--n': navBars.length, '--i': Math.max(0, navBars.findIndex((n) => n.id === navBar)) } as CSSProperties}
        >
          {navBars.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`theme-opt ${navBar === n.id ? 'active' : ''}`}
              onClick={() => {
                setNavBar(n.id);
                setNavBarMode(n.id);
              }}
            >
              {n.label}
            </button>
          ))}
        </div>
        <span className="muted">
          {t('settings.display.navBar.hint', { travellers: travellersTabLabel() })}
        </span>
      </section>
      <section className="card settings-card">
        <h2>{t('settings.display.mapStyle.title')}</h2>
        <MapStylePicker />
        <span className="muted">{t('settings.display.mapStyle.hint')}</span>
      </section>
    </>
  );
}

/**
 * Photos you have looked at are kept for offline viewing. Without a ceiling
 * that quietly grows into hundreds of megabytes on a photo-heavy account, so
 * the ceiling is a choice — and it lives here, next to the other things that
 * move data in and out of the app.
 */
function PhotoCacheSection() {
  // Four choices, because five wrapped onto a second line on a phone and the
  // row read as two rows of unrelated buttons. Anything between them is what
  // the pencil is for.
  const LIMITS = [250, 1000];
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
        {t('settings.photoCache.title')}
        <HelpTip>
          {t('settings.photoCache.help')}
        </HelpTip>
      </h2>

      <div className="cache-meter" data-full={filled > 0.9}>
        <div className="cache-meter-bar" style={{ width: `${Math.round(filled * 100)}%` }} />
      </div>
      <span className="muted cache-usage">
        {limit > 0
          ? t('settings.photoCache.usage', {
              used: formatBytes(usage),
              limit: limit >= 1000 ? `${limit / 1000} GB` : `${limit} MB`,
            })
          : t('settings.photoCache.usageNoLimit', { used: formatBytes(usage) })}
      </span>

      <div className="field">
        <label>{t('settings.photoCache.maxSize')}</label>
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
            {t('settings.photoCache.noLimit')}
          </button>
          <button
            type="button"
            className={`theme-opt theme-opt-icon ${customOpen ? 'active' : ''}`}
            title={t('settings.photoCache.custom')}
            aria-label={t('settings.photoCache.custom')}
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
            title: t('settings.photoCache.clearConfirm.title'),
            body: t('settings.photoCache.clearConfirm.body'),
            confirmLabel: t('settings.photoCache.clearConfirm.confirm'),
            danger: true,
          });
          if (!ok) return;
          setClearing(true);
          await clearThumbCache();
          refreshUsage();
          setClearing(false);
        }}
      >
        <Icon name="trash" size={15} /> {t('settings.photoCache.clear')}
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
      setResult(t('settings.backup.saved', { where, size: formatBytes(backupSize(backup)) }));
    } catch (err) {
      setResult(err instanceof Error ? err.message : t('settings.backup.failed'));
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
      setResult(err instanceof Error ? err.message : t('settings.backup.readFailed'));
      return;
    }
    const made = new Date(backup.createdAt).toLocaleDateString(intlLocale(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const ok = await confirmModal({
      title: t('settings.backup.restoreConfirm.title'),
      body: t('settings.backup.restoreConfirm.body', { date: made, count: backup.trips.length }),
      confirmLabel: t('settings.backup.restore'),
    });
    if (!ok) return;

    setBusy(true);
    try {
      const restored = await restoreBackup(backup, { settings: true }, (done, total, label) =>
        setProgress({ done, total, label }),
      );
      const parts = [t('settings.backup.restored.trips', { count: restored.tripsAdded })];
      if (restored.tripsSkipped > 0) {
        parts.push(t('settings.backup.restored.skipped', { count: restored.tripsSkipped }));
      }
      if (restored.points > 0) {
        parts.push(t('settings.backup.restored.points', { count: restored.points }));
      }
      if (restored.coversLost > 0) {
        parts.push(t('settings.backup.restored.coversLost'));
      }
      setResult(t('settings.backup.restored.summary', { parts: parts.join(' · ') }));
    } catch (err) {
      setResult(err instanceof Error ? err.message : t('settings.backup.restoreFailed'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <section className="card settings-card">
      <h2>
        {t('settings.backup.title')}
        <HelpTip>
          {t('settings.backup.help')}
        </HelpTip>
      </h2>
      <p className="muted">
        {t('settings.backup.intro', {
          where: t(isIosApp() ? 'settings.backup.whereIos' : 'settings.backup.whereAndroid'),
        })}
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
            {progress?.label ? `${progress.label}…` : t('settings.backup.collecting')}
          </span>
        </div>
      </div>

      <div className="backup-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void runBackup()}>
          <Icon name="download" size={16} /> {busy ? t('settings.busy') : t('settings.backup.create')}
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="archive" size={16} /> {t('settings.backup.restore')}
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
        <Icon name="cloud-off" size={18} /> {t('settings.local.title')}
      </h2>
      <p className="muted">
        {t('settings.local.card.stored')}
      </p>
      <p className="muted">
        {t('settings.local.card.needsServer')}
      </p>
      <button className="btn btn-ghost" onClick={logout}>
        {t('settings.local.connect')}
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
          {t('settings.airports.title')}
          <HelpTip>
            {t('settings.airports.help')}
          </HelpTip>
        </h2>
        <p className="muted">{t('settings.airports.hint')}</p>
        <AirportPrefs />
      </section>
      <GlobeSection />
      {isNative() && <SelfLocationSection />}
      {isNative() && <NotifySection />}
      {isNative() && <TrackingSection />}
    </>
  );
}

/**
 * Meldingen op de telefoon zelf.
 *
 * There is no push service on these phones, so the app cannot be told
 * anything — it has to look. Every quarter of an hour it asks the server
 * whether something is waiting and posts the notification itself, which is
 * why this is a switch rather than something that is simply on.
 */
function NotifySection() {
  const [on, setOn] = useState(backgroundNotifyOn());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setMessage(null);
    if (next) {
      const result = await enableBackgroundNotify();
      if (result.ok) {
        setOn(true);
        setMessage(t('settings.notify.on'));
      } else {
        setMessage(
          result.reason === 'denied'
            ? t('settings.notify.denied')
            : t('settings.notify.failed'),
        );
      }
    } else {
      await disableBackgroundNotify();
      setOn(false);
      setMessage(null);
    }
    setBusy(false);
  }

  return (
    <section className="card settings-card">
      <h2>
        {t('settings.notify.title')}
        <HelpTip>
          {t('settings.notify.help')}
        </HelpTip>
      </h2>
      <label className="ts-toggle settings-toggle">
        <div>
          <strong>{t('settings.notify.toggle')}</strong>
          <span className="muted">
            {t('settings.notify.toggleHint')}
          </span>
        </div>
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </label>
      {message && <p className="muted">{message}</p>}
    </section>
  );
}

/** How much of a trip the homepage globe draws when it isn't the one on show. */
function GlobeSection() {
  const [mode, setMode] = useState<GlobeStopsMode>(getGlobeStops());
  const pick = (next: GlobeStopsMode) => {
    setMode(next);
    setGlobeStops(next);
  };
  return (
    <section className="card settings-card">
      <h2>
        {t('settings.globe.title')}
        <HelpTip>
          {t('settings.globe.help')}
        </HelpTip>
      </h2>
      <p className="muted">{t('settings.globe.hint')}</p>
      <div className="settings-seg" role="tablist" data-on={mode}>
        {/* One pill that slides, the way the trip's tabs do. */}
        <span className="settings-seg-thumb" aria-hidden="true" />
        <button
          role="tab"
          aria-selected={mode === 'highlight'}
          className={mode === 'highlight' ? 'active' : ''}
          onClick={() => pick('highlight')}
        >
          {t('settings.globe.highlight')}
        </button>
        <button
          role="tab"
          aria-selected={mode === 'always'}
          className={mode === 'always' ? 'active' : ''}
          onClick={() => pick('always')}
        >
          {t('common.always')}
        </button>
      </div>
    </section>
  );
}

/** Where your own live position may be drawn. */
function SelfLocationSection() {
  const [onHome, setOnHome] = useState(getShowSelfOnHome());
  return (
    <section className="card settings-card">
      <h2>
        {t('settings.selfLocation.title')}
        <HelpTip>
          {t('settings.selfLocation.help')}
        </HelpTip>
      </h2>
      <p className="muted">{t('settings.selfLocation.hint')}</p>
      <label className="settings-toggle">
        <div>
          <strong>{t('settings.selfLocation.home')}</strong>
          <span className="muted">{t('settings.selfLocation.homeHint')}</span>
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
        {t('settings.tracking.title')}
        <HelpTip>
          {t('settings.tracking.help', { always: alwaysLabel() })}
        </HelpTip>
      </h2>
      <p className="muted">{t('settings.tracking.hint')}</p>

      <div className="field">
        <label>{t('settings.tracking.interval')}</label>
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
            title={t('settings.tracking.customInterval')}
            aria-label={t('settings.tracking.customInterval')}
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
              aria-label={t('settings.tracking.intervalLabel')}
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value);
                const minutes = Number(e.target.value);
                if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 240) {
                  applyInterval(minutes);
                }
              }}
            />
            <span>{t('settings.tracking.minutes')}</span>
          </div>
        )}
      </div>

      {tracker.tripId ? (
        <div className="tracking-status tracking-swap">
          <button
            className="btn btn-danger"
            onClick={async () => {
              const ok = await confirmModal({
                title: t('settings.tracking.stopConfirm.title'),
                body: t('settings.tracking.stopConfirm.body', {
                  title: activeTrip?.title ?? t('settings.tracking.stopConfirm.thisTrip'),
                }),
                confirmLabel: t('settings.tracking.stopConfirm.confirm'),
                danger: true,
              });
              if (ok) void stopTracking();
            }}
          >
            <Icon name="stop" size={15} /> {t('settings.tracking.stop')}
          </button>
          {tracker.lastError && <span className="error-text">{tracker.lastError}</span>}

          {/* The technical live-status bits are tucked behind an expander. */}
          <Collapsible summary={t('settings.tracking.details')} className="tracking-advanced">
            <div className="tracking-advanced-body">
              <span className="settings-ok">
                ● {t('settings.tracking.active', { title: activeTrip?.title ?? t('settings.tripFallback') })}
              </span>
              {tracker.lastFix ? (
                <LastFix
                  fix={tracker.lastFix}
                  ageSeconds={fixAge}
                  tripId={tracker.tripId}
                  onOpenMap={() => setEditDay(true)}
                />
              ) : (
                <div className="tracking-live">
                  <span className="muted">{t('settings.tracking.waitingFix')}</span>
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
                {t('settings.tracking.todayOnMap')}
              </button>
              {tracker.buffered > 0 && (
                <span className="muted">
                  {t('settings.tracking.buffered', { count: tracker.buffered })}
                </span>
              )}
              {tracker.lastStatus && (
                <span className="muted">{t('settings.tracking.service', { status: tracker.lastStatus })}</span>
              )}
              <TrackingLog now={now} />
            </div>
          </Collapsible>
        </div>
      ) : (
        <div className="settings-form tracking-swap">
          <div className="field">
            <label>{t('common.trip')}</label>
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
              <Icon name="play" size={15} /> {t('settings.tracking.start')}
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
        <span className={chosen ? '' : 'muted'}>{chosen?.title ?? t('settings.tracking.pickTrip')}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={`trip-picker-caret ${open && !closing ? 'open' : ''}`}
        />
      </button>
      {open && (
        <div className={`trip-picker-menu card ${closing ? 'closing' : ''}`}>
          {trips.map((trip, i) => (
            <button
              key={trip.id}
              type="button"
              className={trip.id === value ? 'active' : ''}
              style={{ animationDelay: `${Math.min(i, 6) * 28}ms` }}
              onClick={() => {
                onChange(trip.id);
                close();
              }}
            >
              <span className="trip-picker-name">
                {trip.title}
                <small>{formatDate(trip.startDate)}</small>
              </span>
              {trip.startDate.slice(0, 10) <= today && (
                <span className="trip-picker-now">{t('settings.tracking.underway')}</span>
              )}
              <span className={`person-check ${trip.id === value ? 'on' : ''}`}>
                <Icon name="check" size={15} />
              </span>
            </button>
          ))}
          {trips.length === 0 && (
            <span className="trip-picker-empty muted">
              {t('settings.tracking.noTrips')}
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
            {t('settings.tracking.log.summary', { count: log.length })}
            <button
              type="button"
              className="log-expand"
              aria-label={t('settings.tracking.log.fullscreen')}
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
        aria-label={t('settings.tracking.todayOnMap')}
        ref={mapRef}
        onClick={onOpenMap}
      />
      <div className="last-fix-body">
        <strong className="last-fix-place">
          <span className="tracking-live-dot" />
          <span>{place ?? t('settings.tracking.lastFix.place')}</span>
        </strong>
        <span className="muted">
          {t('settings.tracking.lastFix.label')}{' '}
          {ageSeconds === null
            ? ''
            : ageSeconds < 2
              ? t('settings.tracking.lastFix.justNow')
              : t('settings.tracking.lastFix.ago', { seconds: ageSeconds })}
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
        {new Date(entry.at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })}
        <small>{ago < 3600 ? `${Math.max(0, Math.round(ago / 60))} min` : ''}</small>
      </span>
      <span className="log-what">
        <span className="log-moved">
          {entry.movedM !== undefined ? `${entry.movedM} m` : t('settings.tracking.log.start')}
        </span>
        {entry.accuracyM !== undefined && (
          <span className="log-acc">±{entry.accuracyM} m</span>
        )}
        {stayed && (
          <span className="log-stay" title={t('settings.tracking.log.stay', { count: entry.stayCount ?? 0 })}>
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
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Back closes the sheet rather than leaving the settings page.
  useBackToClose('mmsLog', close);

  return createPortal(
    <div className={`log-layer ${closing ? 'closing' : ''}`}>
      <header className="log-head">
        <button type="button" className="te-icon-btn" aria-label={t('common.close')} onClick={close}>
          <Icon name="close" size={20} />
        </button>
        <div className="log-head-title">
          <strong>{t('settings.tracking.log.title')}</strong>
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
  const [showLog, setShowLog] = useState(false);

  if (showLog) return <ChangelogPanel key="log" onBack={() => setShowLog(false)} />;

  // Tap the version 7× to reveal the hidden Ontwikkelaar tab (Android-style).
  const tapVersion = () => {
    if (localStorage.getItem('mms.dev') === '1') return;
    tapsRef.current += 1;
    const left = 7 - tapsRef.current;
    if (left <= 0) {
      setHint(null);
      onUnlockDev();
    } else if (left <= 4) {
      setHint(t('settings.about.devHint', { count: left }));
    }
  };

  return (
    <section className="card settings-card settings-swap" key="about">
      {/* The brand row doubles as the seven-tap target for developer options —
          a second "MarkMySteps" underneath was just repeating itself. */}
      <button type="button" className="about-brand" onClick={tapVersion}>
        <LogoMark size={44} />
        <span className="about-brand-name">MarkMySteps</span>
      </button>
      <p className="muted">
        {t('settings.about.tagline')}
      </p>
      <ul className="about-list">
        <li>
          <a
            href="https://github.com/Marukiee/MarkMySteps"
            target="_blank"
            rel="noreferrer"
            className="ext-link"
          >
            {t('settings.about.source')} <Icon name="chevron-right" size={14} />
          </a>
        </li>
        <li>
          <a
            href="https://github.com/Marukiee/MarkMySteps/actions"
            target="_blank"
            rel="noreferrer"
            className="ext-link"
          >
            {t('settings.about.apk')} <Icon name="chevron-right" size={14} />
          </a>
        </li>
        <li>
          <button type="button" className="ext-link" onClick={() => setShowLog(true)}>
            {t('settings.about.whatsNew')} <Icon name="chevron-right" size={14} />
          </button>
        </li>
        <li>
          <Link to="/privacy" className="ext-link">
            {t('settings.about.privacy')} <Icon name="chevron-right" size={14} />
          </Link>
        </li>
      </ul>
      {/* Without a server, this is also the answer to "how do I get back?" —
          so it lives where you would go looking for it. */}
      {isLocalMode() && <ServerSteps />}
      {isAndroidApp() && <UpdateCheck />}
      {hint && <span className="muted">{hint}</span>}
    </section>
  );
}

/** The three questions a release note answers, in the order you ask them. */
const CHANGE_GROUPS: { key: 'new' | 'better' | 'fixed'; label: string; tone: string }[] = [
  { key: 'new', label: t('settings.changelog.new'), tone: 'is-new' },
  { key: 'better', label: t('settings.changelog.better'), tone: 'is-better' },
  { key: 'fixed', label: t('settings.changelog.fixed'), tone: 'is-fixed' },
];

/**
 * What changed, most recent first.
 *
 * A release note is a list of moments, so it is drawn as one: a line down the
 * side, a dot per entry, and the entries arriving one after another rather than
 * all at once.
 */
function ChangelogPanel({ onBack }: { onBack: () => void }) {
  // A back gesture belongs to the page you came from. This one is a panel
  // swapped in over the About tab rather than a route, so without an entry of
  // its own the gesture went straight past the settings page and out to the
  // home screen. It takes the entry, gives it back on the way out, and says so
  // first, or the layers underneath take our own pop for a gesture.
  useEffect(() => {
    window.history.pushState({ mmsChangelog: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      onBack();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) {
        skipNextPop();
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card settings-card changelog settings-swap">
      <button type="button" className="changelog-back" onClick={onBack}>
        <Icon name="chevron-left" size={16} />
        {t('settings.nav.about')}
      </button>
      <h2>{t('settings.about.whatsNew')}</h2>
      <ol className="changelog-list">
        {CHANGELOG.map((entry, i) => (
          <li key={entry.date + entry.title} style={{ animationDelay: `${i * 90}ms` }}>
            <span className="changelog-dot" aria-hidden="true" />
            <div className="changelog-head">
              <strong>{entry.title}</strong>
              {entry.highlight && <span className="changelog-new">{t('settings.changelog.badge')}</span>}
              <span className="muted changelog-date">
                {new Date(entry.date).toLocaleDateString(intlLocale(), {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>
            {CHANGE_GROUPS.map(({ key, label, tone }) => {
              const lines = entry[key];
              if (!lines?.length) return null;
              return (
                <div className="changelog-group" key={key}>
                  <span className={`changelog-group-label ${tone}`}>{label}</span>
                  <ul className="changelog-items">
                    {lines.map((item, j) => (
                      <li key={item} style={{ animationDelay: `${i * 90 + 120 + j * 45}ms` }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </li>
        ))}
      </ol>
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
  /** Download progress, once "installeren" has been pressed. */
  const [percent, setPercent] = useState<number | null>(null);
  const [shown, closing] = useExit(result !== null, 240);
  const lastRef = useRef<{ text: string; url?: string } | null>(null);
  if (result) lastRef.current = result;
  const last = lastRef.current;

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const { current, latest, newer } = await checkForUpdate(true, true);
      if (newer && latest?.url) {
        setResult({ text: t('settings.update.available', { version: latest.version ?? '' }), url: latest.url });
      } else {
        setResult({ text: t('settings.update.upToDate', { build: String(current) }) });
      }
    } catch {
      setResult({ text: t('settings.update.checkFailed') });
    } finally {
      setBusy(false);
    }
  }

  /**
   * The same one press the banner offers: fetch the APK and hand it to
   * Android's installer, rather than sending somebody to a browser and hoping
   * they find the file again afterwards.
   */
  async function install(url: string) {
    setPercent(0);
    const outcome = await downloadAndInstall(url, setPercent);
    setPercent(null);
    if (outcome === 'permission') {
      setResult({ text: t('settings.update.permission'), url });
    } else if (outcome === 'failed') {
      setResult({ text: t('settings.update.downloadFailed'), url });
    }
  }

  return (
    <div className="update-check">
      <button className="btn btn-ghost" disabled={busy} onClick={() => void run()}>
        <Icon name="download" size={15} /> {busy ? t('settings.update.checking') : t('settings.update.check')}
      </button>
      {shown && last && (
        <p className={`muted update-check-result ${closing ? 'leaving' : ''}`}>
          {last.text}
          {last.url &&
            (percent === null ? (
              <button className="ext-link" onClick={() => void install(last.url!)}>
                {t('settings.update.install')} <Icon name="chevron-right" size={13} />
              </button>
            ) : (
              <span className="update-check-progress">{percent}%</span>
            ))}
        </p>
      )}
    </div>
  );
}

/** Hidden tab (unlocked from About) for testing-only tools. */
function DeveloperSection({ onLock }: { onLock: () => void }) {
  const navigate = useNavigate();
  const [simulating, setSimulating] = useState(isUpdateBannerSimulated());
  const [invitePreview, setInvitePreview] = useState(false);
  return (
    <>
      <section className="card settings-card">
        <h2>
          {t('settings.dev.screens.title')}
          <HelpTip>
            {t('settings.dev.screens.help')}
          </HelpTip>
        </h2>
        <p className="muted">{t('settings.dev.screens.hint')}</p>
        <div className="dev-buttons">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/onboarding?preview=1')}
          >
            {t('settings.dev.screens.onboarding')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/onboarding?preview=1&local=1')}
          >
            {t('settings.dev.screens.onboardingLocal')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/login?preview=1')}
          >
            {t('settings.dev.screens.login')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/preview/pending')}
          >
            {t('settings.dev.screens.pending')}
          </button>
        </div>
      </section>

      <section className="card settings-card">
        <h2>{t('settings.dev.invite.title')}</h2>
        <p className="muted">
          {t('settings.dev.invite.hint')}
        </p>
        <button
          type="button"
          className="btn btn-ghost settings-reset-sizes"
          onClick={() => setInvitePreview(true)}
        >
          {t('settings.dev.invite.button')}
        </button>
        {invitePreview && <InvitePreviewSheet onClose={() => setInvitePreview(false)} />}
      </section>

      <section className="card settings-card">
        <h2>{t('settings.dev.covers.title')}</h2>
        <p className="muted">
          {t('settings.dev.covers.hint')}
        </p>
        <button
          type="button"
          className="btn btn-ghost settings-reset-sizes"
          onClick={() => navigate('/preview/covers')}
        >
          {t('settings.dev.covers.button')}
        </button>
      </section>

      <section className="card settings-card">
        <h2>{t('settings.dev.inbox.title')}</h2>
        <p className="muted">
          {t('settings.dev.inbox.hint')}
        </p>
        <button
          type="button"
          className="btn btn-ghost settings-reset-sizes"
          onClick={() => navigate('/friends?demo=meldingen')}
        >
          {t('settings.dev.inbox.button')}
        </button>
      </section>

      <section className="card settings-card">
        <h2>{t('settings.dev.updateBanner.title')}</h2>
        <p className="muted">
          {t('settings.dev.updateBanner.hint')}
        </p>
        <button
          type="button"
          className="btn btn-ghost settings-reset-sizes"
          onClick={() => {
            setUpdateBannerSimulated(!simulating);
            setSimulating(!simulating);
          }}
        >
          {simulating ? t('settings.dev.updateBanner.hide') : t('settings.dev.updateBanner.show')}
        </button>
      </section>

      <section className="card settings-card">
        <h2>{t('settings.dev.mode.title')}</h2>
        <p className="muted">
          {t('settings.dev.mode.hint')}
        </p>
        <button type="button" className="btn btn-ghost settings-reset-sizes" onClick={onLock}>
          {t('settings.dev.mode.hide')}
        </button>
      </section>
    </>
  );
}

/**
 * A short list of choices, in the app's own hand.
 *
 * A native <select> opens the system's list, which on Android is a grey slab
 * from a different decade with the app's dialog behind it. The trip chooser in
 * the tracking section already had to solve this; this is the same popover
 * without the trip-shaped contents.
 */
function OptionPicker<T extends string | number | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.value === value);

  const close = () => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 150);
  };

  useEffect(() => {
    if (!open || closing) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, closing]);

  return (
    <div className="trip-picker option-picker" ref={wrapRef}>
      <button
        type="button"
        className="trip-picker-btn"
        aria-expanded={open}
        onClick={() => (open && !closing ? close() : setOpen(true))}
      >
        <span>{chosen?.label ?? t('settings.picker.choose')}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={`trip-picker-caret ${open && !closing ? 'open' : ''}`}
        />
      </button>
      {open && (
        <div className={`trip-picker-menu card ${closing ? 'closing' : ''}`}>
          {options.map((o, i) => (
            <button
              key={String(o.value)}
              type="button"
              className={o.value === value ? 'active' : ''}
              style={{ animationDelay: `${Math.min(i, 6) * 28}ms` }}
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              <span className="trip-picker-name">{o.label}</span>
              <span className={`person-check ${o.value === value ? 'on' : ''}`}>
                <Icon name="check" size={15} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Developer options: set up the "you were added to a trip" dialog and show it.
 *
 * Its own sheet rather than two dropdowns in the settings list: a page of
 * settings is a page of things that stay set, and these two are the opposite —
 * they are the question being asked right before the answer is thrown away.
 */
function InvitePreviewSheet({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(1);
  const [photos, setPhotos] = useState(false);
  const [closing, setClosing] = useState(false);

  const close = (then?: () => void) => {
    setClosing(true);
    window.setTimeout(() => {
      then?.();
      onClose();
    }, 220);
  };

  return createPortal(
    <div
      className={`dev-sheet-backdrop ${closing ? 'closing' : ''}`}
      role="dialog"
      aria-modal="true"
      onClick={() => close()}
    >
      <div className="dev-sheet card" onClick={(e) => e.stopPropagation()}>
        <div className="dev-sheet-head">
          <h3>{t('settings.dev.invite.button')}</h3>
          <button className="dev-sheet-close" aria-label={t('common.close')} onClick={() => close()}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="muted">
          {t('settings.dev.invite.sheetHint')}
        </p>
        <div className="dev-pick">
          <span>{t('settings.dev.invite.count')}</span>
          <OptionPicker
            value={count}
            onChange={setCount}
            options={[
              { value: 1, label: t('settings.dev.invite.trips', { count: 1 }) },
              { value: 2, label: t('settings.dev.invite.trips', { count: 2 }) },
              { value: 3, label: t('settings.dev.invite.trips', { count: 3 }) },
              { value: 5, label: t('settings.dev.invite.trips', { count: 5 }) },
            ]}
          />
        </div>
        <div className="dev-pick">
          <span>{t('settings.dev.invite.images')}</span>
          <OptionPicker
            value={photos}
            onChange={setPhotos}
            options={[
              { value: false, label: t('settings.dev.invite.withoutPhotos') },
              { value: true, label: t('settings.dev.invite.withPhotos') },
            ]}
          />
        </div>
        <span className="muted dev-sheet-note">
          {t('settings.dev.invite.note')}
        </span>
        <button
          type="button"
          className="btn btn-primary dev-sheet-go"
          onClick={() => close(() => void previewInvitePopup(count, photos))}
        >
          {t('settings.dev.invite.show')}
        </button>
      </div>
    </div>,
    document.body,
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
      setMessage(t('settings.profile.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.saveFailed'));
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
      setMessage(t('settings.profile.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      window.setTimeout(logout, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.profile.changeFailed'));
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
      setMessage(t('settings.profile.photoSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.profile.uploadFailed'));
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
    setMessage(t('settings.profile.photoRemoved'));
  }

  return (
    <>
      <section className="card settings-card">
        <h2>{t('settings.profile.photo.title')}</h2>
        <p className="muted">{t('settings.profile.photo.hint')}</p>
        <div className="avatar-row">
          <button
            type="button"
            className="avatar-edit"
            title={t('settings.profile.photo.title')}
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
                    {t('settings.profile.photo.view')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    closePhotoMenu();
                    fileRef.current?.click();
                  }}
                >
                  {t('settings.profile.photo.choose')}
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
                    {t('settings.profile.photo.crop')}
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
                    {t('settings.profile.photo.remove')}
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
            <img src={viewSrc} alt={t('settings.profile.photo.title')} />
          </div>
        )}
      </section>

      <section className="card settings-card">
        <h2>{t('settings.profile.name.title')}</h2>
        <form onSubmit={saveName} className="settings-form">
          <div className="field">
            <label htmlFor="pr-name">{t('settings.profile.name.name')}</label>
            <input
              id="pr-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pr-user">{t('settings.profile.name.username')}</label>
            <input
              id="pr-user"
              required
              pattern="[a-zA-Z0-9._\-]{3,30}"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <span className="muted">{t('settings.profile.name.usernameHint')}</span>
          </div>
          <div className="settings-actions">
            <button className="btn btn-ghost">{t('settings.profile.name.save')}</button>
          </div>
        </form>
      </section>

      <section className="card settings-card">
        <h2>{t('settings.profile.password.title')}</h2>
        <p className="muted">{t('settings.profile.password.hint')}</p>
        <form onSubmit={savePassword} className="settings-form">
          <div className="field">
            <label htmlFor="pr-cur">{t('settings.profile.password.current')}</label>
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
            <label htmlFor="pr-new">{t('settings.profile.password.new')}</label>
            <input
              id="pr-new"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <PasswordStrength
              password={newPassword}
              personal={[user?.username ?? '', user?.displayName ?? '', user?.email.split('@')[0] ?? '']}
            />
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary">{t('settings.profile.password.submit')}</button>
          </div>
        </form>
      </section>

      <TwoFactorSection />

      {/* One feedback line for the three panels: whichever form you just
          submitted, its answer belongs at the end of the page rather than
          repeated under each. */}
      {message && <p className="settings-ok">{message}</p>}
      {error && <p className="error-text">{error}</p>}
    </>
  );
}

/**
 * Which server this app talks to.
 *
 * Only in the app: in the browser the API is whatever origin served the page,
 * so there is nothing to choose. The value is normally set once at login and
 * then never thought about again, which is exactly why it is worth being able
 * to see and correct without reinstalling.
 */
function ServerSection() {
  const { logout } = useAuth();
  const current = getServerBase() || DEFAULT_SERVER_URL;
  const [url, setUrl] = useState(current);
  const [error, setError] = useState<string | null>(null);

  if (!isNative()) return null;

  const trimmed = url.trim().replace(/\/+$/, '');
  const changed = trimmed !== current.replace(/\/+$/, '');

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError(t('settings.server.invalid'));
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      setError(t('settings.server.https'));
      return;
    }
    // Tokens belong to the server that issued them, so pointing the app
    // somewhere else always ends the session. Better to say so than to have
    // every request quietly start failing.
    const ok = await confirmModal({
      title: t('settings.server.confirm.title'),
      body: t('settings.server.confirm.body', { origin: parsed.origin }),
      confirmLabel: t('settings.server.confirm.confirm'),
      danger: true,
    });
    if (!ok) return;
    setServerBase(trimmed);
    logout();
  }

  return (
    <section className="card settings-card">
      <h2>
        {t('settings.server.title')}
        <HelpTip>
          {t('settings.server.help')}
        </HelpTip>
      </h2>
      <p className="muted">{t('settings.server.hint')}</p>
      <form onSubmit={save} className="settings-form">
        <div className="field">
          <label htmlFor="sv-url">{t('settings.server.address')}</label>
          <input
            id="sv-url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="settings-actions">
          <button className="btn btn-ghost" disabled={!changed || !trimmed}>
            {t('settings.server.change')}
          </button>
          {changed && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setUrl(current);
                setError(null);
              }}
            >
              {t('settings.server.reset')}
            </button>
          )}
        </div>
      </form>
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
  // The placeholder fades out over the answer instead of being cut away.
  const [skeletonShown, skeletonClosing] = useExit(!loaded, 280);

  useEffect(() => {
    api<ConnectionStatus>('/immich/connection')
      .then((s) => {
        // `loaded` is set here rather than in a `.finally`, which is a callback
        // of its own and so a render of its own: for one frame the answer had
        // arrived while the placeholder was still being told to hold its space,
        // and the panel and the grey block were both on screen at once.
        setStatus(s);
        setServerUrl(s.serverUrl);
        setPublicUrl(s.publicUrl ?? '');
        setLoaded(true);
      })
      .catch((err: unknown) => {
        // 404 simply means: not configured yet.
        if (!(err instanceof ApiError && err.status === 404)) {
          setError(t('settings.immich.loadFailed'));
        }
        setLoaded(true);
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
      setMessage(t('settings.immich.connected'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await api('/immich/connection', { method: 'DELETE' });
    setStatus(null);
    setServerUrl('');
    setMessage(t('settings.immich.disconnected'));
  }

  return (
    <section className="card settings-card">
      <h2>
        {t('settings.immich.title')}
        <HelpTip>
          {t('settings.immich.help.what')}
          <br />
          <br />
          {t('settings.immich.help.stored')}
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

      {/* Placeholder and answer share one cell, so the swap is a cross-fade in
          place rather than one box being taken away and another put down. */}
      {(skeletonShown || status) && (
        <div className="immich-status-slot">
          {status && (
            <div className="immich-status">
              <span className="immich-status-ok">● {t('settings.immich.status.connected')}</span>
              <span className="muted">
                {status.serverUrl} · {t('settings.immich.status.key', { preview: status.apiKeyPreview })}
                {status.lastSyncAt &&
                  ` · ${t('settings.immich.status.lastSync', { date: formatDate(status.lastSyncAt) })}`}
              </span>
              {status.lastSyncError && <span className="error-text">{status.lastSyncError}</span>}
            </div>
          )}
          {skeletonShown && (
            <div
              className={`immich-status-skeleton ${skeletonClosing ? 'leaving' : ''}`}
              aria-hidden="true"
            />
          )}
        </div>
      )}

      <form onSubmit={save} className="settings-form">
        <div className="field">
          <label htmlFor="im-url">{t('settings.immich.url')}</label>
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
          <label htmlFor="im-key">
            {t('settings.immich.key.label')}
            <HelpTip>
              {t('settings.immich.key.help')}
            </HelpTip>
          </label>
          <input
            id="im-key"
            type="password"
            required
            placeholder={status ? t('settings.immich.key.replace') : t('settings.immich.key.placeholder')}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span className="muted">
            <span className="inline-path">
              Immich <Icon name="chevron-right" size={12} /> {t('settings.immich.key.pathAccount')}{' '}
              <Icon name="chevron-right" size={12} /> {t('settings.immich.key.pathKeys')}
            </span>
            . {t('settings.immich.key.encrypted')}
          </span>
        </div>
        <div className="field">
          <label htmlFor="im-public">
            {t('settings.immich.public.label')}
            <HelpTip>
              {t('settings.immich.public.help')}
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
            {busy ? t('settings.immich.validating') : status ? t('settings.immich.update') : t('settings.immich.connect')}
          </button>
          {status && (
            <button type="button" className="btn btn-danger" onClick={disconnect}>
              {t('settings.immich.disconnect')}
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
  /** Signs in with an authenticator app as well as a password. */
  twoFactor: boolean;
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
        {t('settings.accounts.requests', { count: lastRows.current.length })}
      </h2>
      <p className="muted">
        {t('settings.accounts.pending.hint')}
      </p>
      <ul className="admin-users">
        {lastRows.current.map((row) => (
          <li key={row.id} className="admin-request">
            <div className="admin-user-info">
              <strong>
                {row.displayName} <small className="muted">@{row.username}</small>
              </strong>
              <span className="muted">
                {row.email} · {t('settings.accounts.pending.signedUp', { date: formatDate(row.createdAt) })}
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
                {t('settings.accounts.pending.reject')}
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
                <Icon name="check" size={15} /> {t('settings.accounts.pending.approve')}
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
  const [query, setQuery] = useState('');

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
        t('settings.accounts.created', { username, password: tempPassword }),
      );
      setEmail('');
      setUsername('');
      setDisplayName('');
      setTempPassword('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.accounts.createFailed'));
    }
  }

  async function decideRequest(row: AdminUserRow, approve: boolean) {
    setError(null);
    setMessage(null);
    if (!approve) {
      const ok = await confirmModal({
        title: t('settings.accounts.rejectConfirm.title', { name: row.displayName }),
        body: t('settings.accounts.rejectConfirm.body'),
        confirmLabel: t('settings.accounts.pending.reject'),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await api(`/admin/users/${row.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' });
      setMessage(
        approve
          ? t('settings.accounts.approved', { name: row.displayName })
          : t('settings.accounts.rejected', { name: row.displayName }),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.accounts.failed'));
    }
  }

  async function resetPassword(row: AdminUserRow) {
    const temp = window.prompt(t('settings.accounts.resetPrompt', { username: row.username }));
    if (!temp) return;
    try {
      await api(`/admin/users/${row.id}/reset-password`, {
        method: 'POST',
        body: { tempPassword: temp },
      });
      setMessage(t('settings.accounts.resetDone', { username: row.username }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.accounts.resetFailed'));
    }
  }

  async function resetTwoFactor(row: AdminUserRow) {
    const ok = await confirmModal({
      title: t('settings.accounts.twoFactorConfirm.title'),
      body: t('settings.accounts.twoFactorConfirm.body', { username: row.username }),
      confirmLabel: t('settings.accounts.twoFactorConfirm.confirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/admin/users/${row.id}/reset-2fa`, { method: 'POST' });
      setMessage(t('settings.accounts.twoFactorDone', { username: row.username }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.accounts.resetFailed'));
    }
  }

  async function removeAccount(row: AdminUserRow) {
    const ok = await confirmModal({
      title: t('settings.accounts.removeConfirm.title'),
      body: t('settings.accounts.removeConfirm.body', { username: row.username }),
      confirmLabel: t('common.delete'),
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
  // Filtered here rather than on the server: an instance has tens of accounts,
  // not thousands, and they are all already loaded.
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? settled.filter((u) =>
        [u.displayName, u.username, u.email].some((field) => field.toLowerCase().includes(needle)),
      )
    : settled;

  return (
    <>
      <PendingRequests rows={requests} onDecide={decideRequest} />

      <section className="card settings-card">
        <h2>{t('settings.accounts.create.title')}</h2>
        <p className="muted">
          {t('settings.accounts.create.hint')}
        </p>
        <form onSubmit={createAccount} className="settings-form">
          <div className="admin-create-grid">
            <div className="field">
              <label htmlFor="ac-name">{t('settings.profile.name.name')}</label>
              <input id="ac-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ac-user">{t('settings.profile.name.username')}</label>
              <input
                id="ac-user"
                required
                pattern="[a-zA-Z0-9._\-]{3,30}"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ac-mail">{t('settings.accounts.create.email')}</label>
              <input id="ac-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ac-pass">{t('settings.accounts.create.tempPassword')}</label>
              <div className="admin-pass-row">
                <input
                  id="ac-pass"
                  required
                  minLength={10}
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                />
                <button type="button" className="btn btn-ghost" onClick={generatePassword}>
                  {t('settings.accounts.create.generate')}
                </button>
              </div>
            </div>
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary">{t('settings.accounts.create.title')}</button>
          </div>
        </form>

        {message && <p className="settings-ok">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </section>

      <section className="card settings-card">
        <h2>
          {t('settings.nav.accounts')}
          <HelpTip>
            {t('settings.accounts.list.help')}
          </HelpTip>
        </h2>
        <p className="muted">{t('settings.accounts.list.hint')}</p>
        <div className="admin-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.accounts.list.search')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="admin-search-clear"
              onClick={() => setQuery('')}
              aria-label={t('settings.clear')}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        {/* Hold the list's space while it loads, so the card doesn't jump. */}
        {!loaded && (
          <ul className="admin-users" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="admin-user-skeleton" />
            ))}
          </ul>
        )}
        <ul className="admin-users">
          {shown.map((row) => (
            <li key={row.id}>
              <div className="admin-user-info">
                <strong>
                  {row.displayName} <small className="muted">@{row.username}</small>
                </strong>
                <span className="muted">
                  {row.email} · {t('common.trips', { count: row.tripCount })}
                  {row.role === 'ADMIN' && ` · ${t('settings.accounts.row.admin')}`}
                  {row.status === 'REJECTED' && ` · ${t('settings.accounts.row.rejected')}`}
                  {row.mustChangePassword && ` · ${t('settings.accounts.row.tempPassword')}`}
                  {row.twoFactor && ` · ${t('settings.accounts.row.twoFactor')}`}
                </span>
              </div>
              {row.id !== me?.id && (
                <div className="admin-user-actions">
                  <button className="btn btn-ghost" onClick={() => void resetPassword(row)}>
                    {t('settings.accounts.row.reset')}
                  </button>
                  {row.twoFactor && (
                    <button className="btn btn-ghost" onClick={() => void resetTwoFactor(row)}>
                      {t('settings.accounts.row.resetTwoFactor')}
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={() => void toggleRole(row)}>
                    {row.role === 'ADMIN' ? t('settings.accounts.row.demote') : t('settings.accounts.row.makeAdmin')}
                  </button>
                  <button
                    className="btn btn-danger btn-icon-sm"
                    aria-label={t('settings.accounts.row.delete')}
                    onClick={() => void removeAccount(row)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {loaded && shown.length === 0 && (
          <p className="muted">{t('settings.accounts.list.empty')}</p>
        )}
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
      setError(err instanceof Error ? err.message : t('settings.polarsteps.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-card">
      <h2>{t('settings.polarsteps.title')}</h2>
      <p className="muted">
        {tr('settings.polarsteps.hint', {
          // Polarsteps itself is in English, so its menu path is the same in every language.
          path: (site) => (
            <span className="inline-path">
              {site} <Icon name="chevron-right" size={12} /> Settings{' '}
              <Icon name="chevron-right" size={12} /> Privacy <Icon name="chevron-right" size={12} />
              “Download my data”
            </span>
          ),
        })}
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
          <span>{file ? file.name : t('settings.polarsteps.pick')}</span>
        </label>
        <div className="settings-actions">
          <button className="btn btn-primary" disabled={!file || busy}>
            {busy ? t('settings.polarsteps.importing') : t('settings.polarsteps.import')}
          </button>
        </div>
      </form>

      {result && (
        <ul className="import-result">
          {result.map((trip) => (
            <li key={trip.tripId}>
              {tr(
                'settings.polarsteps.result',
                { b: (s) => <strong>{s}</strong> },
                {
                  count: trip.pointsImported,
                  title: trip.title,
                  start: formatDate(trip.startDate),
                  end: formatDate(trip.endDate),
                  points: trip.pointsImported.toLocaleString(intlLocale()),
                },
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
