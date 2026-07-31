/** Stable per-traveller route colors — warm, distinct, readable on light maps. */
const PALETTE = ['#e8613c', '#2a8f85', '#5b6ee1', '#c98a2d', '#b04a98', '#4a8f3c', '#8a5be1'];

export function colorForUser(userId: string): string {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length]!;
}

/** Mixes a #rrggbb colour toward white by `amount` (0..1). */
export function lighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Compact stay range: "20 – 29 jul 2026", "20 jul – 3 aug 2026". Repeating the
 * month and year on both ends made the line too long to keep the weather beside
 * it, which is the only reason this exists.
 */
export function formatDateRange(from: string, to: string): string {
  const a = new Date(from);
  const b = new Date(to);
  const day = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric' });
  const dayMonth = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  const full = (d: Date) =>
    d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  if (a.getFullYear() !== b.getFullYear()) return `${full(a)} – ${full(b)}`;
  if (a.getMonth() === b.getMonth()) return `${day(a)} – ${full(b)}`;
  return `${dayMonth(a)} – ${full(b)}`;
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "NL" → 🇳🇱 (regional indicator pair); empty for unknown codes. */
export function flagEmoji(countryCode?: string | null): string {
  if (!countryCode || countryCode.length !== 2) return '';
  const base = 0x1f1e6 - 65;
  const code = countryCode.toUpperCase();
  return String.fromCodePoint(base + code.charCodeAt(0), base + code.charCodeAt(1));
}

/** Deterministic warm gradient per trip — what a trip looks like before it has
 *  a photo on it. */
export function coverGradient(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const hue1 = hash % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 45% 72%), hsl(${hue2} 50% 58%))`;
}

/**
 * Backdrop for a trip that has no photo yet: its own colour as a soft duotone,
 * else the gradient above. Shared by the cards on the home page and the header
 * on the trip itself, so a trip looks like the same trip in both places — the
 * header used to fall back to a blank panel.
 */
export function tripCoverBg(trip: { id: string; color?: string | null }): string {
  if (trip.color) return `linear-gradient(145deg, ${trip.color}, ${trip.color}b0)`;
  return coverGradient(trip.id);
}
