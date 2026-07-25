import { App } from '@capacitor/app';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { isNativeApp, openExternal } from '../lib/native';
import { Icon } from './Icon';
import './updatebanner.css';

interface LatestApp {
  version: number | null;
  url: string | null;
  notes: string | null;
}

const DISMISS_KEY = 'mms.update.dismissed';

/**
 * Native-only "new version available" banner. The server advertises the latest
 * APK (build number + download URL) via GET /app/latest; if it's newer than this
 * install, we show a download button (there's no Play Store on the target
 * phones). Dismiss is remembered per version so it won't nag for the same build.
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<LatestApp | null>(null);

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
    // Re-check whenever the app comes back to the foreground, so a release that
    // lands while the app is open still surfaces without a full restart.
    const sub = App.addListener('resume', () => void check());
    return () => {
      cancelled = true;
      void sub.then((h) => h.remove());
    };
  }, []);

  if (!info) return null;

  return (
    <div className="update-banner">
      <span className="update-banner-text">
        <strong>Nieuwe versie beschikbaar</strong>
        {info.notes && <span className="muted"> · {info.notes}</span>}
      </span>
      <div className="update-banner-actions">
        <button className="update-banner-dl" onClick={() => info.url && openExternal(info.url)}>
          <Icon name="download" size={15} /> Downloaden
        </button>
        <button
          className="update-banner-close"
          aria-label="Verbergen"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, String(info.version));
            setInfo(null);
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
