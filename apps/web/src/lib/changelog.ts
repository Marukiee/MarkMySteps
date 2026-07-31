/**
 * What changed, in words that mean something without the code in front of you.
 *
 * Written by hand rather than generated from the git log: a commit says what
 * moved, an entry here says what you can go and use. Newest first, and short:
 * one line per thing, no explanations of how it works.
 */

export interface ChangeEntry {
  /** Shown as the heading. Free-form: a date, a version, a name. */
  title: string;
  /** yyyy-mm-dd, printed under the title. */
  date: string;
  /** One line per change. Keep them to a handful of words. */
  items: string[];
  /** Marks the newest entry so it can be flagged as new. */
  highlight?: boolean;
}

export const CHANGELOG: ChangeEntry[] = [
  {
    title: 'Rondleiding en kaart',
    date: '2026-07-31',
    highlight: true,
    items: [
      'Nieuwe rondleiding, met de app zelf in beeld',
      'Deel-links dichtgezet na een beveiligingscheck',
      'Stippellijnen alleen waar niets is vastgelegd',
      'Tracking stopt vanzelf als je reis voorbij is',
      'Wat is er nieuw (deze pagina)',
    ],
  },
  {
    title: "Foto's van je toestel",
    date: '2026-07-30',
    items: [
      "Galerijfoto's bij een reis, zonder uploaden",
      "Uitnodiging met een foto uit de reis",
      'Vluchten volgen hun eigen boog op de globe',
    ],
  },
  {
    title: 'De globe loopt je reis na',
    date: '2026-07-29',
    items: [
      'Een lichtpunt loopt je route af en stopt bij elke plaats',
      'Vliegtuigje dat de boog vliegt en landt',
      'Meer detail zodra je inzoomt',
    ],
  },
];
