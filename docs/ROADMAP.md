# Roadmap

Wensen die nog gebouwd moeten worden. Een punt gaat er pas af als het op
echte toestellen gezien is.

## Native apps: feedback van Mark (stap voor stap)

Elke opmerking van Mark komt hier als punt. [x] = gebouwd en op de Oppo
gezet, Mark kijkt nog; een punt gaat er pas helemaal af na zijn akkoord.
De iPhone-kolom zegt of het ook in de iOS-app zit.

### Open

- [ ] iPhone: overgezet en gebouwd (twee delen samengevoegd); nog zelf
      nalopen op de simulator. Nog open op iPhone: lijn in het gat bij slepen,
      dagpil die een pin kan bedekken (Mark beslist), routes per
      reiziger.
- [ ] iPhone: alle animaties nalopen, gelijk aan Android en mooi (in het
      werk, twee delen: reispagina/kaart/viewer en de rest).
- [ ] Webversie van de app: nieuw ontwerp gebouwd en samengevoegd (menu's,
      panelen, homepage, navigatiebalk, planner, inloggen, reizigers,
      reisinstellingen, reispagina, fotokaart, viewer met strip). Bouwt;
      nog visueel nalopen in de browser (kon niet: het venster was dicht).
- [ ] Stijlgids voor andere Android-apps in deze stijl (PixelPlayer en
      MarkMySteps): docs/STIJLGIDS.md, bijhouden bij elke nieuwe opmerking.
- [ ] Kwaliteitsronde: een kwaliteitsagent loopt de iPhone- en Android-app
      langs en legt alle punten aan Mark voor, met screenshots en een
      voorgestelde oplossing per punt.
- [ ] Release op 23 november (Mark gaf toestemming): alles als nieuwe
      release en update, met fotoboek en samenvatting erbij.
- [ ] Kwaliteitsrapport, Marks keuzes (23 nov):
      - [x] 4 overal "Cover" (Android, iPhone, web)
      - [x] 6 rond potlood naast de dagkop voor verhaal schrijven (iPhone nu ook)
      - [x] 11 rijen beter laden: een ophaalactie per foto, zichtbare tegels eerst
      - [x] 12 gezichten: reisgenoten inclusief jij, eigenaar eerst, geen gasten;
            zelfde kleur per persoon op Android, iPhone en web
      - [x] 13 iPhone-menu: grootte als gewone menuregels met vinkje
      - [x] 14 maand voluit in de rij, titel hooguit 2 regels met beletselteken
      - [ ] 3 iPhone: "Foto's van dit toestel" hoeft nog niet; offline kaart en
            tracking in reisinstellingen nog bekijken
      - [x] 15 kleurovergangen naar dezelfde kleur met alpha 0 (Android)
      - [x] 16 kaartstijlnamen per taal (Licht & minimaal / Light & minimal);
            iPhone-paneel als Android: Kaartinstellingen, foto's, dan Kaartstijl.
            Routes op de kaart op de iPhone hangt aan routes per reiziger (open)
      - [x] 17 "Geldt voor alle kaarten op dit apparaat." weg (Android, web)
      - [x] 19 "Organisator" overal (iPhone zei Eigenaar)
      - [x] 21 gekleurde cijfertegels bij Reizigers: iPhone en web, Androids tonen
      - [x] 22 landen-chips: Mark koos B, dieper beige (Android, iPhone had het al, web)
      - [x] 23 iPhone-startscherm beige (donker #14181D) met oranje kompas
      - Blijven zo: 2 (regel "Deze reis is afgelopen"), 7, 9, 10, 18, 20
- [x] Reispagina: cijfers rollen niet meer bij openen; wat de pagina in de
      eerste 4 seconden te weten komt staat er gewoon (Android en iPhone).
- [x] Plaatsen (stop-tegels): op locatie, niet op datum (Android en iPhone);
      plekken met minstens 4 foto's ver van elke stop worden een eigen plaats,
      met de naam van Photon. Laadt de eerste foto niet, dan de volgende. Lange
      namen breken af met een streepje (Saltsjöba-den), ook op iPhone en web. Gränna (tussenstop) heeft geen foto, Stockholm ontbreekt
      helemaal terwijl je er was en fotografeerde.
- [x] Fotostrip in de viewer stopt altijd op een foto (het terugglijden
      annuleerde zichzelf).
- [x] ⋯-menu dat naar boven uitklapt: onderkant op de knop, groeit vanuit de
      knop (begon in de bovenhoek van het menu).
- [x] Routeplanner slepen (op emulator gemeten en opgenomen): bovenste twee
      wisselen zonder terugflip, een gelijkmatige lijn van heen tot terug. Was: de
      lijn tussen de stops is soms doorzichtig en soms vol: tijdens slepen
      doorzichtig, en een doorlopende lijn van heenreis tot terugreis die niet
      afgekapt wordt als je de bovenste versleept.

### Gebouwd, wacht op Marks akkoord

- [x] iPhone: ⋯ op de reiskaart 40 pt (was veel te groot), 14 pt van de rand.
- [x] iPhone: cijfers van een reis onthouden en meteen goed bij openen.
- [x] Navigatiebalk: een vaste animatie (geen veer meer die snelheid meenam
      naar de volgende tik), oranje vervaagt zonder bruin, geen grijze ripple.
      iPhone: nee
- [x] Reis openen: de cijfers (stops, foto's) die de pagina vorige keer telde
      staan meteen goed (de lijst telde dagtrips mee: 8 werd 5); verandert er
      later iets, dan rolt het getal na een moment naar de nieuwe waarde.
      iPhone: nee
- [x] Homepage-globe: de naam en de stip van een reis staan waar de reis
      begint, niet op Schiphol waar de GPS al aanstond; alle thuisvliegvelden
      tellen als thuis. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Routeplanner slepen: alleen de stop gaat mee (het lijntje erboven
      blijft), bovenste stop kan omlaag, buren schuiven mooi opzij, geen
      heen-en-weer springen. iPhone: nee
- [x] Vervoerspil: ook een tikje bij het inklappen. iPhone: nee
- [x] ⋯ menu: de ronde hoeken van de regels lopen nog niet gelijk met de hoek
      van het menu (gemeten: 21 dp in plaats van 24, nu als echte afgeronde
      rechthoek getekend). iPhone: nee
- [x] ⋯ menu: bij het dichtgaan springt de kleur van het rondje in een keer
      terug naar het doorzichtige glas; nu een overvloei. iPhone: nee
- [x] ⋯ menu op de kleine reiskaart: daar kwam een rondje terug dat er niet
      hoort (de knop heeft geen vlak). iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Reizigers: geen grijze blokjes als plek voor de cijfers, leeg laten tot
      de cijfers met hun animatie komen. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Auto/Large/Small in het reismenu: gelijke ruimte boven en onder. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Fotomap: groepen voegen soepel samen en vallen uit elkaar bij in- en
      uitzoomen (zoals Hiero). Goedgekeurd. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Fotogroep op de kaart openen: viewer met fotostrip onderin, huidige foto
      in het midden, tikjes bij wisselen, terugveeg sluit rustig. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Fotostrip ook in de gewone viewer, stopt altijd op een foto. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Panels openen met de beweging van PixelPlayers Connect device.
      Goedgekeurd. iPhone: nee
- [x] Routeplanner: nachtenknop als verbonden Material-knoppen, lijn gaat mee
      bij slepen, vervoerspil klapt uit (ook naar boven, en klapt in bij
      scrollen). iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Reispagina: cijfers met lege plek tijdens laden, kaart zoomt verder in
      op de reis, plaatsen springen naar de juiste stad, plaatsen-tegels
      kleiner zonder vervaging, scrollpositie blijft bij terug. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Madrid knipperde: valt nu terug op de volgende foto die wel laadt. Mark: knippert niet meer (akkoord). iPhone: nee
- [x] Foto's een keer laden: bewaarde foto's eerst van de telefoon. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] View requests opent de instellingen; updatekaart in de
      ontwikkelaarsinstellingen werkt en staat hoger. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Inlogscherm opnieuw ontworpen (geen wereldbol, korter, demo-link weg).
      iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Onboarding: licht/donker kiezen werkt, Skip en Get started springen niet.
      iPhone: nee
- [x] Kaartinstellingen: alles aan/uit kan terug naar de eerdere keuze. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Dag op de kaart: nieuw ontwerp, datum niet dubbel, ronde hoeken gelijk
      met het panel, kleuren beter te onderscheiden. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Groot/klein wisselen op de homepage: rustiger veer. iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] Reisinstellingen: kop zoals de omslag van de reispagina, zonder gezichten.
      iPhone: ja (gebouwd, nog niet door Mark gezien)
- [x] ⋯ menu groeit uit zijn knop, donker in de viewer, gelijke randen van 11 px.
      iPhone: nee
- [x] Viewer: hartje opent en sluit, tikken op de foto reageert meteen, geen
      hapering bij vegen. iPhone: ja (gebouwd, nog niet door Mark gezien)

## Open lijst voor een grote ronde

- [ ] **Website markmysteps.nl**: een showcase in de stijl van de app, gehost
      op Bunny. Plan in [WEBSITE.md](WEBSITE.md).

## Website markmysteps.nl

Gevraagd op 27 oktober 2026. Niet de webversie van de app, maar een echte
showcase met screenshots, in dezelfde kleuren, letters en iconen. Mark heeft
het domein markmysteps.nl. Hosting op Bunny (Storage plus Pull Zone, Bunny
DNS), bouw met Astro in `apps/site`. Begint met de beslissingen onderaan
WEBSITE.md.
