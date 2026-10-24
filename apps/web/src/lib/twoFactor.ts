import { ApiError } from '../api/client';

/**
 * What to tell somebody when the server turned a sign-in step down.
 *
 * The server's own messages are English and short. The ones a person will meet
 * while setting this up or signing in are said in Dutch here; anything else is
 * passed on as it came.
 */
const KNOWN: Record<string, string> = {
  'That code is not right': 'Die code klopt niet.',
  'That code is not right. Check the clock on your phone.':
    'Die code klopt niet. Controleer of de klok van je telefoon goed staat.',
  'Current password is incorrect': 'Dat wachtwoord klopt niet.',
  'Invalid email or password': 'E-mailadres of wachtwoord klopt niet.',
  'Two-step verification is already on': 'Tweestapsverificatie staat al aan.',
  'Two-step verification is off': 'Tweestapsverificatie staat uit.',
  'Start the setup first': 'Begin eerst met de installatie.',
};

export function signInProblem(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const minutes = /(\d+) minute/.exec(err.message)?.[1];
      return minutes
        ? `Te veel foute pogingen. Probeer het over ${minutes} ${minutes === '1' ? 'minuut' : 'minuten'} opnieuw.`
        : 'Te veel pogingen. Probeer het zo opnieuw.';
    }
    if (err.status === 401 && err.message === 'Sign in again') {
      return 'Je inlogpoging is verlopen. Log opnieuw in.';
    }
  }
  if (err instanceof Error) return KNOWN[err.message] ?? err.message;
  return fallback;
}

/** "ABCD-EFGH-…" → what the person typed, minus the spaces that authenticator apps add. */
export function looksLikeAppCode(value: string): boolean {
  return /^\d{6}$/.test(value.replace(/\s/g, ''));
}
