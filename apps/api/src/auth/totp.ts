import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238), the kind an authenticator app such
 * as Proton Authenticator, Aegis or Google Authenticator shows: six digits that
 * change every thirty seconds.
 *
 * Written against node:crypto rather than pulled in as a package, because the
 * whole thing is a dozen lines and a dependency here would be one more thing
 * that has to be trusted with every account's second factor.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** How many steps either side of now still count: a phone clock a little off. */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A fresh secret: 160 bits, the size RFC 4226 recommends, as base32 text. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The time step a moment falls in: how many thirty-second periods since 1970. */
export function timeStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** HOTP (RFC 4226) for one counter value, as a zero-padded string. */
export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The code the app shows for this secret at this moment. */
export function totpCode(secretBase32: string, nowMs: number = Date.now()): string {
  return hotp(base32Decode(secretBase32), timeStep(nowMs));
}

export interface TotpMatch {
  /** The step the code belongs to; remember it so the same code is not taken twice. */
  step: number;
}

/**
 * Checks a code against a secret, and answers with the step it matched, or null.
 *
 * `lastStep` is the newest step already used for this account. A code from that
 * step or an older one is refused, so a code that was just typed in (or watched
 * over a shoulder, or captured on the way) cannot be played a second time within
 * the thirty seconds it would otherwise still be good for.
 *
 * Every candidate in the window is compared, and compared in constant time, so
 * the time taken says nothing about how close a guess was.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { nowMs?: number; lastStep?: number | null } = {},
): TotpMatch | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;

  const secret = base32Decode(secretBase32);
  const now = timeStep(options.nowMs);
  const attempt = Buffer.from(typed);

  let matched: number | null = null;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, attempt) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (options.lastStep != null && matched <= options.lastStep) return null;
  return { step: matched };
}

/**
 * What goes in the QR code. The format authenticator apps read: label, secret,
 * and the parameters spelled out so an app that does not assume the defaults
 * still gets them right.
 */
export function otpauthUri(options: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
