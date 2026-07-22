/** Stable per-traveller route colors — warm, distinct, readable on light maps. */
const PALETTE = ['#e8613c', '#2a8f85', '#5b6ee1', '#c98a2d', '#b04a98', '#4a8f3c', '#8a5be1'];

export function colorForUser(userId: string): string {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length]!;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
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
