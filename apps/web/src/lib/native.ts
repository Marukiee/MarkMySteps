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

/** Android back gesture: navigate back in history, exit the app at the root. */
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
