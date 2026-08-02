import type { IconName } from '../components/Icon';

/**
 * The picture a trip without a photo gets.
 *
 * A compass for anything we can't place, but most trips say what they are in
 * their own name: an interrail is a train, a roadtrip is a car. Matched on
 * whole words so "Barcelona" is not a boat and "Autriche" is not a car — and
 * on lowercase, accent-stripped text, because people type "Zürich" and
 * "kroatie" and "ROADTRIP 2026".
 *
 * Order matters: the first rule that matches wins, so the specific ones
 * (interrail) come before the general ones (trein). Deliberately few: a rule
 * that fires on a word people use loosely ("Busreis" for a trip that is mostly
 * flying) puts the wrong picture on the card, and the compass is never wrong.
 */
const RULES: { icon: IconName; words: string[] }[] = [
  { icon: 'train', words: ['interrail', 'eurail', 'trein', 'train', 'rail', 'spoor', 'nightjet'] },
  {
    icon: 'car',
    words: ['roadtrip', 'road', 'auto', 'camper', 'caravan', 'rijden', 'busje', 'van'],
  },
  { icon: 'walk', words: ['wandel', 'wandelen', 'hike', 'hiking', 'trektocht', 'camino', 'lopen'] },
];

/** Lowercase, without accents, punctuation turned into spaces. */
function words(title: string): string[] {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Which icon belongs on this trip's blank cover.
 *
 * Falls back to the compass, which is what every coverless trip used to get.
 */
export function tripGlyph(title: string | null | undefined): IconName {
  if (!title) return 'compass';
  const parts = words(title);
  if (parts.length === 0) return 'compass';
  for (const rule of RULES) {
    // Whole words, but a compound like "treinreis" or "roadtrip2026" should
    // still count — so a part matches when it starts with the keyword.
    if (parts.some((part) => rule.words.some((w) => part === w || part.startsWith(w)))) {
      return rule.icon;
    }
  }
  return 'compass';
}

/** Every rule, for the developer-options preview of the covers. */
export const TRIP_GLYPH_RULES = RULES;

/**
 * How big that glyph should be drawn on a cover.
 *
 * The compass fills its own circle; the vehicles are a shape with air around
 * them and read a size smaller at the same number. A quarter more brings them
 * back to the same visual weight.
 */
export function tripGlyphSize(title: string | null | undefined, base: number): number {
  return tripGlyph(title) === 'compass' ? base : Math.round(base * 1.3);
}

/**
 * How thick that glyph's lines should be.
 *
 * The icons are drawn on a 24-unit grid with a 2-unit stroke, so rendering one
 * a third bigger also makes its lines a third thicker — beside the compass,
 * which is not scaled, that reads as a different set of icons. Dividing it
 * back out keeps every glyph the same weight.
 */
export function tripGlyphStroke(title: string | null | undefined): number {
  return tripGlyph(title) === 'compass' ? 2 : 2 / 1.3;
}
