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
  if (!password) return { score: 0, label: 'Nog leeg', tip: null };

  const lower = password.toLowerCase();
  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  const distinct = new Set(password).size;

  const weak = (tip: string): Strength => ({ score: 1, label: 'Zwak', tip });

  if (password.length < 10) {
    return { score: 0, label: 'Te kort', tip: 'Minimaal 10 tekens.' };
  }
  if (COMMON.some((c) => lower.includes(c))) {
    return weak('Dit staat in elke lijst die een inbreker als eerste probeert.');
  }
  for (const part of personal) {
    const clean = part.trim().toLowerCase();
    if (clean.length >= 4 && lower.includes(clean)) {
      return weak('Je naam, gebruikersnaam of e-mailadres erin maakt het makkelijk te raden.');
    }
  }
  if (distinct <= 4) {
    return weak('Te weinig verschillende tekens.');
  }

  let score = 1;
  if (password.length >= 14) score += 1;
  if (password.length >= 18) score += 1;
  if (classes >= 3) score += 1;
  if (hasRun(password)) score -= 1;
  if (classes === 1 && password.length < 18) score -= 1;

  const capped = Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
  const labels = { 1: 'Zwak', 2: 'Matig', 3: 'Sterk', 4: 'Zeer sterk' } as const;

  let tip: string | null = null;
  if (capped < 4) {
    if (password.length < 14) tip = 'Langer helpt meer dan ingewikkelder: probeer een zin.';
    else if (classes < 3) tip = 'Meng hoofdletters, cijfers of leestekens erdoor.';
    else if (hasRun(password)) tip = 'Vermijd reeksen als "abc" of "111".';
  }

  return { score: capped, label: labels[capped], tip };
}
