# Roadmap

Wensen die nog gebouwd moeten worden. Een punt gaat er pas af als het op
echte toestellen gezien is.

## Native apps: feedback van Mark (stap voor stap)

Elke opmerking van Mark komt hier als punt. [x] = gebouwd en op de Oppo
gezet, Mark kijkt nog; een punt gaat er pas helemaal af na zijn akkoord.
De iPhone-kolom zegt of het ook in de iOS-app zit.

### Open

- [ ] ⋯ menu: de ronde hoeken van de regels lopen nog niet gelijk met de hoek
      van het menu (gemeten: 21 dp in plaats van 24, nu als echte afgeronde
      rechthoek getekend). iPhone: nee
- [ ] ⋯ menu: bij het dichtgaan springt de kleur van het rondje in een keer
      terug naar het doorzichtige glas; nu een overvloei. iPhone: nee
- [ ] ⋯ menu op de kleine reiskaart: daar kwam een rondje terug dat er niet
      hoort (de knop heeft geen vlak). iPhone: nee
- [ ] Reizigers: geen grijze blokjes als plek voor de cijfers, leeg laten tot
      de cijfers met hun animatie komen. iPhone: nee
- [ ] iPhone: alle Android-wijzigingen van 22 november overzetten (lijst
      hieronder, kolom iPhone: nee).
- [ ] Release (merge naar main) pas na Marks akkoord, met fotoboek en
      samenvatting erbij.

### Gebouwd, wacht op Marks akkoord

- [x] Auto/Large/Small in het reismenu: gelijke ruimte boven en onder. iPhone: nee
- [x] Fotomap: groepen voegen soepel samen en vallen uit elkaar bij in- en
      uitzoomen (zoals Hiero). Goedgekeurd. iPhone: nee
- [x] Fotogroep op de kaart openen: viewer met fotostrip onderin, huidige foto
      in het midden, tikjes bij wisselen, terugveeg sluit rustig. iPhone: nee
- [x] Fotostrip ook in de gewone viewer, stopt altijd op een foto. iPhone: nee
- [x] Panels openen met de beweging van PixelPlayers Connect device.
      Goedgekeurd. iPhone: nee
- [x] Routeplanner: nachtenknop als verbonden Material-knoppen, lijn gaat mee
      bij slepen, vervoerspil klapt uit (ook naar boven, en klapt in bij
      scrollen). iPhone: nee
- [x] Reispagina: cijfers met lege plek tijdens laden, kaart zoomt verder in
      op de reis, plaatsen springen naar de juiste stad, plaatsen-tegels
      kleiner zonder vervaging, scrollpositie blijft bij terug. iPhone: nee
- [x] Madrid knipperde: valt nu terug op de volgende foto die wel laadt. iPhone: nee
- [x] Foto's een keer laden: bewaarde foto's eerst van de telefoon. iPhone: nee
- [x] View requests opent de instellingen; updatekaart in de
      ontwikkelaarsinstellingen werkt en staat hoger. iPhone: nee
- [x] Inlogscherm opnieuw ontworpen (geen wereldbol, korter, demo-link weg).
      iPhone: nee
- [x] Onboarding: licht/donker kiezen werkt, Skip en Get started springen niet.
      iPhone: nee
- [x] Kaartinstellingen: alles aan/uit kan terug naar de eerdere keuze. iPhone: nee
- [x] Dag op de kaart: nieuw ontwerp, datum niet dubbel, ronde hoeken gelijk
      met het panel, kleuren beter te onderscheiden. iPhone: nee
- [x] Groot/klein wisselen op de homepage: rustiger veer. iPhone: nee
- [x] Reisinstellingen: kop zoals de omslag van de reispagina, zonder gezichten.
      iPhone: nee
- [x] ⋯ menu groeit uit zijn knop, donker in de viewer, gelijke randen van 11 px.
      iPhone: nee
- [x] Viewer: hartje opent en sluit, tikken op de foto reageert meteen, geen
      hapering bij vegen. iPhone: nee

## Open lijst voor een grote ronde

- [ ] **Website markmysteps.nl**: een showcase in de stijl van de app, gehost
      op Bunny. Plan in [WEBSITE.md](WEBSITE.md).

## Website markmysteps.nl

Gevraagd op 27 oktober 2026. Niet de webversie van de app, maar een echte
showcase met screenshots, in dezelfde kleuren, letters en iconen. Mark heeft
het domein markmysteps.nl. Hosting op Bunny (Storage plus Pull Zone, Bunny
DNS), bouw met Astro in `apps/site`. Begint met de beslissingen onderaan
WEBSITE.md.
