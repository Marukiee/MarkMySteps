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
    title: 'De trein',
    date: '2026-08-26',
    highlight: true,
    new: [
      'Treinroute tekenen: zeg van welk station naar welk station je ging, en de kaart tekent het spoor ertussen, vast aan je route ervoor en erna',
      'Een treinleg in de routeplanner heeft een knop \u201cSpoor tekenen\u201d',
      'De stations vullen zichzelf in als je vanuit een treinleg tekent, en hoofdstations staan bovenaan met een label erbij',
    ],
    better: [
      'Houd je een treinleg ingedrukt, dan is \u201cTreinroute tekenen\u201d meteen de voorgestelde keuze in plaats van de route over de weg',
      'De stationvelden zien eruit als de andere invulvelden, en de suggesties hangen erover heen in plaats van de rest naar beneden te duwen',
    ],
    fixed: [
      'Een gestippelde boog komt er alleen nog als er in de route ook echt een vlucht staat; een lang stuk zonder signaal, zoals een sneltrein of een tunnel, blijft een gewone lijn over de grond',
      'Een stuk route zonder signaal is een gewone doorgetrokken lijn; gestippeld is alleen nog wat nog moet komen',
      '\u00c9\u00e9n losse gps-fix midden in een treinreis liet de helft van die reis als rechte lijn staan; het hele stuk tussen de twee stations wordt nu getekend',
    ],
  },
  {
    title: 'De kaart, en wat erop staat',
    date: '2026-08-24',
    new: [
      'Een knop op de kaart van een deel-link zet de kaart terug op de hele reis',
      'De kaart in een deel-link beweegt op mobiel met twee vingers, zodat je met \u00e9\u00e9n vinger langs de kaart kunt scrollen',
      'Kaartinstellingen: kies wiens route je op de kaart ziet, en wiens foto\u2019s, of helemaal geen foto\u2019s',
      'De kaartstijl staat nu ook in de kaartinstellingen zelf, met dezelfde voorbeeldjes als in Instellingen, en de kaart wisselt meteen mee',
      'Een knop rechtsonderin de kaart zet de kaart terug op jouw locatie; groen zodra er een echte fix binnen is, grijs zolang die er nog niet is',
      'Een foto in de viewer instellen als omslag van een stop, via het \u22ef menu (alleen de reisorganisator)',
      'De stop-tegels dragen nu een foto van die plek',
      'Een deel-link zegt het als er nieuwe foto\u2019s bij staan sinds je vorige bezoek, met een knop ernaartoe',
      'Een knop terug naar boven op een deel-link',
      'Een wachtscherm met kompas als het opstarten lang duurt',
    ],
    better: [
      'Het wachtscherm bij het opstarten komt later, zodat het niet even opflitst bij een start die toch al klaar was',
      'De stop-tegels staan verder naar links dan de foto\u2019s eronder, zodat de rij niet als nog een rij tijdlijn leest',
      'In de viewer op een telefoon houdt een staande foto afstand tot de datum en plaats bovenin',
      'Boven de stop-tegels staat nu \u201cPlaatsen\u201d, zodat de rij zich uitlegt',
      'De previews van de kaartstijl in de kaartinstellingen zijn hoger, zodat je de vier uit elkaar houdt',
      'De knop terug naar boven en de snelscroll-greep komen pas als de kaart helemaal is ingeklapt, en gaan weg zodra je zover terug scrollt dat hij weer uitklapt, zodat ze niet met de kaart mee bewegen',
      'De knop terug naar boven staat niet meer in de routeplanner, waar hij alleen maar voor de knoppen stond',
      'De kaart van een deel-link tekent nu hetzelfde als die in de app: de gereden route, de vluchten als bogen, en de geplande stops gestippeld',
      'Routes en foto\u2019s die je in de kaartinstellingen aan- of uitzet komen op en gaan weg, in plaats van er ineens wel of niet te staan',
      'De stop-tegels zijn breder en de vlag ervoor is weg, zodat de naam van de plaats er nu op past',
      'Een stop-tegel draagt een foto die daar ook echt genomen is, niet zomaar de eerste van die dag: op een reisdag was dat vaak nog de stop die je die ochtend verliet',
      'Een dagtrip staat weer tussen de stop-tegels, maar alleen als je er ook echt gefotografeerd hebt',
      'De LIVE-pil boven de kaart is weg; wat je ermee deed zit nu in de knop rechtsonderin',
      'De kaart zegt niet langer \u201cImagery\u201d in de hoek; de bronvermelding zit achter het kleine i-knopje',
      'Reizen laden onder hun eigen kopjes: \u201cAankomend & onderweg\u201d en de tabs staan er meteen, zodat de pagina niet meer naar beneden springt zodra de reizen binnen zijn',
      'De reisinstellingen houden de plek van de coverfoto vrij terwijl die laadt',
      'Op een deel-link zie je de route van de reisorganisator, niet die van alle reisgenoten door elkaar',
      'Het krimpen van de kaart tijdens het scrollen loopt vloeiend, en de snelscroll-greep loopt netjes mee',
      "Reizen en deel-links laten alvast zien hoeveel er komen, in plaats van een lege pagina",
      'De mensen & delen-kaart kun je naar beneden vegen om te sluiten',
      'Menu\u2019s sluiten zoals ze opengaan, in plaats van zomaar te verdwijnen',
    ],
    fixed: [
      'Een tegel van een dagtrip brengt je naar de eerste foto die je daar maakte, niet naar de bovenkant van die dag: twee dagtrips op \u00e9\u00e9n datum kwamen allebei op dezelfde plek uit',
      'Bewerk je een foto opnieuw in Immich en verwijder je het origineel, dan verhuist de omslag mee naar de nieuwe versie in plaats van leeg te blijven',
      'Een omslagfoto die je in Immich verwijdert wordt vervangen: de reis en de stop kiezen zelf weer een foto, in plaats van een wit vlak te laten staan',
      'De knop \u201cBekijken\u201d bij de melding over nieuwe foto\u2019s op een deel-link springt nu ook echt naar die dag',
      'De eerste stop-tegel houdt zijn marge links; de rij schoof die zelf weg',
      'De pijl van de knop terug naar boven heeft hetzelfde grijs als de snelscroll-greep, in plaats van fel wit in donkere modus',
      'Het datumballonnetje van de snelscroll-greep is donker in donkere modus, in plaats van een wit vlak',
      'De terugveeg vanuit \u201cWat is er nieuw\u201d brengt je terug bij Over, niet naar het beginscherm',
      'De knop terug naar boven staat niet meer voor de kaartinstellingen',
      'Terug naar boven zet de kaart terug op zijn beginpositie in plaats van een stuk verder uit te zoomen',
      'Als omslag voor een stop wordt de stop genomen waar de foto ook echt genomen is, niet de stop waar je die dag toevallig aankwam',
      'Een sheet wegvegen laat hem nu vallen vanaf waar je hem loslaat, in plaats van eerst terug omhoog te springen',
      'De knoppen rechtsboven op de kaart blijven staan als je scrollt',
      'De pijltjes in de viewer zoomen niet meer in als je er snel op tikt',
      'Inzoomen op een foto is net zo soepel als uitzoomen',
      'De eerste stop-tegel staat niet meer tegen de rand van het scherm',
      'E\u00e9n speld per plaats op de kaart, ook als je er drie keer bent geweest',
    ],
  },
  {
    title: 'Sneller door een lange reis',
    date: '2026-08-23',
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
