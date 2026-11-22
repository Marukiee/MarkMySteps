import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * The page's side of the updater all of Marks Android apps share (markupdate,
 * in android/markupdate, copied unchanged from Keeper).
 *
 * Finding the newest release on GitHub, downloading it with its checksum and
 * installing it without a second tap all happen there. This only reads its
 * state for the update card and passes the card's buttons back.
 */

export type UpdateKind =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'needsPermission'
  | 'installing'
  | 'awaitingConfirmation'
  | 'failed';

export interface UpdateInfo {
  kind: UpdateKind;
  /** The build that is running. */
  current?: string;
  /** The build on offer. */
  version?: string;
  /** At most two short lines from the release. */
  notes?: string[];
  sizeBytes?: number;
  /** 0 to 1 while downloading. */
  progress?: number;
  reason?: string;
}

interface MmsUpdatePlugin {
  state(): Promise<UpdateInfo>;
  check(options: { manual: boolean }): Promise<void>;
  start(): Promise<void>;
  later(): Promise<void>;
  preview(options: { fail?: boolean; reason?: string }): Promise<void>;
  addListener(event: 'state', handler: (info: UpdateInfo) => void): Promise<PluginListenerHandle>;
}

const MmsUpdate = registerPlugin<MmsUpdatePlugin>('MmsUpdate');

/** Only the APK updates itself; the iPhone gets its builds through TestFlight. */
export function canUpdateInApp(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('MmsUpdate');
}

export async function getUpdateState(): Promise<UpdateInfo> {
  if (!canUpdateInApp()) return { kind: 'idle' };
  return MmsUpdate.state();
}

export function onUpdateState(handler: (info: UpdateInfo) => void): () => void {
  if (!canUpdateInApp()) return () => undefined;
  const handle = MmsUpdate.addListener('state', handler);
  return () => void handle.then((h) => h.remove()).catch(() => undefined);
}

/** On launch the updater asks at most every six hours; `manual` asks now. */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!canUpdateInApp()) return;
  await MmsUpdate.check({ manual });
}

/** Update, or try again after a failure. */
export async function startUpdate(): Promise<void> {
  if (!canUpdateInApp()) return;
  await MmsUpdate.start();
}

/** This version stays hidden until there is a newer one. */
export async function updateLater(): Promise<void> {
  if (!canUpdateInApp()) return;
  await MmsUpdate.later();
}

/** Developer options: a pretend release to walk the card through. */
export async function previewUpdate(fail = false): Promise<void> {
  if (!canUpdateInApp()) return;
  await MmsUpdate.preview({ fail, reason: fail ? 'Test' : undefined });
}
