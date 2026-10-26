import { t } from '../i18n';
/**
 * How strong a password looks, for the meter under the field.
 *
 * This is a hint, not a gate: the server applies its own rules and is the only
 * side that can actually refuse one. What it is for is telling someone *why*
 * theirs is weak while they can still do something about it, instead of after
 * a failed submit.
 */

/** Passwords common enough that a guesser tries them in the first thousand. */
const COMMON = [
  'password',
  'wachtwoord',
  'welkom',
  'welcome',
  'qwerty',
  'azerty',
  'letmein',
  'iloveyou',
  'admin',
  'geheim',
  'monkey',
  'dragon',
  'football',
  'voetbal',
  'sunshine',
  'princess',
  'zonnetje',
  'abcdef',
  'qwertyuiop',
  '123456',
  '1234567890',
];

export interface Strength {
  /** 0 (unusable) to 4 (very strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** The one thing that would help most, or null when nothing would. */
  tip: string | null;
}

/** Runs of three or more, in either direction: "abc", "321", "aaa". */
function hasRun(value: string): boolean {
  const s = value.toLowerCase();
  for (let i = 0; i + 2 < s.length; i++) {
    const a = s.charCodeAt(i);
    const b = s.charCodeAt(i + 1);
    const c = s.charCodeAt(i + 2);
    if ((b - a === 1 && c - b === 1) || (a - b === 1 && b - c === 1) || (a === b && b === c)) {
      return true;
    }
  }
  return false;
}

export function passwordStrength(password: string, personal: string[] = []): Strength {
  if (!password) return { score: 0, label: t('settings.password.strength.empty'), tip: null };

  const lower = password.toLowerCase();
  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  const distinct = new Set(password).size;

  const weak = (tip: string): Strength => ({ score: 1, label: t('settings.password.strength.weak'), tip });

  if (password.length < 10) {
    return { score: 0, label: t('settings.password.strength.tooShort'), tip: t('settings.password.tip.minLength') };
  }
  if (COMMON.some((c) => lower.includes(c))) {
    return weak(t('settings.password.tip.common'));
  }
  for (const part of personal) {
    const clean = part.trim().toLowerCase();
    if (clean.length >= 4 && lower.includes(clean)) {
      return weak(t('settings.password.tip.personal'));
    }
  }
  if (distinct <= 4) {
    return weak(t('settings.password.tip.distinct'));
  }

  let score = 1;
  if (password.length >= 14) score += 1;
  if (password.length >= 18) score += 1;
  if (classes >= 3) score += 1;
  if (hasRun(password)) score -= 1;
  if (classes === 1 && password.length < 18) score -= 1;

  const capped = Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
  const labels = { 1: t('settings.password.strength.weak'), 2: t('settings.password.strength.fair'), 3: t('settings.password.strength.strong'), 4: t('settings.password.strength.veryStrong') } as const;

  let tip: string | null = null;
  if (capped < 4) {
    if (password.length < 14) tip = t('settings.password.tip.longer');
    else if (classes < 3) tip = t('settings.password.tip.mix');
    else if (hasRun(password)) tip = t('settings.password.tip.runs');
  }

  return { score: capped, label: labels[capped], tip };
}
