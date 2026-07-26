import { App } from '@capacitor/app';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { isNativeApp, openExternal, setStatusBarTint } from '../lib/native';
import { Icon } from './Icon';
import './updatebanner.css';

interface LatestApp {
  version: number | null;
  url: string | null;
  notes: string | null;
}

const DISMISS_KEY = 'mms.update.dismissed';
const SIMULATE_KEY = 'mms.update.simulate';
const SIMULATE_EVENT = 'mms:update-simulate';

/** Developer options: pretend a release is waiting so the banner can be checked. */
export function isUpdateBannerSimulated(): boolean {
  return localStorage.getItem(SIMULATE_KEY) === '1';
}

export function setUpdateBannerSimulated(on: boolean): void {
  if (on) localStorage.setItem(SIMULATE_KEY, '1');
  else localStorage.removeItem(SIMULATE_KEY);
  window.dispatchEvent(new Event(SIMULATE_EVENT));
}

const FAKE: LatestApp = {
  version: 9999,
  url: null,
  notes: 'Testmelding uit ontwikkelaarsopties',
};

/**
 * Native-only "new version available" banner. The server advertises the latest
 * APK (build number + download URL) via GET /app/latest; if it's newer than this
 * install, we show a download button (there's no Play Store on the target
 * phones). Dismiss is remembered per version so it won't nag for the same build.
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<LatestApp | null>(null);
  const [simulated, setSimulated] = useState(isUpdateBannerSimulated());

  // The simulator works on the web build too, so the banner can be checked
  // without an install — hence it's read outside the native-only check below.
  useEffect(() => {
    const sync = () => setSimulated(isUpdateBannerSimulated());
    window.addEventListener(SIMULATE_EVENT, sync);
    return () => window.removeEventListener(SIMULATE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    const check = async () => {
      try {
        const [{ build }, latest] = await Promise.all([
          App.getInfo(),
          api<LatestApp>('/app/latest'),
        ]);
        const current = Number(build);
        if (
          cancelled ||
          !latest.version ||
          !latest.url ||
          !Number.isFinite(current) ||
          latest.version <= current ||
          localStorage.getItem(DISMISS_KEY) === String(latest.version)
        ) {
          return;
        }
        setInfo(latest);
      } catch {
        /* offline / not configured — no banner */
      }
    };

    void check();
    // A release published while the app was open (or in the background) should
    // still surface — re-check whenever the app comes back to the foreground.
    const handle = App.addListener('resume', () => void check());
    return () => {
      cancelled = true;
      void handle.then((h) => h.remove());
    };
  }, []);

  const shown = simulated ? FAKE : info;

  // Match the status bar to the banner while it's up, then hand it back.
  useEffect(() => {
    if (!shown) return;
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim();
    setStatusBarTint(accent || '#e8613c');
    return () => setStatusBarTint(null);
  }, [shown]);

  if (!shown) return null;

  return (
    <div className="update-banner">
      <span className="update-banner-text">
        <strong>Nieuwe versie beschikbaar</strong>
        {shown.notes && <span className="muted"> · {shown.notes}</span>}
      </span>
      <div className="update-banner-actions">
        <button className="update-banner-dl" onClick={() => shown.url && openExternal(shown.url)}>
          <Icon name="download" size={15} /> Downloaden
        </button>
        <button
          className="update-banner-close"
          aria-label="Verbergen"
          onClick={() => {
            if (simulated) {
              setUpdateBannerSimulated(false);
              return;
            }
            localStorage.setItem(DISMISS_KEY, String(shown.version));
            setInfo(null);
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
