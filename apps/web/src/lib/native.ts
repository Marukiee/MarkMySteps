import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Style, StatusBar } from '@capacitor/status-bar';
import { DEFAULT_SERVER_URL } from '../config';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Public web origin for building shareable links. In the APK
 * `window.location.origin` is the WebView's internal scheme (localhost), so
 * fall back to the configured public site URL.
 */
export function webBase(): string {
  return isNativeApp() ? DEFAULT_SERVER_URL : window.location.origin;
}

/** Native status bar: overlay the web content, icon colour follows the theme. */
export function initStatusBar(): void {
  if (!isNativeApp()) return;
  void StatusBar.setOverlaysWebView({ overlay: true });
  // Fully transparent bar so the page/globe shows through instead of a solid
  // white strip. (Some Android builds keep a background even when overlaying.)
  void StatusBar.setBackgroundColor({ color: '#00000000' }).catch(() => undefined);
  syncStatusBarTheme();
  // Re-sync whenever the app theme changes.
  window.addEventListener('mms-theme', syncStatusBarTheme);
}

function syncStatusBarTheme(): void {
  if (!isNativeApp()) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  // Style.Dark = light icons (for a dark UI); Style.Light = dark icons.
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
}

interface PredictiveBackPlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
  addListener(
    event: 'backStarted' | 'backProgressed',
    cb: (data: { progress: number; edge: 'left' | 'right' }) => void,
  ): Promise<{ remove: () => void }>;
  addListener(event: 'backCancelled' | 'backInvoked', cb: () => void): Promise<{ remove: () => void }>;
}

const PredictiveBack = registerPlugin<PredictiveBackPlugin>('PredictiveBack');

/** True once the native predictive-back plugin has taken over the back gesture. */
let predictiveReady = false;

/**
 * Android Predictive Back Gesture.
 *
 * While you drag from the edge the whole app shrinks and slides toward that
 * edge, revealing the page background behind it — so you see where you're going
 * before you commit. Letting go snaps back (cancel) or navigates (commit, where
 * the destination grows into place).
 *
 * On API < 34 the system only reports the commit, which still navigates — just
 * without the live preview.
 */
export function initBackButton(): void {
  if (!isNativeApp()) return;

  const root = document.getElementById('root');

  const goBack = () => {
    if (window.location.pathname !== '/') window.history.back();
    else void App.exitApp();
  };

  const setProgress = (p: number) => root?.style.setProperty('--back-progress', String(p));
  const settle = (done?: () => void) => {
    root?.classList.add('back-swipe-settling');
    setProgress(0);
    window.setTimeout(() => {
      root?.classList.remove('back-swipe', 'back-swipe-settling');
      root?.style.removeProperty('--back-progress');
      document.documentElement.classList.remove('back-swipe-bg');
      done?.();
    }, 260);
  };

  void PredictiveBack.addListener('backStarted', ({ progress, edge }) => {
    predictiveReady = true;
    if (!root) return;
    root.classList.remove('back-swipe-settling');
    root.classList.add('back-swipe');
    document.documentElement.classList.add('back-swipe-bg');
    root.dataset.backEdge = edge;
    setProgress(progress);
  }).catch(() => undefined);

  void PredictiveBack.addListener('backProgressed', ({ progress }) =>
    setProgress(progress),
  ).catch(() => undefined);
  void PredictiveBack.addListener('backCancelled', () => settle()).catch(() => undefined);
  void PredictiveBack.addListener('backInvoked', () => {
    predictiveReady = true;
    // Navigate FIRST, then ease back to full size: the destination grows into
    // place instead of the old page popping out.
    goBack();
    settle();
  }).catch(() => undefined);

  // Fallback via Capacitor's own back event. `predictiveReady` only flips once
  // a REAL event from our callback has arrived — registering a listener isn't
  // proof that the native callback ended up on top of the dispatcher, and
  // trusting that once left back doing nothing at all. Exactly one of the two
  // paths ever fires, so this cannot double-navigate.
  void App.addListener('backButton', () => {
    if (predictiveReady) return;
    goBack();
  });
}

/**
 * At the root there is nothing to go back to — hand the gesture to the system so
 * it plays its own "close the app" animation instead of ours.
 */
export function setBackGestureEnabled(enabled: boolean): void {
  if (!isNativeApp()) return;
  void PredictiveBack.setEnabled({ enabled }).catch(() => undefined);
}

/**
 * Publishes `--vh-stable`: the viewport height WITHOUT the on-screen keyboard.
 *
 * Android resizes the WebView when the keyboard opens, so plain `vh` units
 * shrink mid-interaction — the fixed map panel and the sheet under it jumped and
 * left a bar along the map's edge. We therefore only adopt a *larger* height (or
 * a rotation), never the keyboard's shrink.
 */
export function initStableViewport(): void {
  let stable = 0;
  const apply = (px: number) => {
    stable = px;
    document.documentElement.style.setProperty('--vh-stable', `${px}px`);
  };
  apply(window.innerHeight);

  window.addEventListener('resize', () => {
    if (window.innerHeight > stable) apply(window.innerHeight);
  });
  // A rotation legitimately makes the viewport shorter — re-measure from scratch
  // once the new size has settled.
  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => apply(window.innerHeight), 250);
  });
}

/** Current keyboard-independent viewport height in px. */
export function stableViewportHeight(): number {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--vh-stable'),
  );
  return Number.isFinite(v) && v > 0 ? v : window.innerHeight;
}

/** Opens a URL outside the WebView (system browser / matching app). */
export function openExternal(url: string): void {
  if (isNativeApp()) {
    window.open(url, '_system');
  } else {
    window.open(url, '_blank', 'noreferrer');
  }
}

const ONBOARDED_KEY = 'mms.onboarded';

export function isOnboarded(): boolean {
  return localStorage.getItem(ONBOARDED_KEY) === '1';
}

export function markOnboarded(): void {
  localStorage.setItem(ONBOARDED_KEY, '1');
}

export function resetOnboarding(): void {
  localStorage.removeItem(ONBOARDED_KEY);
}
