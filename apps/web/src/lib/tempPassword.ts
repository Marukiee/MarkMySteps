/** Letters and digits that cannot be read as one another: no 0/o, 1/l/i. */
const READABLE = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * A temporary password someone can read out or type over from a message:
 * three groups of four, like "kq7m-x2pa-wd9e". Fourteen characters, well past
 * the ten the server asks for.
 */
export function makeTempPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => READABLE[b % READABLE.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join('')).join('-');
}
