import { createHmac } from 'node:crypto';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  timeStep,
  totpCode,
  verifyTotp,
} from './totp';

// RFC 6238, appendix B: the SHA-1 secret is the ASCII string "12345678901234567890",
// and the table gives the 8-digit code at each moment. The last six digits of
// those are the six-digit codes this implementation produces.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp', () => {
  it.each(RFC_VECTORS)('matches the RFC 6238 test vector at t=%i', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(hotp(secret, counter)).toBe(code));
  });

  it('agrees with an independent HMAC-SHA1 implementation on random secrets', () => {
    for (let i = 0; i < 50; i++) {
      const secret = generateTotpSecret();
      const now = 1_700_000_000_000 + i * 12_345_678;
      // The textbook algorithm, spelled out separately from hotp().
      const counter = Buffer.alloc(8);
      counter.writeUInt32BE(Math.floor(timeStep(now) / 2 ** 32), 0);
      counter.writeUInt32BE(timeStep(now) >>> 0, 4);
      const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
      const o = h[19]! & 15;
      const n = ((h[o]! & 0x7f) * 2 ** 24) + (h[o + 1]! << 16) + (h[o + 2]! << 8) + h[o + 3]!;
      expect(totpCode(secret, now)).toBe(String(n % 1_000_000).padStart(6, '0'));
    }
  });

  describe('base32', () => {
    it('round-trips', () => {
      for (let length = 0; length < 40; length++) {
        const bytes = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + length) & 255));
        expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
      }
    });
    it('reads lower case, spaces and dashes, as people type them', () => {
      expect(base32Decode('mfrg gzdf-mztq====').toString()).toBe('abcdefg');
    });
    it('rejects what is not base32', () => {
      expect(() => base32Decode('not*base32')).toThrow();
    });
    it('makes 160-bit secrets that differ every time', () => {
      const a = generateTotpSecret();
      expect(a).toHaveLength(32);
      expect(a).not.toBe(generateTotpSecret());
    });
  });

  describe('verifyTotp', () => {
    const secret = RFC_SECRET;
    const now = 1_111_111_109_000; // step 37037036, code 081804

    it('accepts the current code', () => {
      expect(verifyTotp(secret, '081804', { nowMs: now })).toEqual({ step: timeStep(now) });
    });
    it('tolerates spaces, as the app shows the code in two groups', () => {
      expect(verifyTotp(secret, '081 804', { nowMs: now })).not.toBeNull();
    });
    it('accepts the step before and after, for a clock a little off', () => {
      const previous = totpCode(secret, now - 30_000);
      const next = totpCode(secret, now + 30_000);
      expect(verifyTotp(secret, previous, { nowMs: now })).not.toBeNull();
      expect(verifyTotp(secret, next, { nowMs: now })).not.toBeNull();
    });
    it('refuses a code two steps away', () => {
      expect(verifyTotp(secret, totpCode(secret, now - 90_000), { nowMs: now })).toBeNull();
      expect(verifyTotp(secret, totpCode(secret, now + 90_000), { nowMs: now })).toBeNull();
    });
    it('refuses a wrong code and anything that is not six digits', () => {
      expect(verifyTotp(secret, '000000', { nowMs: now })).toBeNull();
      expect(verifyTotp(secret, '08180', { nowMs: now })).toBeNull();
      expect(verifyTotp(secret, '0818044', { nowMs: now })).toBeNull();
      expect(verifyTotp(secret, 'abcdef', { nowMs: now })).toBeNull();
      expect(verifyTotp(secret, '', { nowMs: now })).toBeNull();
    });
    it('refuses a code whose step was already used, even though it is still valid', () => {
      const first = verifyTotp(secret, '081804', { nowMs: now });
      expect(first).not.toBeNull();
      // Same code, moments later, with the step it matched remembered:
      expect(verifyTotp(secret, '081804', { nowMs: now + 5_000, lastStep: first!.step })).toBeNull();
      // …and the previous step's code is no good once a later one has been used.
      expect(
        verifyTotp(secret, totpCode(secret, now - 30_000), { nowMs: now, lastStep: first!.step }),
      ).toBeNull();
      // The next code still works.
      expect(
        verifyTotp(secret, totpCode(secret, now + 30_000), { nowMs: now + 30_000, lastStep: first!.step }),
      ).not.toBeNull();
    });
  });

  describe('otpauthUri', () => {
    it('is what an authenticator app reads', () => {
      const uri = otpauthUri({ secret: 'ABCDEFGH', account: 'mark@example.com', issuer: 'MarkMySteps' });
      expect(uri).toBe(
        'otpauth://totp/MarkMySteps:mark%40example.com?secret=ABCDEFGH&issuer=MarkMySteps&algorithm=SHA1&digits=6&period=30',
      );
    });
    it('escapes what would break the label', () => {
      const uri = otpauthUri({ secret: 'AB', account: 'a b:c/d', issuer: 'My Steps' });
      expect(uri.startsWith('otpauth://totp/My%20Steps:a%20b%3Ac%2Fd?')).toBe(true);
    });
  });
});
