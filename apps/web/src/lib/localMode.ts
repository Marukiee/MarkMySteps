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

/** The one account that exists on the device. Never leaves it. */
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
