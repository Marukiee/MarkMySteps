/**
 * What changed, in words that mean something without the code in front of you.
 *
 * Written by hand rather than generated from the git log: a commit says what
 * moved, an entry here says what you can go and use. Newest first, and short:
 * one line per thing, no explanations of how it works.
 *
 * Three groups, because they answer different questions. `new` is what you can
 * now do, `better` is what you already did and now goes more smoothly, and
 * `fixed` is what was broken.
 */

export interface ChangeEntry {
  /** Shown as the heading. Free-form: a date, a version, a name. */
  title: string;
  /** yyyy-mm-dd, printed under the title. */
  date: string;
  /** Things you could not do before. */
  new?: string[];
  /** Things that already worked and now work better. */
  better?: string[];
  /** Things that were broken. */
  fixed?: string[];
  /** Marks the newest entry so it can be flagged as new. */
  highlight?: boolean;
}

export const CHANGELOG: ChangeEntry[] = [
  {
    title: 'Rondleiding en kaart',
    date: '2026-08-01',
    highlight: true,
    new: [
      'Nieuwe rondleiding, met de app zelf in beeld',
      'Deze pagina: wat is er nieuw',
      'Iemand toevoegen als reisgenoot of als gast, in één keer',
    ],
    better: [
      'Stippellijnen alleen waar niets is vastgelegd',
      'Tracking stopt vanzelf als je reis voorbij is, en zegt dat',
      "Foto's liggen op de kaart over de stops, niet eronder",
      'Geplande reizen tellen niet mee in je cijfers',
    ],
    fixed: [
      'Deel-links gaven te veel weg (dichtgezet na een beveiligingscheck)',
      'Onderaan een pagina kwam je op de mobiele site niet meer',
      'De knoppen op een reiskaart gingen schuil achter je eigen foto’s',
    ],
  },
  {
    title: "Foto's van je toestel",
    date: '2026-07-30',
    new: [
      "Galerijfoto's bij een reis, zonder uploaden",
      'Uitnodiging met een foto uit de reis',
    ],
    better: ['Vluchten volgen hun eigen boog op de globe'],
  },
  {
    title: 'De globe loopt je reis na',
    date: '2026-07-29',
    new: ['Een lichtpunt loopt je route af en stopt bij elke plaats'],
    better: [
      'Vliegtuigje dat de boog vliegt en landt',
      'Meer detail zodra je inzoomt',
    ],
  },
];
