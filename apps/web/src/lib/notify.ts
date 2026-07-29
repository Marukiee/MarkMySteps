import { Capacitor, registerPlugin } from '@capacitor/core';

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
}

const MmsNotify = registerPlugin<MmsNotifyPlugin>('MmsNotify');

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
