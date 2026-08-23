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
    title: 'Sneller door een lange reis',
    date: '2026-08-23',
    highlight: true,
    new: [
      'Pillen boven de tijdlijn brengen je in \u00e9\u00e9n tik naar een stop, in de app en in een deel-link',
      'De snelscroll-greep zit nu ook op een deel-link',
    ],
    better: [
      'De greep zegt naast de datum ook in welke plaats je zit',
    ],
    fixed: [
      'Een deel-link tekent de gereden route, in plaats van een rechte lijn over elk gat heen',
      'De dagen-pil en de mensen-pil klappen elkaar dicht, en gaan dicht zodra je scrollt',
      'De foto in de viewer springt niet meer van klein naar groot zodra de grote versie binnen is',
    ],
  },
  {
    title: "Foto's in hun eigen vorm",
    date: '2026-08-21',
    new: [
      'Een foto of video bewaren op je toestel, via het \u22ef menu in de viewer',
    ],
    better: [
      "Foto's staan in rijen op hun eigen vorm, niet meer bijgesneden tot vierkantjes",
      'Een gedeelde reis laadt een stuk sneller: de tijdlijn haalt kleine foto\u2019s op, alleen de viewer de grote',
      'De viewer in een deel-link is dezelfde als in de app, met knijpen en dubbeltikken om in te zoomen',
      "Video's in een deel-link spelen af",
      'Slepen en zoomen op de kaart loopt vloeiender',
      'Als cover en Openen in Immich zitten in een menu bovenin, op een vaste plek',
      'Meer foto en minder lege rand, in de app en op een deel-link',
    ],
    fixed: [
      'De foto die je aantikt staat er meteen, in plaats van eerst een grijs vlak',
      'Zwarte balken boven en onder een foto in de viewer',
      "Het gekleurde bolletje staat er alleen nog als meerdere mensen foto's hebben",
      'Terugscrollen naar boven brengt de hele reis weer in beeld',
      'De snelscroll-greep hoort bij de tijdlijn, niet bij de routeplanner',
      'De plaatsnaam in de viewer knippert niet meer bij elke foto uit dezelfde stad',
      'Een deel-link laat de nieuwste versie van de pagina zien, in plaats van een oude uit de cache van je browser',
    ],
  },
  {
    title: 'Zoeken, reisboek en de kaart offline',
    date: '2026-08-20',
    new: [
      "Zoeken over al je reizen: plaatsen, notities, mensen en foto's, in \u00e9\u00e9n balk",
      'Een reisboek van je hele reis als pdf, met een pagina per dag',
      'De kaart van een reis bewaren op je toestel, voor onderweg zonder bereik',
      'E\u00e9n dag uit de reis op de kaart, met een lichtje dat die dag afloopt',
      'Stops die de app zelf voorstelt, uit je eigen route',
      'Een gpx- of tracktbestand toevoegen aan een reis, en weer meenemen',
      "Foto's zonder gps krijgen hun plek uit je route, en die plek gaat terug naar Immich",
    ],
    better: [
      'Een greep aan de rand om snel door een lange reis te scrollen',
      'De melding dat er geen verbinding is kun je wegklikken',
    ],
  },
  {
    title: 'Delen, posters en een tweede vormgeving',
    date: '2026-08-10',
    new: [
      'Een deel-link met een eigen pagina, met wachtwoord als je dat wilt',
      'Een poster van je reis, klaar om te versturen',
      'Een tweede vormgeving in de stijl van Material, die de kleur van je achtergrond overneemt',
    ],
    better: [
      'Instellingen opgedeeld in panelen per onderwerp',
      'Delen gaat via het deelmenu van je telefoon zelf',
    ],
  },
  {
    title: 'Vluchten, gasten en meldingen',
    date: '2026-08-02',
    new: [
      'Toegang vragen tot een reis, en er bericht over terugkrijgen',
      'Iemand als gast toevoegen: die kijkt mee, de reis blijft van jou',
      'Meldingen op je telefoon',
      'Lang indrukken op de kaart vraagt wat je bedoelde',
    ],
    better: [
      'Vluchten als een boog door de lucht, op de kaart en op de globe',
      'E\u00e9n stip per stad, in plaats van een stip naast elke vlag',
    ],
  },
  {
    title: 'Rondleiding en kaart',
    date: '2026-08-01',
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
