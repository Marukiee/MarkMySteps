import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { openExternal } from './native';

/**
 * Installing a new version without leaving the app.
 *
 * There is no Play Store on the target phones, so "there is an update" used to
 * mean: open a browser, download an APK, find it again in Downloads, tap it,
 * and work out why Android refuses to install it. This is the same thing in
 * one press. Android still shows its own install screen at the end, and still
 * wants the per-app "install unknown apps" switch, so nothing is installed
 * behind anyone's back — the app only spares them the four screens in front.
 */

interface MmsUpdatePlugin {
  canInstall(): Promise<{ granted: boolean }>;
  /** Opens the settings screen for "install unknown apps" (there is no dialog). */
  requestPermission(): Promise<{ granted: boolean }>;
  download(options: { url: string }): Promise<{ path: string }>;
  cancel(): Promise<void>;
  install(options: { path: string }): Promise<{ started: boolean; needsPermission: boolean }>;
  clean(): Promise<void>;
  addListener(
    event: 'progress',
    handler: (data: { loaded: number; total: number; percent: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const MmsUpdate = registerPlugin<MmsUpdatePlugin>('MmsUpdate');

/**
 * What became of the attempt.
 *
 * `browser` is the honest fallback: an older APK has no plugin to call, and a
 * browser download is still better than a button that does nothing.
 */
export type UpdateOutcome = 'installing' | 'permission' | 'browser' | 'failed';

export function canInstallInApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Fetches the APK and hands it to Android's installer, reporting progress on
 * the way. Falls back to opening the link when anything about that is not
 * available.
 */
export async function downloadAndInstall(
  url: string,
  onProgress?: (percent: number) => void,
): Promise<UpdateOutcome> {
  if (!Capacitor.isNativePlatform()) {
    openExternal(url);
    return 'browser';
  }

  let listener: PluginListenerHandle | null = null;
  try {
    // Asked before the download rather than after it: being sent to a settings
    // screen is annoying, being sent there after waiting for 60MB is worse.
    const { granted } = await MmsUpdate.canInstall();
    if (!granted) {
      await MmsUpdate.requestPermission();
      return 'permission';
    }

    if (onProgress) {
      listener = await MmsUpdate.addListener('progress', ({ percent }) => {
        if (percent >= 0) onProgress(percent);
      });
    }
    const { path } = await MmsUpdate.download({ url });
    const { needsPermission } = await MmsUpdate.install({ path });
    return needsPermission ? 'permission' : 'installing';
  } catch (err) {
    // A build without the plugin (or an install the user backed out of) should
    // still leave a way forward.
    if (isMissingPlugin(err)) {
      openExternal(url);
      return 'browser';
    }
    return 'failed';
  } finally {
    await listener?.remove();
  }
}

/** Stops a download that is still running. */
export async function cancelUpdateDownload(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await MmsUpdate.cancel().catch(() => undefined);
}

/** Throws away a downloaded APK once it is no longer any use. */
export async function cleanUpdateDownloads(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await MmsUpdate.clean().catch(() => undefined);
}

function isMissingPlugin(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /not implemented|unimplemented|not available/i.test(message);
}
