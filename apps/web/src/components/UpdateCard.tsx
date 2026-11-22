import { App } from '@capacitor/app';
import { CSSProperties, useEffect, useRef, useState } from 'react';
import {
  canUpdateInApp,
  checkForUpdates,
  getUpdateState,
  onUpdateState,
  previewUpdate,
  startUpdate,
  updateLater,
  type UpdateInfo,
} from '../lib/appUpdate';
import { Icon } from './Icon';
import { intlLocale, t } from '../i18n';
import './updatecard.css';

const SIMULATE_KEY = 'mms.update.simulate';
const SIMULATE_EVENT = 'mms:update-simulate';

/** Developer options: pretend a release is waiting so the card can be checked. */
export function isUpdateBannerSimulated(): boolean {
  return localStorage.getItem(SIMULATE_KEY) === '1';
}

/**
 * On the APK this asks the shared updater for its pretend release (version
 * 9.9.9), which walks through the real card and download. In a browser there
 * is no updater, so the card plays it out on its own.
 */
export function setUpdateBannerSimulated(on: boolean): void {
  if (on) localStorage.setItem(SIMULATE_KEY, '1');
  else localStorage.removeItem(SIMULATE_KEY);
  window.dispatchEvent(new Event(SIMULATE_EVENT));
  if (on) void previewUpdate();
}

type Phase = 'idle' | 'fetching' | 'installing' | 'failed';
const ORDER: Phase[] = ['idle', 'fetching', 'installing', 'failed'];

const MB = 1024 * 1024;
const mb = (bytes: number) =>
  (bytes / MB).toLocaleString(intlLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Which of the card's four looks a state of the updater gets, if any. */
function phaseOf(info: UpdateInfo): Phase | null {
  switch (info.kind) {
    case 'available':
      return 'idle';
    case 'downloading':
      return 'fetching';
    case 'installing':
    case 'awaitingConfirmation':
      return 'installing';
    case 'needsPermission':
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

/**
 * "There is a new version", as a card at the top of the home screen.
 *
 * Android only, and all of the updating is the shared updater's: this card
 * shows its state in the shape every one of Marks apps uses (the version, two
 * lines from the release, Later and Update sharing the width, the button
 * growing into the progress bar, then installing on its own). The iPhone
 * updates through TestFlight, which tells about new builds itself.
 */
export function UpdateCard() {
  const [info, setInfo] = useState<UpdateInfo>({ kind: 'idle' });
  const [simulated, setSimulated] = useState(isUpdateBannerSimulated());
  const [fake, setFake] = useState<UpdateInfo | null>(null);
  const [closing, setClosing] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const sync = () => setSimulated(isUpdateBannerSimulated());
    window.addEventListener(SIMULATE_EVENT, sync);
    return () => window.removeEventListener(SIMULATE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!canUpdateInApp()) return;
    void getUpdateState().then(setInfo).catch(() => undefined);
    const stop = onUpdateState(setInfo);
    void checkForUpdates(false).catch(() => undefined);
    // A release published while the app was away still shows up when it comes back.
    const handle = App.addListener('resume', () => void checkForUpdates(false).catch(() => undefined));
    return () => {
      stop();
      void handle.then((h) => h.remove());
    };
  }, []);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  // In a browser the simulation is played here, as the updater would.
  const webSimulation = simulated && !canUpdateInApp();
  const shown: UpdateInfo = webSimulation
    ? (fake ?? { kind: 'available', version: '9.9.9', current: '266', sizeBytes: 31.4 * MB, notes: t('settings.update.banner.fakeNotes').split('\n') })
    : info;
  const phase = phaseOf(shown);
  if (!phase && !closing) return null;
  const current: Phase = phase ?? 'installing';

  const later = () => {
    setClosing(true);
    timers.current.push(
      window.setTimeout(() => {
        setClosing(false);
        setFake(null);
        if (webSimulation) setUpdateBannerSimulated(false);
        else void updateLater();
      }, 240),
    );
  };

  /** The browser's stand-in for a real download. */
  const pretend = () => {
    const total = shown.sizeBytes ?? 31.4 * MB;
    const started = performance.now();
    const step = (now: number) => {
      const x = Math.min(1, (now - started) / 3600);
      const eased = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
      setFake({ ...shown, kind: 'downloading', progress: eased, sizeBytes: total });
      if (x < 1) {
        requestAnimationFrame(step);
        return;
      }
      timers.current.push(
        window.setTimeout(() => {
          setFake({ ...shown, kind: 'installing', sizeBytes: total });
          timers.current.push(window.setTimeout(later, 2600));
        }, 250),
      );
    };
    requestAnimationFrame(step);
  };

  const update = () => {
    if (current === 'fetching' || current === 'installing') return;
    if (webSimulation) pretend();
    else void startUpdate();
  };

  const busy = current === 'fetching' || current === 'installing';
  const fraction = shown.progress ?? 0;
  const percent = Math.round(fraction * 100);
  const fill = current === 'installing' ? 1 : current === 'fetching' ? fraction : 0;
  const where = (slot: Phase) => {
    const at = ORDER.indexOf(current);
    const own = ORDER.indexOf(slot);
    return own === at ? 'shown' : own < at ? 'above' : 'below';
  };
  const version = shown.version ?? '';
  const have = shown.current ?? null;
  const news = shown.notes ?? [];
  const size =
    shown.sizeBytes && shown.sizeBytes > 0
      ? t('settings.update.card.size', { loaded: mb(fraction * shown.sizeBytes), total: mb(shown.sizeBytes) })
      : t('settings.update.card.fetching');
  const problem =
    shown.kind === 'needsPermission' ? t('settings.update.permission') : shown.reason ?? t('settings.update.downloadFailed');

  return (
    <div className={`update-card-wrap ${closing ? 'closing' : ''}`}>
      <section
        className={`update-card card is-${phase}`}
        aria-label={t('settings.update.banner.title')}
        aria-live="polite"
      >
        <div className="uc-head">
          <span className="uc-icon" aria-hidden="true">
            <span className="uc-glyph uc-spark">
              <Icon name="sparkle" size={22} />
            </span>
            <span className="uc-glyph uc-done">
              <Icon name="check" size={22} />
            </span>
          </span>
          <div className="uc-lines">
            <div className={`uc-line ${where('idle')}`}>
              <strong>{t('settings.update.card.title', { version })}</strong>
              {have !== null && <small>{t('settings.update.card.current', { build: have })}</small>}
            </div>
            <div className={`uc-line ${where('fetching')}`}>
              <strong>{t('settings.update.card.title', { version })}</strong>
              <small>{size}</small>
            </div>
            <div className={`uc-line ${where('installing')}`}>
              <strong>{t('settings.update.card.installingTitle', { version })}</strong>
              <small>{t('settings.update.card.restart')}</small>
            </div>
            <div className={`uc-line ${where('failed')}`}>
              <strong>{t('settings.update.card.failedTitle')}</strong>
              <small>{problem}</small>
            </div>
          </div>
        </div>

        {news.length > 0 && (
          <div className="uc-news-wrap">
            <ul className="uc-news">
              {news.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="uc-actions">
          <button
            type="button"
            className="btn btn-ghost uc-later"
            tabIndex={busy || phase === 'failed' ? -1 : 0}
            aria-hidden={busy || phase === 'failed'}
            onClick={later}
          >
            {t('settings.update.card.later')}
          </button>
          {/* One press is the whole update: the button grows into the
              progress bar instead of being swapped for one. */}
          <button
            type="button"
            className="btn btn-primary uc-go"
            style={{ '--fill': fill } as CSSProperties}
            aria-disabled={busy}
            onClick={update}
          >
            <span className="uc-fill" aria-hidden="true" />
            <span className={`uc-label ${where('idle')}`}>{t('settings.update.card.update')}</span>
            <span className={`uc-label ${where('fetching')}`}>{percent}%</span>
            <span className={`uc-label ${where('installing')}`}>{t('settings.update.card.installing')}</span>
            <span className={`uc-label ${where('failed')}`}>{t('settings.update.card.retry')}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
