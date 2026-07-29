/**
 * "No server" mode: every request the app makes is answered on the device.
 *
 * It is a single flag rather than a build flavour, so the same binary can go
 * either way and — more importantly — so someone who starts local can hand
 * their data to a server later without reinstalling anything.
 */

const KEY = 'mms.localMode';

export function isLocalMode(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function setLocalMode(on: boolean): void {
  if (on) localStorage.setItem(KEY, '1');
  else localStorage.removeItem(KEY);
}

const NAME_KEY = 'mms.localName';

/** Your name, asked once during onboarding. */
export function getLocalName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

export function setLocalName(name: string): void {
  const clean = name.trim();
  if (clean) localStorage.setItem(NAME_KEY, clean);
  else localStorage.removeItem(NAME_KEY);
}

/** The one identity that exists on the device. Never leaves it. */
export const LOCAL_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'lokaal@markmysteps',
  username: 'ik',
  displayName: 'Ik',
  // Not ADMIN: the account-management screens are server-only, and giving the
  // local account that role would show them just to have them fail.
  role: 'USER' as const,
  mustChangePassword: false,
  hasAvatar: false,
};

/**
 * Without a server there is no account, so this is not one: it is just the
 * name that goes on your own trips. Read fresh each time, because onboarding
 * can set it after the app has already started.
 */
export function localUser(): typeof LOCAL_USER {
  const name = getLocalName();
  return name ? { ...LOCAL_USER, displayName: name, username: name } : LOCAL_USER;
}

/**
 * Without a server there are no other travellers, so the tab is only your own
 * numbers. Calling it "Reizigers" then names something that isn't there.
 */
export function travellersTabLabel(): string {
  return isLocalMode() ? 'Statistieken' : 'Reizigers';
}
