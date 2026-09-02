import { App } from '@capacitor/app';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { downloadAndInstall } from '../lib/appUpdate';
import { isNativeApp, setStatusBarTint } from '../lib/native';
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
 * Asks the server what the latest APK is and compares it with this install.
 *
 * Shared with the manual check in Settings, so both answer the same question
 * the same way — including "you already dismissed this one", which a manual
 * check must ignore. That check also passes `fresh`, which makes the server
 * ask GitHub now instead of repeating what it heard a couple of minutes ago;
 * the automatic check on launch does not, because it happens on every launch.
 */
export async function checkForUpdate(
  ignoreDismissed = false,
  fresh = false,
): Promise<{ current: number; latest: LatestApp | null; newer: boolean }> {
  const [{ build }, latest] = await Promise.all([
    App.getInfo(),
    api<LatestApp>(`/app/latest${fresh ? '?fresh=1' : ''}`),
  ]);
  const current = Number(build);
  const usable =
    latest && typeof latest.version === 'number' && latest.url ? latest : null;
  const newer =
    usable !== null &&
    Number.isFinite(current) &&
    usable.version! > current &&
    (ignoreDismissed || localStorage.getItem(DISMISS_KEY) !== String(usable.version));
  return { current, latest: usable, newer };
}

/**
 * Native-only "new version available" banner. The server advertises the latest
 * APK (build number + download URL) via GET /app/latest; if it's newer than this
 * install, we show a download button (there's no Play Store on the target
 * phones). Dismiss is remembered per version so it won't nag for the same build.
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<LatestApp | null>(null);
  const [simulated, setSimulated] = useState(isUpdateBannerSimulated());
  const [closing, setClosing] = useState(false);
  /*
   * How far the download has got, or what went wrong.
   *
   * The banner keeps hold of this itself rather than routing it through a
   * page: the whole point is that pressing the button once is the entire
   * update, so the button is also where the progress belongs.
   */
  const [percent, setPercent] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

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
        const { latest, newer } = await checkForUpdate();
        if (!cancelled && newer && latest) setInfo(latest);
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

  // The banner floats over the page, so nothing below it knows it is there.
  // Only the offline banner needs to: it is the one thing that would end up
  // underneath. Its height is published, and that banner keeps clear of it.
  useEffect(() => {
    const root = document.documentElement;
    if (!shown || closing) {
      root.style.removeProperty('--update-banner-h');
      return;
    }
    const bar = barRef.current;
    if (!bar) return;
    const publish = () => root.style.setProperty('--update-banner-h', `${bar.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--update-banner-h');
    };
  }, [shown, closing]);

  if (!shown) return null;

  // Roll the banner away first, then drop it — vanishing mid-scroll is jarring.
  const dismiss = () => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      if (simulated) {
        setUpdateBannerSimulated(false);
        return;
      }
      localStorage.setItem(DISMISS_KEY, String(shown.version));
      setInfo(null);
    }, 280);
  };

  const busy = percent !== null;

  // Captured past the `if (!shown)` guard above: the closure below cannot see
  // that narrowing on its own.
  const release = shown;

  async function install() {
    if (busy) return;
    if (simulated || !release.url) {
      setProblem('Testmelding, er valt niets te installeren.');
      return;
    }
    setProblem(null);
    setPercent(0);
    const outcome = await downloadAndInstall(release.url, setPercent);
    setPercent(null);
    if (outcome === 'permission') {
      setProblem('Zet "installeren van onbekende apps" aan en druk opnieuw.');
    } else if (outcome === 'failed') {
      setProblem('Downloaden mislukt. Ben je online?');
    }
  }

  return (
    <div className={`update-banner-wrap ${closing ? 'closing' : ''}`}>
      <div className="update-banner" ref={barRef}>
        {/* Two lines, not one with a dot between: the build number wraps on a
            phone either way, and the separator was then left stranded at the
            end of the first line with nothing after it. */}
        <span className="update-banner-text">
          <strong>Nieuwe versie beschikbaar</strong>
          {problem ? (
            <span className="update-banner-notes">{problem}</span>
          ) : (
            shown.notes && <span className="update-banner-notes">{shown.notes}</span>
          )}
        </span>
        <div className="update-banner-actions">
          {/* One press is the whole update: the APK is fetched here and handed
              to Android's own installer. The button becomes the progress bar
              rather than being replaced by one, so nothing moves. */}
          <button className="update-banner-dl" disabled={busy} onClick={() => void install()}>
            {busy ? (
              <>
                <span className="update-banner-bar" style={{ width: `${percent}%` }} />
                <span className="update-banner-dl-text">{percent}%</span>
              </>
            ) : (
              <>
                <Icon name="download" size={15} /> Installeren
              </>
            )}
          </button>
          <button className="update-banner-close" aria-label="Verbergen" onClick={dismiss}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
