# Plan: de website markmysteps.nl

Een echte showcase van MarkMySteps: laten zien wat de app is, hoe hij voelt en
waar je hem haalt. Niet de webversie van de app zelf, die blijft op de eigen
server. Gepland op 27 oktober 2026.

## Stand (28 oktober 2026)

Gebouwd in `apps/site`, lokaal te bekijken met
`pnpm --filter @markmysteps/site dev`:

- Voorpagina in het Nederlands (`/`) en Engels (`/en/`): opening met de
  draaiende wereldbol en een echte screenshot, zo werkt het, vier functies
  met screenshot plus zes als iconen, het donkere blok "van jou", toestellen,
  downloads en vragen.
- `/privacy` en `/en/privacy` (dezelfde tekst als in de app, plus een stuk over
  de website), `/hulp` en `/en/help`, en een 404.
- Kleuren uit `apps/web/src/styles/tokens.css`, die app en site nu allebei
  gebruiken; de iconen komen rechtstreeks uit `Icon.tsx` (er is een
  telefoon-icoon bijgekomen). Volgt licht en donker van het toestel.
- Deelplaatje `public/og.png`, gemaakt met `node scripts/og.mjs`.
- Deploy naar Bunny in `.github/workflows/site.yml`; die slaat zichzelf over
  tot de vier geheimen erin staan.

Nog te doen:

- **Bunny inrichten** (Mark): Storage Zone, Pull Zone met markmysteps.nl en
  www, Bunny DNS, en de vier geheimen in GitHub. Zie "Hoe het in elkaar zit".
- **Meer screenshots**: de poster-studio en de statistieken, en een Engelse
  set (de Engelse pagina toont nu de Nederlandse). De iPhone-simulator werd
  op 28 oktober ook door een Hiero-sessie gebruikt, dus dat kon toen niet.
  Bestanden horen in `apps/site/src/assets/shots/<taal>/<naam>.jpg`.
- **TestFlight-link**: zodra er een openbare link is, die op de iPhone-knop
  zetten in plaats van "vraag een uitnodiging".
- **App Store Connect**: privacy-adres naar markmysteps.nl/privacy en de
  support-URL naar markmysteps.nl/hulp.

## Kort advies

- **Domein:** markmysteps.nl (en www) voor de site. Later eventueel
  app.markmysteps.nl voor de gehoste versie uit docs/HOSTED.md.
- **Hosting: Bunny.** Een statische site op Bunny Storage met een Pull Zone
  ervoor. Europees bedrijf, geen cookies nodig, gratis certificaat, kost voor
  een site als deze rond de 1 euro per maand. Jullie gebruiken Bunny al, dus
  één rekening en één dashboard.
- **Bouw:** Astro in de monorepo als `apps/site`, met dezelfde kleuren,
  lettertypes en iconen als de app, rechtstreeks uit de app gehaald zodat ze
  nooit uit elkaar lopen.
- **Talen:** Nederlands op `/`, Engels op `/en/`, net als de app.

## Is Bunny een goede keuze?

Ja, voor een statische site is Bunny een prima keus:

| | Bunny | Cloudflare Pages | GitHub Pages |
|---|---|---|---|
| Kosten | ongeveer 1 euro per maand | gratis | gratis |
| Bedrijf | Europees (Slovenië) | Amerikaans | Amerikaans |
| Eigen domein met https | ja, gratis | ja | ja |
| Kale domeinnaam (zonder www) | ja, met Bunny DNS | ja, met Cloudflare DNS | lastig |
| Deploy | GitHub Action die uploadt | koppelt zelf aan GitHub | koppelt zelf aan GitHub |
| Statistieken zonder cookies | ja, uit de Pull Zone | ja | nee |

Cloudflare Pages is het enige echte alternatief: gratis en het koppelt
zichzelf aan GitHub. Maar Bunny wint hier op Europees, op wat jullie al
gebruiken, en op privacy, wat goed past bij het verhaal van de app ("je
data blijft van jou"). Het verschil in kosten is verwaarloosbaar.

### Hoe het in elkaar zit

1. **Storage Zone** `markmysteps-site` (regio Falkenstein, Duitsland) met
   de gebouwde bestanden.
2. **Pull Zone** ervoor, met markmysteps.nl en www.markmysteps.nl als eigen
   hostnamen en het gratis certificaat aan. Regel: www stuurt door naar de
   kale naam. Lange cache voor `/_astro/` (bestandsnamen met hash), korte voor
   de HTML.
3. **Bunny DNS** voor markmysteps.nl, zodat ook de kale naam naar de Pull Zone
   kan (de meeste registrars kunnen dat niet met een gewone CNAME). Daarvoor
   zet je bij de registrar de nameservers op die van Bunny.
4. **GitHub Action** die bij een push naar main met wijzigingen in
   `apps/site/` de site bouwt, de bestanden naar de Storage Zone uploadt en de
   cache van de Pull Zone leegt. Geheimen in de repo:
   `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`, `BUNNY_PULLZONE_ID`,
   `BUNNY_API_KEY`. Die zet Mark er zelf in.

Geen trackers en geen lettertypes van Google: alles komt van de eigen site,
dus er is geen cookiebanner nodig.

## Stijl

Zelfde huisstijl als de app, zodat de site voelt als de app op een groter
scherm:

- **Kleuren** uit `apps/web/src/styles/global.css`: papier `#faf6ef`, inkt
  `#1e2a35`, koraal `#e8613c` als accent, teal `#2a8f85` voor "gelukt". Ook
  het donkere thema, dat de site volgt als het toestel donker staat.
- **Letters:** Fraunces voor koppen (de reisdagboek-letter), Inter voor tekst,
  Outfit voor het woordmerk. Zelf gehost via fontsource, net als in de app.
- **Logo:** het kompas uit `apps/web/public/favicon.svg`, oranje op donker.
- **Iconen:** de eigen set uit `apps/web/src/components/Icon.tsx`. Astro
  tekent die bij het bouwen als SVG, dus er gaat geen JavaScript mee naar de
  bezoeker en het zijn precies dezelfde iconen als in de app.
- **Vormen:** de ronde hoeken (10, 16, 24 px), zachte schaduwen en de
  pillen-knoppen van de app.
- **Beweging:** de `--ease` curve van de app. Wat binnenkomt, gaat ook met een
  animatie weg. Alles valt stil bij "verminder beweging".
- **Teksten:** geen streepjes als gedachtestreep, datums als "t/m", kort en
  warm, zoals in de app.

Om het gelijk te houden: de kleuren en maten gaan naar een eigen
`tokens.css` die de app en de site allebei gebruiken.

## Pagina's

### Home, één lange pagina

1. **Openingsbeeld:** een telefoon met de kaart van een echte reis, met
   daarachter de draaiende wereldbol met vluchtbogen, zoals op het
   beginscherm van de app. Kop in de trant van "Je reis, vanzelf op de
   kaart." Knoppen: iPhone, Android, en klein "of in je browser".
2. **Zo werkt het**, drie stappen met de iconen uit de app: plan je route,
   reis (je route wordt zuinig bijgehouden), deel en beleef het opnieuw.
3. **Wat hij kan**, afwisselend beeld links en rechts, met echte screenshots:
   - de kaart met route, stops en foto's;
   - de routeplanner, met nachten, vervoer en vluchten van 4000 vliegvelden;
   - foto's uit je eigen Immich, die blijven waar ze zijn;
   - samen reizen: reisgenoten, gasten, reacties;
   - samenvattingen als poster voor je story of post;
   - je reisstatistieken: kilometers, landen, dagen;
   - het fotoboek en offline kaarten.
4. **Van jou:** eigen server, geen Google, geen reclame, geen tracking. Werkt
   ook op telefoons zonder Google (GrapheneOS, LineageOS).
5. **Voelt thuis op elk toestel:** iPhone met de echte iOS-onderdelen (glas,
   menu's, schakelaars), Android, en de browser.
6. **Vragen:** wat kost het, heb ik een server nodig, hoeveel batterij kost
   het, wat gebeurt er met mijn foto's, werkt het zonder Google.
7. **Onderaan:** privacy, hulp, GitHub, taalkeuze, "gemaakt door
   MarkMaaktMedia".

### Andere pagina's

- `/privacy`: het privacybeleid. Dat staat nu op de eigen server
  (reis.markmaaktmedia.nl/privacy) en kan hierheen, zodat de App Store een
  vast adres heeft dat niet van de server afhangt.
- `/hulp`: hulp en contact. Apple vraagt om een "Support URL" voor de App
  Store; dit wordt hem.
- `/en/...`: alles ook in het Engels.
- Een 404 in dezelfde stijl.

## Beeld

- **Echte screenshots** uit de simulator en de emulator, met de testreis
  "Portugal 2026" en een tweede reis met vluchten (bijvoorbeeld Armenië en
  Japan, nu die vliegvelden erin zitten). Licht en donker.
- In een toestelrand (iPhone en Android) die in CSS getekend is, niet als
  plaatje van Apple of Google.
- Omgezet naar AVIF en WebP door Astro, met de juiste maat per scherm.
- De wereldbol bovenaan: lichtgewicht getekend op canvas (d3-geo, ongeveer
  40 kB) in plaats van de volledige kaartbibliotheek. Met "verminder
  beweging" of zonder JavaScript een stilstaand beeld.
- Een deelplaatje (Open Graph) in de stijl van de samenvatting-posters, zodat
  een link in WhatsApp of op sociale media er goed uitziet.

## Eisen

- Snel: vrijwel geen JavaScript behalve de wereldbol, eerste beeld binnen
  anderhalve seconde op een telefoon, Lighthouse 95 of hoger.
- Toegankelijk: echte koppen en knoppen, contrast volgens WCAG AA, alles met
  het toetsenbord te bedienen.
- Vindbaar: titels en beschrijvingen per pagina, sitemap, en de gegevens
  waarmee zoekmachines snappen dat het een app is.
- Werkt op elke breedte, vanaf een smalle telefoon.

## Fases

1. **Beslissingen** van Mark (hieronder).
2. **Fundament:** `apps/site` met Astro, gedeelde `tokens.css`, lettertypes,
   iconen en logo. Lege pagina's met kop en voet in beide talen.
3. **Beeld maken:** testreizen klaarzetten, screenshots op iPhone en Android,
   licht en donker.
4. **Pagina's vullen:** home, privacy, hulp, 404, in het Nederlands en
   Engels.
5. **Bunny:** Mark maakt de Storage Zone, Pull Zone en DNS aan en zet de
   geheimen in GitHub; de deploy-workflow komt in de repo.
6. **Live:** domein koppelen, certificaat aan, controleren op telefoon en
   computer. Privacy- en hulp-adres in App Store Connect aanpassen.

## Beslissingen voor jou

- Waar staat de DNS van markmysteps.nl nu? Advies: nameservers naar Bunny.
- Mag de GitHub-repo publiek gelinkt worden, of blijft hij privé?
- Welke downloadknoppen nu al: de openbare TestFlight-link, of pas als de app
  in de App Store staat? Android via de GitHub-release?
- Welk mailadres voor hulp (bijvoorbeeld hulp@markmysteps.nl, dan is er ook
  mail op het domein nodig)?
- Vertellen we al over zelf hosten, of wachten we op de gehoste versie?
