import { ApiError } from '../api/client';
import { t, TKey } from '../i18n';

/**
 * What to tell somebody when the server turned a sign-in step down.
 *
 * The server's own messages are English and short. The ones a person will meet
 * while setting this up or signing in are said in the app's language here;
 * anything else is passed on as it came.
 */
const KNOWN: Record<string, TKey> = {
  'That code is not right': 'auth.error.codeWrong',
  'That code is not right. Check the clock on your phone.': 'auth.error.codeWrongClock',
  'Current password is incorrect': 'auth.error.passwordWrong',
  'Invalid email or password': 'auth.error.loginWrong',
  'Two-step verification is already on': 'auth.error.twoFactorOn',
  'Two-step verification is off': 'auth.error.twoFactorOff',
  'Start the setup first': 'auth.error.setupFirst',
};

export function signInProblem(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const minutes = /(\d+) minute/.exec(err.message)?.[1];
      return minutes
        ? t('auth.error.tooManyMinutes', { count: Number(minutes) })
        : t('auth.error.tooMany');
    }
    if (err.status === 401 && err.message === 'Sign in again') {
      return t('auth.error.expired');
    }
  }
  if (err instanceof Error) {
    const key = KNOWN[err.message];
    return key ? t(key) : err.message;
  }
  return fallback;
}

/** "ABCD-EFGH-…" → what the person typed, minus the spaces that authenticator apps add. */
export function looksLikeAppCode(value: string): boolean {
  return /^\d{6}$/.test(value.replace(/\s/g, ''));
}
