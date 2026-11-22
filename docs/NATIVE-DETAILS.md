# Kleine aanpassingen van Mark (native apps)

Alle micro-aanpassingen die Mark vroeg voor de native versies (Android in Compose, iOS in SwiftUI) en de webversie, zodat ze nooit meer
terugvallen. Lees dit voor je iets aan een scherm verandert, en zet elk nieuw punt er meteen bij. Een punt geldt op elk platform tenzij er
anders staat. Status: **klaar** (Android, iOS of web erbij als het niet overal zo is), **open**.

## Algemeen ontwerp

- Material 3 Expressive op Android, Apple's eigen stijl met echt Liquid Glass op iOS. Niet exact de webversie kopiëren: opnieuw ontwerpen mag. (klaar)
- Outfit blijft de merkletter (koppen, titels, grote getallen), Inter voor tekst, Fraunces voor de dagkoppen in de tijdlijn. (klaar)
- Het logo is het kompas los, zonder vorm of rondje eromheen, in de accentkleur. (klaar)
- **Geen schaduwen**: vlakken scheiden met tonale kleur. Enige uitzondering: de zwevende navigatiebalk (lichte balk met zachte schaduw). Een oranje balk zonder schaduw vond Mark lelijk. (klaar Android)
- Alles moet goed te onderscheiden zijn van wat eronder ligt, licht en donker: geen wit op lichtbeige, geen halfdoorzichtige knoppen op de kaart. (klaar Android)
- Donkere stand is gewoon donker (#14181D zoals de web), geen OLED-zwart. (klaar)
- Iconen staan echt in het midden van hun vak (het potlood stond scheef). (klaar)
- Pijltjes en andere tekens zijn getekende iconen, nooit een letterteken uit een font (de "→" bij BUS → AMS was lelijk). (klaar)
- Iconen bij de statistieken los op de tegel, niet in een rondje of vormpje. (klaar Android, iOS doorgegeven)
- Scrollbare rijen lopen tot de rand van het scherm; het eerste item staat wel op de lijn van de rest. (klaar Android)
- Laadvormen hebben de maat van wat erin komt en gaan soepel over in de inhoud; niets verspringt. (klaar Android, iOS bezig)
- Laadicoon in een knop blijft klein en de knop houdt zijn maat (iOS Inloggen werd ineens heel groot). (iOS doorgegeven)
- Het toetsenbord bedekt nooit het veld waarin je typt; de pagina schuift mee. (klaar Android, iOS doorgegeven)
- Ingelogd nooit voorbeelddata tonen, ook niet even bij het opstarten (de blauwe Georgië-kaart die naar rood sprong). De app opent op de laatst geladen reizen. (klaar Android, iOS bezig)
- Geen "0 km" tonen; een reis zonder gemeten afstand laat de afstand weg. (klaar)
- "kilometer" voluit waar het past. (klaar)
- Geen nep-meldingsstipje of verzonnen waarden in Instellingen als je bent ingelogd. (klaar Android)
- Vlaggen zijn vlakke vlaggen (de SVG-set van de web, 4:3) met licht afgeronde hoeken, niet de golvende emoji-vlaggen. (klaar Android, iOS doorgegeven)
- Elke wissel van inhoud heeft een passende animatie, zoals Afgelopen reizen en Gedeeld die zijwaarts schuiven. (klaar Android)
- Een reis zonder foto toont zijn eigen kleur met het kompas, en dat kompas schaalt mee met de kaart. (klaar Android)

- Geen knoppen die niets doen: elk pijltje, elke ⋯ en elke knop doet iets echts, anders is het geen knop. (klaar Android)
- Uitloggen vraagt eerst om bevestiging. (klaar Android)
- Geen schakelaars of waarden die niets doen of verzonnen zijn; wat er (nog) niet is, staat er niet. (klaar Android)
- Cijfers wachten in hun eigen vorm tot de server antwoordt, nooit eerst verkeerde getallen of een 0. (klaar Android)
- Achter de klok komt een achtergrond zodra een pagina eronder scrolt, behalve op de homepage: daar loopt alles schermvullend onder de klok door, zonder witte band. (klaar Android)
- Lange tekst wordt netjes afgekapt met een beletselteken, nooit midden in een regel afgesneden. (klaar Android)
- Eén ⋯-menu voor de hele app: het segmented menu van Material 3 Expressive (afgeronde groepen, geen schaduw, gekozen optie met vinkje in de warme accentkleur). Ook bij Mensen. (klaar Android)
- Keuzes van één soort staan naast elkaar als verbonden knoppen, de gekozen wordt een pil; zelfde achtergrondkleur als de andere menuregels. (klaar Android)
- Haptische feedback op knoppen, tabs en schakelaars, zoals Tandem en PixelPlayer. (klaar Android)
- Eén sheet-gedrag voor de hele app: het terugveeggebaar schuift de sheet met je vinger mee naar beneden tot hij bijna weg is, niet alleen kleiner. (klaar Android, deels: alle sheets na samenvoegen)
- Foto's en omslagen worden vooruit geladen, zodat je bij scrollen nooit lege vakjes ziet die pas invullen als je er al voorbij bent. (klaar Android voor de homepage, bezig voor plaatsen en tijdlijn)
- Een test schrijft nooit naar de echte server: de app heeft een testmodus (dryRun) die elke wijziging tegenhoudt. (klaar)
- Elk land heeft een vlag (de volledige flag-icons-set, ook Malta); nooit een leeg vlaggenvakje. (klaar)
- Alles in het Nederlands, ook de kalender van Nieuwe reis, met maandag als eerste dag. (klaar)
- Sheets gaan in één keer helemaal open, zodat één keer terug ze sluit. (klaar Android)
- Menu's zonder schaduw. (klaar Android)
- Rijen die de webversie openen tonen een "open buiten de app"-icoon, geen pijltje alsof het een eigen pagina is. (klaar Android)

## Navigatie en gebaren

- Terugveeggebaar precies zoals Tandem en PixelPlayer: één seekbare shared-axis-overgang (350 ms, emphasized), de pagina gaat mee met je vinger en de vorige schuift er al onder in; loslaten speelt verder, terugtrekken springt terug. Vloeiend op elk toestel (release-build, geen debug). (klaar Android)
- Van Instellingen of Reizigers terug naar Reizen: de homepage begint weer bovenaan. Terug uit een reis: hij blijft staan waar je was. (klaar Android)
- Navigatiebalk: de open tab moet goed te zien zijn (oranje "Reizen" op beige was te zwak). (klaar)
- Instellingen opgedeeld in categorieën die elk een eigen pagina openen, zoals PixelPlayer; kleuren en letters zoals ze waren. (klaar)
- Instellingen compleet zoals de vorige versie (Voorkeuren, Services, Data, Accounts en de rest), alles in de app zelf, geen doorstuurlinks naar de website. Account (profiel, wachtwoord, tweestaps) ook in de app, veilig. (bezig)
- De navigatiebalk komt pas terug als de pagina er echt is, niet al bij het begin van het terugveeggebaar. De pil groeit vanuit het midden. (klaar Android)
- Wissel je van tab, dan opent een pagina weer bovenaan (Reizigers met de meldingen zichtbaar; Instellingen op de hoofdlijst, niet op een subpagina). Terug van een reisgenoot houdt de lijst wel zijn plek. (klaar Android, iOS open)
- De profielfoto rechtsboven opent je account. (bezig)

## Homepage en wereldbol

- Statistieken niet boven of onder de wereldbol. (klaar)
- De knop Nieuwe reis naast de kop "Reizen", niet bij de navigatiebalk. (klaar)
- Wereldbol: precies de regels van de web voor bolletjes (alleen eindpunten en verre vluchtuiteinden, niet bij het thuisvliegveld, aankomende reis met witte ring en stippellijn). (klaar)
- Wereldbol: knijpen om te zoomen, draaien, automatische rondleiding naar reizen, tikken op een reis toont het naamkaartje. (klaar Android)
- Het kompas in het logo draait mee met het zoomen van de bol (zoals de web: (schaal min 1) keer 660 graden). (klaar Android)
- Kaart van de volgende reis: drie puntjes rechtsboven; geen voortgangsbalk. (klaar)
- Alle eigen aankomende en lopende reizen tonen, niet alleen de eerste; een lopende reis zegt "3e dag van 8", en "1 dag" enkelvoud. (klaar Android)
- Gedeeld = reizen waar je gast bent; reizen van vrienden horen niet bij Afgelopen. (klaar Android)
- Rijen met een dynamische achtergrondkleur uit de omslagfoto in plaats van een blur. (klaar Android)
- Gezichten: twee gezichten en dan "+n"; echte profielfoto's. (klaar Android)
- Grootte per reis via het ⋯-menu: Auto, Groot, Klein naast elkaar; standaard in Weergave. Wisselen animeert de kaart naar rij en terug. ⋯-menu op de homepage heeft alleen grootte, hernoemen en verwijderen. (klaar Android)
- Reis verwijderen vraagt eerst de naam te typen, zoals de web. (klaar Android)
- Meldingen als zwevend paneel uit de hoek van de bel, met een kruisje per melding, Toelaten/Afwijzen, Reis openen en Aanvragen bekijken. (klaar Android)
- Wereldbol en landen samen in één paneel op Reizigers. (klaar Android)
- iOS: geen aparte balk boven de wereldbol; de bol loopt onder de statusbalk door en het logo en de profielfoto zweven erop, net als op Android. (iOS doorgegeven)

## Reispagina

- Echte kaart met namen en grenzen (MapLibre met dezelfde OpenFreeMap-stijl als de web). (klaar Android)
- Route in losse stukken, nooit een rechte lijn waar gevlogen is; sprongen boven 400 km knippen zoals de web. Vluchten als gestippelde boog. (klaar Android)
- Omslagfoto bovenaan met titel en datums, en de cijfers als verbonden blok eronder in de toon van de foto. (klaar Android)
- Terug- en menuknop dicht, niet halfdoorzichtig, zonder schaduw. (klaar Android)
- Tabs Tijdlijn en Routeplanner (niet Foto's), die bij wisselen zijwaarts schuiven. (klaar)
- Tijdlijn zoals de oude versie: plaatsen bovenaan, dan per dag alle foto's onder elkaar. (klaar)
- "Plaatsen" bovenaan alleen als een reis meer dan één plaats heeft. (klaar)
- Nachtenpil rechtsboven in de stopkaart, even ver van boven als van rechts. (klaar)
- De cijfertegels zijn even breed (kilometer niet breder dan dagen, stops en foto's). (klaar Android)
- Bovenaan de reis eigen knoppen zoals in de web: Mensen en delen, kaartinstellingen (kaartstijl) en reisinstellingen; geen ⋯-menu. (klaar Android)
- Fotoboek en samenvatting horen in de sheet Mensen en delen, niet als losse knoppen op de pagina. (klaar Android, onder "Samenvatting en fotoboek")
- Kaart vergroten op één plek: een ronde knop rechtsonder op de kaart. (klaar Android, iOS doorgegeven)
- De drie knoppen bovenin aan elkaar als één verbonden groep; die van het open paneel wordt een oranje pil. (klaar Android)
- De kaart is te bewegen zonder dat de pagina meescrolt, met je foto's als rondjes erop (gegroepeerd per zoomniveau), plaatsnamen in het Nederlands. (klaar Android)
- Vluchten als grijze gestippelde boog met duidelijke streepjes en een grijs vliegveldbolletje aan het begin en eind; niet in de reiskleur. 3D-wereldbol zoals de web: wacht op MapLibre (zit nog alleen in testversies). (deels)
- Cijfers zoals de web: de eerste vier van afstand, dagen, stops (vanaf 2), foto's, reizigers (vanaf 2), landen. (klaar Android)
- Deellink: tik op de link kopieert hem; volledige adres met beletselteken, op de oude maat. (klaar Android)
- Deellinks zoals in de web maar in de nieuwe stijl: de link als oranje (onderstreepte) link, Kopieer, een instellingenknop (wachtwoord, intrekken) in plaats van drie puntjes, en daaronder "wachtwoord (optioneel)" met "+ Deellink". (klaar Android)

## Nieuwe reis

- Eigen kalender: maand in het midden met pijltjes, weekdagen klein in hoofdletters, slepen van begin- naar einddatum, daarna elk uiteinde verslepen, tikjes bij elke dag, de band netjes afgerond aan het begin en eind van een week. (klaar Android)

## Opstarten

- Opstartscherm: het oranje kompas in het midden op een rustige beige (of donkere) achtergrond, geen app-icoon; duurt het lang, dan gaat het kompas draaien. (open)

## Routeplanner

- Verplaatsen en toevoegen houden de heen- en terugreis aan de uiteinden: een nieuwe stop komt vóór de terugreis. (klaar)
- De knop naar boven gaat opzij tijdens typen en onderaan de pagina, zodat hij nooit over de zoekresultaten valt. (klaar Android)

- Nachten tellen goed: een reis van 19 dagen heeft 18 nachten. (klaar Android)
- Het ringetje voor "x/y nachten gepland" heeft een duidelijke opening, zodat het niet als een fout lijkt. (klaar Android)
- Datums over een maandgrens kloppen ("30 aug t/m 2 sep"). (klaar Android)
- Indeling zoals de oude: foto per stop met nummer, nachtenstepper, "+ Dagtrip", Heen/Terug met vliegvelden en duur, vervoer kiezen uit een uitklapmenu en vluchtgegevens invullen. (bezig)
- De vervoerpil groeit mee zonder dat het woord even afgekapt wordt. (bezig)
- Wegvegen met precies de physics en haptics van PixelPlayer. (bezig)

## Fotoviewer

- Opnieuw ontworpen met reacties (hartje, vasthouden voor vijf emoji's) en opmerkingen in een sheet. (klaar Android)
- Een foto groeit vanuit zijn plek in de tijdlijn tot schermvullend; naar beneden vegen laat hem krimpen en terugvliegen naar zijn plek, zoals in Keeper. Zijn plek is zolang leeg. (klaar Android)
- Tijdens het wegslepen worden de hoeken geleidelijk rond, tot de ronding van de tegel. (klaar Android)
- HDR-foto's (Oppo Find X9 Ultra) in HDR: het origineel laden, scherm alleen in HDR-stand zolang zo'n foto open is. (klaar Android, iOS bezig, web kan niet in de WebView)
- Geen laadanimatie bij openen: het kleine fotootje groeit altijd vanuit zijn tegel en is de plaatshouder tot de scherpe versie er is. (klaar Android)
- Foto's van oude reizen (zonder bekende maat) krijgen toch hun eigen verhouding in plaats van vierkanten; die wordt onthouden. (klaar Android)
- Naar beneden vegen werkt altijd, ook na bladeren; ingezoomd sleep je de foto in plaats van te sluiten. (klaar Android)

- Foto openen vanuit de tijdlijn: altijd de juiste foto, zonder flikkering. Speler met opties rechtsboven (omslag van reis of bestemming, downloaden, openen in), alle emoji-reacties met animatie, locatie onder de datum zonder flitsen, voortgangsbalk bij video. (bezig)

## Reisinstellingen

- Volledige pagina zoals de web, geen klein paneel. Kleur kiezen animeert. Rood loopt van zwak (wissen) naar sterkst (reis verwijderen). "Terug naar automatisch" bij het bolletje komt met een animatie. (bezig)

## Reizigers

- Echte statistieken, landen en reisgenoten van de server met profielfoto's. (klaar Android)
- Labels: reizen, landen, kilometer, dagen op reis, foto's, vluchten. (klaar Android)

## iOS

- Minder bouncy: veren rustiger, zoals Apple's eigen apps. (open)
- ⋯-menu goed leesbaar, geen lichtgrijze letters. (open)
- De tabbalk blijft altijd volledig staan, ook bij scrollen; nooit krimpen tot een rondje. (open)
- Geen Apple Kaarten-logo en "Juridische informatie" in beeld; minder lege ruimte tussen de blokken. (open)
- Na wisselen van tab opent Instellingen weer op de hoofdlijst, niet op de subpagina van daarnet. (open)
- Alles wat hierboven voor Android klaar is, ook op iOS in Apple's stijl. (open)

## Werkwijze

- Een controle-agent kijkt elke ronde na op contrast, uitlijning, verspringen, iconen, afkappen, scrollrijen tot de rand, laadmomenten en toetsenbord.
- Een detail-agent zet alle micro-interacties van de web op een lijst (`details-todo.md` in de scratchpad); die gaan vanzelf mee zonder dat Mark erom vraagt.
- Nieuwe ontwerpen eerst als screenshot laten zien.
