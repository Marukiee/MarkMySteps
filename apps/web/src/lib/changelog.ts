/**
 * What changed, in words that mean something without the code in front of you.
 *
 * Written by hand rather than generated from the git log: a commit says what
 * moved, an entry here says what you will notice. Newest first — add to the
 * top, and keep each line to one thing somebody could go and look at.
 */

export interface ChangeEntry {
  /** Shown as the heading. Free-form: a date, a version, a name. */
  title: string;
  /** yyyy-mm-dd, printed under the title. */
  date: string;
  /** One line per change. */
  items: string[];
  /** Marks the newest entry so it can be flagged as new. */
  highlight?: boolean;
}

export const CHANGELOG: ChangeEntry[] = [
  {
    title: 'Rondleiding, kaart en beveiliging',
    date: '2026-07-31',
    highlight: true,
    items: [
      'Een deel-link gaf te veel weg: het token erachter werd door de server ook als gewoon inloggen geaccepteerd. Dat is dichtgezet.',
      'De rondleiding laat nu de app zelf zien: je route die zich op de globe bouwt, je reizen met hun cijfers, en een slot dat zegt waar je begint.',
      'Stippellijnen op de kaart staan alleen nog waar niets is vastgelegd, en zijn leesbaar op de satellietkaart.',
      'Tracking stopt vanzelf zodra je reis voorbij is, en zegt dat ook.',
      "Een toekomstige reis wordt netjes gekaderd op de kaart, en foto's liggen over de stops in plaats van eronder.",
      'Tabbladen, thema-keuze en het maat-menu delen één pil die meeschuift.',
    ],
  },
  {
    title: "Foto's van je toestel",
    date: '2026-07-30',
    items: [
      "Foto's uit je galerij kunnen bij een reis op de server, zonder ze te uploaden: ze blijven op je telefoon.",
      'Uitnodigingen laten een foto uit de reis zien, en sluiten als je ernaast tikt.',
      'De globe: vluchten volgen de boog waarop ze getekend zijn, en elke stop geeft een ring als het licht er langskomt.',
    ],
  },
  {
    title: 'De globe die je reis naloopt',
    date: '2026-07-29',
    items: [
      'Een lichtpunt loopt je hele reis af, remt af bij een stop, wacht daar en gaat verder.',
      'Vluchten krijgen een vliegtuigje dat de boog vliegt en echt landt.',
      'Detail op de globe komt erbij zodra je inzoomt, niet eerder.',
    ],
  },
];
