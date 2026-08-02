import { Capacitor, registerPlugin } from '@capacitor/core';
import { api, getServerBase } from '../api/client';

/**
 * A one-off notification from the app itself (MmsNotifyPlugin).
 *
 * There is no push service: the target phones have no Play Services, and
 * adding one would mean handing a third party the fact that you use this app.
 * So nothing arrives while the app is not running — this is for the moment the
 * app itself notices something and you have switched away.
 */

interface MmsNotifyPlugin {
  show(options: { title: string; body: string }): Promise<void>;
  /** Start the quarter-hourly background check with a token of its own. */
  enableBackground(options: { baseUrl: string; token: string }): Promise<void>;
  disableBackground(): Promise<void>;
  permission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  /** Where a tapped notification wants the app to go, once. */
  takePendingPath(): Promise<{ path: string | null }>;
}

const MmsNotify = registerPlugin<MmsNotifyPlugin>('MmsNotify');

const BG_KEY = 'mms.notify.background';
const TOKEN_KEY = 'mms.notify.token';

/** Whether the phone is set to check for news on its own. */
export function backgroundNotifyOn(): boolean {
  return localStorage.getItem(BG_KEY) === '1';
}

export function backgroundNotifySupported(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Switches the background check on.
 *
 * The worker runs outside the WebView and cannot reach the session, so the
 * server hands out a token that can do nothing except ask whether anything is
 * waiting. Asking for the notification permission first: without it the worker
 * would run every quarter of an hour and post nothing.
 */
export async function enableBackgroundNotify(): Promise<
  { ok: true } | { ok: false; reason: 'denied' | 'failed' }
> {
  if (!Capacitor.isNativePlatform()) return { ok: false, reason: 'failed' };
  try {
    const { granted } = await MmsNotify.requestPermission();
    if (!granted) return { ok: false, reason: 'denied' };
    const { token } = await api<{ token: string }>('/notifications/device', { method: 'POST' });
    await MmsNotify.enableBackground({ baseUrl: getServerBase(), token });
    localStorage.setItem(BG_KEY, '1');
    localStorage.setItem(TOKEN_KEY, token);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export async function disableBackgroundNotify(): Promise<void> {
  localStorage.removeItem(BG_KEY);
  const token = localStorage.getItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  if (Capacitor.isNativePlatform()) {
    await MmsNotify.disableBackground().catch(() => undefined);
  }
  // The row on the server outlives the app otherwise, and it is a live token.
  await api('/notifications/device', {
    method: 'DELETE',
    body: token ? { token } : {},
  }).catch(() => undefined);
}

/**
 * Re-arms the check at launch.
 *
 * WorkManager keeps periodic work across reboots, but not across a reinstall
 * or a server change, and the token belongs to whoever is logged in — so this
 * runs on every start and is cheap when nothing has changed.
 */
export async function resumeBackgroundNotify(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !backgroundNotifyOn()) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    await enableBackgroundNotify();
    return;
  }
  await MmsNotify.enableBackground({ baseUrl: getServerBase(), token }).catch(() => undefined);
}

/** The route a tapped notification asked for, or null. Consumed once. */
export async function takeNotificationPath(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { path } = await MmsNotify.takePendingPath();
    return path ?? null;
  } catch {
    return null;
  }
}

export function notify(title: string, body: string): void {
  if (Capacitor.isNativePlatform()) {
    void MmsNotify.show({ title, body }).catch(() => undefined);
    return;
  }
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    /* best effort */
  }
}
