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
 *
 * One list per language, with the same entries in the same order. A new entry
 * goes at the top of both: in Dutch in `NL`, in English in `EN`. The app shows
 * the list for the language it speaks, and English for a language without one.
 */
import { getLang, Lang } from '../i18n';

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

/** Dutch. */
const NL: ChangeEntry[] = [
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
      'Een lijn ingedrukt houden geeft nu meteen een tikje en het menu komt direct; de optie om een getekend stuk te wissen valt erbij zodra de server antwoordt, in plaats van dat het hele menu erop wacht',
      'Houd je een treinleg ingedrukt, dan is \u201cTreinroute tekenen\u201d meteen de voorgestelde keuze in plaats van de route over de weg',
      'De stationvelden zien eruit als de andere invulvelden, en de suggesties hangen erover heen in plaats van de rest naar beneden te duwen',
      'Tik je een gevonden station aan om het te veranderen, dan staat de cursor er meteen in met de naam geselecteerd; je hoefde er eerst twee keer op te drukken',
    ],
    fixed: [
      'Een gestippelde boog komt er alleen nog als er in de route ook echt een vlucht staat; een lang stuk zonder signaal, zoals een sneltrein of een tunnel, blijft een gewone lijn over de grond',
      'Een stuk route zonder signaal is een gewone doorgetrokken lijn; gestippeld is alleen nog wat nog moet komen',
      '\u00c9\u00e9n losse gps-fix midden in een treinreis liet de helft van die reis als rechte lijn staan; het hele stuk tussen de twee stations wordt nu getekend, en die losse fix maakt plaats voor het spoor in plaats van er een piek in te trekken',
      'De knop \u201cRoute tekenen\u201d werkt ook als je de gevonden stations niet zelf uit de lijst hebt aangetikt',
      'Na het tekenen van een treinroute bleef soms een stuk van de oude rechte lijn staan; het hele stuk tussen de twee stations wordt nu vervangen',
      'De grijze tekst in de stationvelden zegt nu \u201cVertrekstation\u201d en \u201cAankomststation\u201d, in plaats van een voorbeeldstation dat eruitzag alsof het al ingevuld was',
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

/** English. */
const EN: ChangeEntry[] = [
  {
    title: 'The train',
    date: '2026-08-26',
    highlight: true,
    new: [
      'Draw a train route: say which station you left from and which you arrived at, and the map draws the rails in between, joined to your route before and after',
      'A train leg in the route planner has a “Draw the rails” button',
      'The stations fill themselves in when you draw from a train leg, and main stations are at the top with a label',
    ],
    better: [
      'Pressing and holding a line now gives a tick straight away and the menu comes at once; the option to erase a drawn part joins it as soon as the server answers, instead of the whole menu waiting for it',
      'Press and hold a train leg and “Draw train route” is the suggested choice, instead of the route by road',
      'The station fields look like the other fields, and the suggestions hang over the rest instead of pushing it down',
      'Tap a station you found to change it and the cursor is in it straight away with the name selected; it used to take two taps',
    ],
    fixed: [
      'A dotted arc only appears when the route really has a flight in it; a long stretch without signal, like a fast train or a tunnel, stays an ordinary line over the ground',
      'A stretch of route without signal is an ordinary solid line; dotted is only for what is still to come',
      'A single GPS fix in the middle of a train ride left half of that ride as a straight line; the whole stretch between the two stations is drawn now, and the lone fix makes way for the rails instead of pulling a spike into them',
      'The “Draw route” button also works when you did not tap the stations you found in the list yourself',
      'After drawing a train route, part of the old straight line sometimes stayed; the whole stretch between the two stations is replaced now',
      'The grey text in the station fields now says “Departure station” and “Arrival station”, instead of a sample station that looked as if it was already filled in',
    ],
  },
  {
    title: 'The map, and what is on it',
    date: '2026-08-24',
    new: [
      'A button on the map of a share link takes the map back to the whole trip',
      'On a phone, the map in a share link moves with two fingers, so you can scroll past it with one',
      'Map settings: choose whose route you see on the map, and whose photos, or no photos at all',
      'The map style is in the map settings too, with the same previews as in Settings, and the map changes along with it',
      'A button at the bottom right of the map takes it back to your location; green once a real fix is in, grey until then',
      'Set a photo in the viewer as the cover of a stop, from the ⋯ menu (trip organiser only)',
      'The stop tiles now carry a photo of that place',
      'A share link tells you when there are new photos since your last visit, with a button to go there',
      'A back to top button on a share link',
      'A waiting screen with a compass when starting up takes a while',
    ],
    better: [
      'The waiting screen at start-up comes later, so it does not flash by on a start that was already done',
      'The stop tiles sit further left than the photos below them, so the row does not read as another row of the timeline',
      'In the viewer on a phone, a portrait photo keeps its distance from the date and place at the top',
      'Above the stop tiles it now says “Places”, so the row explains itself',
      'The map style previews in the map settings are taller, so you can tell the four apart',
      'The back to top button and the fast scroll grip only appear once the map has fully folded away, and leave as soon as you scroll back far enough for it to unfold, so they do not move along with the map',
      'The back to top button is no longer in the route planner, where it only covered the buttons',
      'The map of a share link now draws the same as the one in the app: the route you travelled, flights as arcs, and the planned stops dotted',
      'Routes and photos you turn on or off in the map settings fade in and out, instead of suddenly being there or not',
      'The stop tiles are wider and the flag in front is gone, so the name of the place now fits',
      'A stop tile carries a photo that was really taken there, not just the first of that day: on a travel day that was often still the stop you left that morning',
      'A day trip is back among the stop tiles, but only if you really took photos there',
      'The LIVE pill above the map is gone; what it did is now in the button at the bottom right',
      'The map no longer says “Imagery” in the corner; the credits are behind the small i button',
      'Trips load under their own headings: “Upcoming & under way” and the tabs are there straight away, so the page no longer jumps down as soon as the trips arrive',
      'The trip settings keep the space for the cover photo free while it loads',
      'On a share link you see the route of the trip organiser, not those of all travel companions mixed together',
      'The map shrinks smoothly while scrolling, and the fast scroll grip keeps up neatly',
      'Trips and share links show how many are coming straight away, instead of an empty page',
      'You can swipe the people & sharing card down to close it',
      'Menus close the way they open, instead of simply disappearing',
    ],
    fixed: [
      'A day trip tile takes you to the first photo you took there, not to the top of that day: two day trips on one date both ended up in the same place',
      'If you edit a photo again in Immich and delete the original, the cover moves along to the new version instead of staying empty',
      'A cover photo you delete in Immich is replaced: the trip and the stop pick a photo again themselves, instead of leaving a white space',
      'The “View” button on the notice about new photos on a share link now really jumps to that day',
      'The first stop tile keeps its margin on the left; the row used to push it away',
      'The arrow of the back to top button has the same grey as the fast scroll grip, instead of bright white in dark mode',
      'The date bubble of the fast scroll grip is dark in dark mode, instead of a white block',
      'Swiping back from “What’s new” takes you back to About, not to the start screen',
      'The back to top button no longer covers the map settings',
      'Back to top puts the map back in its starting position instead of zooming out a lot further',
      'The cover of a stop is taken from the stop where the photo was really taken, not the stop you happened to arrive at that day',
      'Swiping a sheet away now drops it from where you let go, instead of first jumping back up',
      'The buttons at the top right of the map stay put when you scroll',
      'The arrows in the viewer no longer zoom in when you tap them quickly',
      'Zooming in on a photo is as smooth as zooming out',
      'The first stop tile no longer touches the edge of the screen',
      'One pin per place on the map, even if you have been there three times',
    ],
  },
  {
    title: 'Faster through a long trip',
    date: '2026-08-23',
    new: [
      'Pills above the timeline take you to a stop in one tap, in the app and in a share link',
      'The fast scroll grip is now on a share link too',
    ],
    better: ['Besides the date, the grip also says which place you are in'],
    fixed: [
      'A share link draws the route you travelled, instead of a straight line across every gap',
      'The days pill and the people pill close each other, and close as soon as you scroll',
      'The photo in the viewer no longer jumps from small to large as soon as the large version is in',
    ],
  },
  {
    title: 'Photos in their own shape',
    date: '2026-08-21',
    new: ['Save a photo or video to your device, from the ⋯ menu in the viewer'],
    better: [
      'Photos sit in rows in their own shape, no longer cropped to little squares',
      'A shared trip loads a lot faster: the timeline fetches small photos, only the viewer the large ones',
      'The viewer in a share link is the same as in the app, with pinch and double tap to zoom',
      'Videos in a share link play',
      'Dragging and zooming on the map runs more smoothly',
      'Set as cover and Open in Immich are in a menu at the top, in a fixed place',
      'More photo and less empty border, in the app and on a share link',
    ],
    fixed: [
      'The photo you tap is there straight away, instead of a grey block first',
      'Black bars above and below a photo in the viewer',
      'The coloured dot only shows when more than one person has photos',
      'Scrolling back to the top brings the whole trip into view again',
      'The fast scroll grip belongs to the timeline, not to the route planner',
      'The place name in the viewer no longer flickers for every photo from the same city',
      'A share link shows the newest version of the page, instead of an old one from your browser’s cache',
    ],
  },
  {
    title: 'Search, travel book and the map offline',
    date: '2026-08-20',
    new: [
      'Search across all your trips: places, notes, people and photos, in one bar',
      'A travel book of your whole trip as a PDF, with a page per day',
      'Keep the map of a trip on your device, for when you have no signal',
      'One day of the trip on the map, with a light that follows that day',
      'Stops the app suggests itself, from your own route',
      'Add a GPX or track file to a trip, and take it out again',
      'Photos without GPS get their place from your route, and that place goes back to Immich',
    ],
    better: [
      'A grip on the edge to scroll quickly through a long trip',
      'You can dismiss the notice that there is no connection',
    ],
  },
  {
    title: 'Sharing, posters and a second look',
    date: '2026-08-10',
    new: [
      'A share link with a page of its own, with a password if you want one',
      'A poster of your trip, ready to send',
      'A second look in the style of Material, which takes on the colour of your wallpaper',
    ],
    better: [
      'Settings split into panels per subject',
      'Sharing goes through your phone’s own share menu',
    ],
  },
  {
    title: 'Flights, guests and notifications',
    date: '2026-08-02',
    new: [
      'Ask for access to a trip, and hear back about it',
      'Add someone as a guest: they follow along, the trip stays yours',
      'Notifications on your phone',
      'A long press on the map asks what you meant',
    ],
    better: [
      'Flights as an arc through the sky, on the map and on the globe',
      'One dot per city, instead of a dot next to every flag',
    ],
  },
  {
    title: 'Tour and map',
    date: '2026-08-01',
    new: [
      'A new tour, with the app itself on screen',
      'This page: what’s new',
      'Add someone as a travel companion or as a guest, in one go',
    ],
    better: [
      'Dotted lines only where nothing was recorded',
      'Tracking stops by itself when your trip is over, and says so',
      'Photos lie on top of the stops on the map, not underneath',
      'Planned trips do not count towards your numbers',
    ],
    fixed: [
      'Share links gave away too much (closed after a security check)',
      'On the mobile site you could no longer reach the bottom of a page',
      'The buttons on a trip card hid behind your own photos',
    ],
  },
  {
    title: 'Photos from your device',
    date: '2026-07-30',
    new: ['Gallery photos with a trip, without uploading', 'An invitation with a photo from the trip'],
    better: ['Flights follow their own arc on the globe'],
  },
  {
    title: 'The globe follows your trip',
    date: '2026-07-29',
    new: ['A point of light runs along your route and stops at every place'],
    better: ['A little plane that flies the arc and lands', 'More detail as soon as you zoom in'],
  },
];

const LISTS: Partial<Record<Lang, ChangeEntry[]>> = { nl: NL, en: EN };

/** The list in the language the app speaks. */
export const CHANGELOG: ChangeEntry[] = LISTS[getLang()] ?? EN;
