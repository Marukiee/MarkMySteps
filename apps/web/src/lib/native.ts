import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
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

/**
 * Tints the native status bar, so a coloured banner at the top of the page
 * doesn't sit under a black or white strip. Pass null to hand it back to the
 * theme.
 */
export function setStatusBarTint(color: string | null, lightIcons = true): void {
  if (!isNativeApp()) return;
  if (color === null) {
    syncStatusBarTheme();
    return;
  }
  // The bar overlays the WebView, so its background is whatever the page paints
  // underneath. Only the icon colour is ours to set here; the banner extends up
  // under the bar to supply the colour itself.
  void StatusBar.setStyle({ style: lightIcons ? Style.Dark : Style.Light }).catch(() => undefined);
}

function syncStatusBarTheme(): void {
  if (!isNativeApp()) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  // Style.Dark = light icons (for a dark UI); Style.Light = dark icons.
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
}

/**
 * Android back gesture: navigate back in history, exit the app at the root.
 *
 * A predictive-back version of this (the page shrinking under your finger) was
 * tried and removed: transforming the app makes every `position: fixed` element
 * — the tab bar in particular — scale along with it, which reads as the bar
 * jumping. Doing it properly needs the previous page rendered underneath, i.e. a
 * layered router, so plain navigation it is.
 */
export function initBackButton(): void {
  if (!isNativeApp()) return;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
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
