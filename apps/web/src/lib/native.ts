import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
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
