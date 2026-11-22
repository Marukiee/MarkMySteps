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

## Navigatie en gebaren

- Terugveeggebaar precies zoals Tandem en PixelPlayer: één seekbare shared-axis-overgang (350 ms, emphasized), de pagina gaat mee met je vinger en de vorige schuift er al onder in; loslaten speelt verder, terugtrekken springt terug. Vloeiend op elk toestel (release-build, geen debug). (klaar Android)
- Van Instellingen of Reizigers terug naar Reizen: de homepage begint weer bovenaan. Terug uit een reis: hij blijft staan waar je was. (klaar Android)
- Navigatiebalk: de open tab moet goed te zien zijn (oranje "Reizen" op beige was te zwak). (klaar)
- Instellingen opgedeeld in categorieën die elk een eigen pagina openen, zoals PixelPlayer; kleuren en letters zoals ze waren. (klaar)

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

## Reispagina

- Echte kaart met namen en grenzen (MapLibre met dezelfde OpenFreeMap-stijl als de web). (klaar Android)
- Route in losse stukken, nooit een rechte lijn waar gevlogen is; sprongen boven 400 km knippen zoals de web. Vluchten als gestippelde boog. (klaar Android)
- Omslagfoto bovenaan met titel en datums, en de cijfers als verbonden blok eronder in de toon van de foto. (klaar Android)
- Terug- en menuknop dicht, niet halfdoorzichtig, zonder schaduw. (klaar Android)
- Tabs Tijdlijn en Routeplanner (niet Foto's). (klaar)
- Tijdlijn zoals de oude versie: plaatsen bovenaan, dan per dag alle foto's onder elkaar. (klaar)
- "Plaatsen" bovenaan alleen als een reis meer dan één plaats heeft. (klaar)
- Nachtenpil rechtsboven in de stopkaart, even ver van boven als van rechts. (klaar)
- Fotoboek en samenvatting in het ⋯-menu, niet als losse knop op de pagina. (doorgegeven aan de fotoboek-sessie)

## Routeplanner

- Nachten tellen goed: een reis van 19 dagen heeft 18 nachten. (klaar Android)
- Het ringetje voor "x/y nachten gepland" heeft een duidelijke opening, zodat het niet als een fout lijkt. (klaar Android)
- Datums over een maandgrens kloppen ("30 aug t/m 2 sep"). (klaar Android)

## Fotoviewer

- Opnieuw ontworpen met reacties (hartje, vasthouden voor vijf emoji's) en opmerkingen in een sheet. (klaar Android)
- Een foto groeit vanuit zijn plek in de tijdlijn tot schermvullend; naar beneden vegen laat hem krimpen en terugvliegen naar zijn plek, zoals in Keeper. Zijn plek is zolang leeg. (klaar Android)
- Tijdens het wegslepen worden de hoeken geleidelijk rond, tot de ronding van de tegel. (klaar Android)
- HDR-foto's (Oppo Find X9 Ultra) in HDR: het origineel laden, scherm alleen in HDR-stand zolang zo'n foto open is. (klaar Android, iOS bezig, web kan niet in de WebView)

## Reizigers

- Echte statistieken, landen en reisgenoten van de server met profielfoto's. (klaar Android)
- Labels: reizen, landen, kilometer, dagen op reis, foto's, vluchten. (klaar Android)

## Werkwijze

- Een controle-agent kijkt elke ronde na op contrast, uitlijning, verspringen, iconen, afkappen, scrollrijen tot de rand, laadmomenten en toetsenbord.
- Een detail-agent zet alle micro-interacties van de web op een lijst (`details-todo.md` in de scratchpad); die gaan vanzelf mee zonder dat Mark erom vraagt.
- Nieuwe ontwerpen eerst als screenshot laten zien.
