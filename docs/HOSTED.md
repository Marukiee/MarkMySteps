# Plan: MarkMySteps zonder zelf te hosten

Plan van 25 oktober 2026. Doel: wie geen eigen server wil, kiest bij de start
voor de server van MarkMySteps. Zelf hosten blijft kunnen, net als zonder
server. Prijzen zijn een indicatie; check ze voor je iets afsluit.

## Kort advies

1. **Draai een tweede MarkMySteps, precies dezelfde als die je zelf host**, op
   een kleine server bij Hetzner in Duitsland of Finland, met een eigen domein.
   Je vrienden blijven op `reis.markmaaktmedia.nl`. Dat is de goedkoopste en
   snelste weg (ongeveer €15 per maand om te beginnen), want alles staat al in
   Docker met `install.sh`.
2. **Supabase (zoals bij Hiero) is hier geen besparing.** MarkMySteps heeft een
   eigen API-server met veel logica (tracking, Immich, routes, deelpagina's).
   Die moet ook met Supabase ergens draaien; Supabase zou alleen de database
   vervangen, voor ongeveer $25 per maand extra. Het gratis plan is niet voor
   echte gebruikers (het pauzeert na een week zonder verkeer en heeft 500 MB).
   Wat we wel van Hiero meenemen: Europese hosting, Brevo voor e-mail en de
   manier van werken met een verhuisroute.
3. **Het grote werk zit in foto's.** Nu komen alle foto's uit ieders eigen
   Immich, en wie niet zelf host heeft die meestal niet. Voor de gehoste server
   moet de app verkleinde foto's van je telefoon kunnen uploaden.
4. **Begin op uitnodiging.** Het goedkeuren van nieuwe accounts bestaat al.
   Open aanmelden komt pas als e-mail, account verwijderen en het afschermen van
   gebruikers op orde zijn.

## Hoe het voor gebruikers werkt

Bij de eerste start kies je hoe je MarkMySteps gebruikt:

| Keuze | Wat er gebeurt | Bestaat al? |
|---|---|---|
| **Met een MarkMySteps-account** (aanbevolen) | Account op onze server. Foto's uit je telefoon (verkleind geüpload) of uit je eigen Immich | Nee: nieuwe server en foto-upload nodig |
| **Op je eigen server** | Adres van je eigen MarkMySteps invullen, zoals nu | Ja, het veld Server-URL |
| **Zonder account, alleen op deze telefoon** | Alles blijft op je toestel | Ja, de lokale modus |

Later overstappen kan: de lokale modus is al gebouwd om je gegevens naar een
server te kunnen meenemen, en tussen servers verhuizen kan met een export en
import (fase 3).

## Wat er nu is en wat ontbreekt

Gevonden in de code van 25 oktober 2026:

- **Server kiezen:** de app onthoudt de server (`mms.server`) en valt anders
  terug op `DEFAULT_SERVER_URL`, nu `reis.markmaaktmedia.nl`. Zetten we die
  standaard om naar de gehoste server, dan moeten bestaande installaties eerst
  op hun huidige server worden vastgezet, anders verhuizen ze ongemerkt.
- **Aanmelden:** het eerste account is beheerder, de rest wacht op goedkeuring
  (maximaal 15 tegelijk). Goed voor een besloten begin.
- **Gebruikers zoeken:** het veld om reisgenoten toe te voegen vindt iedereen op
  de server op een stukje van de naam. Op een openbare server kan zo iedereen
  alle gebruikers opvragen. Moet worden: alleen een exacte gebruikersnaam, of
  een uitnodigingslink.
- **E-mail:** er is geen e-mail. Dus geen wachtwoord vergeten, geen bevestiging
  van je adres. Voor vreemden is dat nodig.
- **Account verwijderen:** kan nu alleen een beheerder. Apple eist dat je je
  account in de app zelf kunt verwijderen (richtlijn 5.1.1), en de AVG wil
  inzage en verwijdering.
- **Foto's:** alle foto's zijn verwijzingen naar Immich (`immichAssetId`). Er is
  geen eigen fotoopslag. Foto's van je telefoon worden nu alleen op je eigen
  toestel getoond.
- **Al goed voor een openbare server:** limieten per bezoeker, blokkade na foute
  wachtwoorden, tweestapsverificatie, en Immich alleen op openbare adressen
  (geen interne netwerken bereikbaar via de server).

## Hosting: de opties

| Optie | Wat | Per maand, begin | Voor | Tegen |
|---|---|---|---|---|
| **A. Zelfde stack op Hetzner** (aanbevolen) | Eén server met Docker: API, Postgres met PostGIS, website. Foto's in Hetzner Object Storage | Server ongeveer €5 tot €10, opslag ongeveer €5 (1 TB opslag en 1 TB verkeer), back-ups een paar euro | Goedkoopst, Europees bedrijf en servers in de EU, niets om te bouwen, zelfde als zelf hosten | Je beheert de server zelf: updates, back-ups, storingen |
| B. Supabase als database | Postgres bij Supabase (Frankfurt), API op een kleine server | Supabase Pro ongeveer $25, plus de server | Database beheerd, dagelijkse back-ups | Duurder, de API-server blijft, Supabase is geen Europees bedrijf, en we gebruiken er bijna niets van |
| C. Alles naar Supabase | De API herschrijven naar Supabase-functies en databaseregels | Ongeveer $25 | Minder servers | Maanden werk, twee versies van de app, zelf hosten wordt anders |

Advies: **A**. Kan de server later niet meer mee, dan eerst groter (Hetzner
schaalt in een paar minuten op), daarna de database naar een eigen server.

## Foto's zonder Immich

| Optie | Voor | Tegen |
|---|---|---|
| **Verkleinde kopieën uploaden** (aanbevolen) | Reisgenoten en de deellink zien je foto's; origineel blijft op je telefoon | Bouwen: upload op de achtergrond, opslag, quotum |
| Alleen op je eigen telefoon tonen | Niets te bouwen, niets te bewaren | Reisgenoten en de deellink zien je foto's niet |
| Eigen Immich koppelen | Bestaat al | Wie niet zelf host, heeft geen Immich |

Hoe uploaden zou werken:

- Alleen foto's die bij een reis horen (op datum, zoals de galerij nu al doet).
- Per foto een versie van 1600 pixels en een miniatuur van 400 pixels, samen
  ongeveer 0,4 MB. Video's eerst niet, of alleen een korte, kleine versie.
- Op de achtergrond en bij voorkeur op wifi (WorkManager op Android, BGTask op
  iOS), met een wachtrij die een herstart overleeft.
- Opslag in Hetzner Object Storage, per gebruiker een quotum (bijvoorbeeld 5 GB,
  ruim 10.000 foto's). Verwijder je een foto of reis, dan verdwijnt de kopie.
- In de database krijgt een foto een bron: `immich` of `opslag`. De rest van de
  app (raster, kaart, viewer, deelpagina) blijft gelijk.

## In fases

| Fase | Wat | Grootte | Klaar als |
|---|---|---|---|
| 1. Gehoste server | Hetzner-server, domein, `install.sh`, back-ups naar objectopslag, uptime-bewaking. Aanmelden op goedkeuring | Klein | Testers maken een account aan, jij keurt goed, alles werkt behalve foto's van de telefoon |
| 2. Keuze bij de start | Scherm met de drie keuzes; bestaande installaties vastzetten op hun server; standaardserver wordt de gehoste | Klein | Nieuwe installatie kiest zelf; je vrienden merken niets |
| 3. Klaar voor vreemden | Zoeken alleen op exacte gebruikersnaam of uitnodigingslink; account verwijderen en gegevens downloaden in Instellingen; e-mail via Brevo (adres bevestigen, wachtwoord vergeten); voorwaarden en een gehoste paragraaf in de privacypagina | Middel | Iemand die je niet kent kan zich aanmelden en weer helemaal weg, zonder dat hij anderen kan vinden |
| 4. Foto's uploaden | Upload van verkleinde foto's, quotum, opslag, bron per foto | Groot | Een reis met alleen telefoonfoto's ziet er bij reisgenoten en op de deellink hetzelfde uit als met Immich |
| 5. Openbaar in de stores | App Store en Google Play, handelaarsstatus (DSA) bepalen, testaccount voor de keuring | Middel | De app staat in beide stores |

Fase 1 tot en met 3 maken een besloten gehoste versie mogelijk. Fase 4 maakt
hem pas echt bruikbaar voor wie geen Immich heeft. Alles blijft één codebase:
de gehoste server is gewoon een installatie met andere instellingen (open of
besloten aanmelden, foto-opslag aan, quotum), zodat zelf hosten blijft werken.

## Kosten bij groei (ruwe schatting)

Aanname per actieve gebruiker per jaar: 15.000 locatiepunten (ongeveer 4 MB in
de database) en 500 foto's van 0,35 MB (ongeveer 175 MB opslag).

| Gebruikers | Database | Foto's | Optie A per maand | Optie B per maand |
|---|---|---|---|---|
| 100 | 0,4 GB | 18 GB | ongeveer €15 | ongeveer $35 |
| 1.000 | 4 GB | 175 GB | ongeveer €20 tot €25 | ongeveer $40 tot $50 |
| 10.000 | 40 GB | 1,75 TB | ongeveer €60 tot €100 | ongeveer $150 tot $250 |

Plus vast: een domein (ongeveer €10 per jaar), het Apple-account (al betaald),
eenmalig $25 voor Google Play, en e-mail gratis tot 300 per dag bij Brevo.
Foto's zijn de grootste post; het quotum houdt dat in de hand. Wordt het te
duur, dan kan er een betaalde versie komen met meer opslag.

## Privacy, wet en stores

- Met een gehoste server verwerk je locatiegegevens van mensen die je niet
  kent. Je bent dan verwerkingsverantwoordelijke: verwerkersovereenkomst met
  Hetzner (die bieden ze aan), data in de EU, een register van verwerkingen, en
  bij een datalek binnen 72 uur melden.
- Locatie is gevoelig; een korte risicoanalyse (DPIA) is verstandig.
- De privacypagina krijgt een paragraaf voor de gehoste server, plus
  gebruiksvoorwaarden.
- Apple: account verwijderen in de app is verplicht; een testaccount voor de
  keuring. Bied je de gehoste dienst aan als Mark Maakt Media, dan ben je
  waarschijnlijk handelaar onder de DSA (je bedrijfsgegevens worden dan in de EU
  App Store getoond).

## Risico's en uitweg

- **Beheer:** een slecht bijgehouden server is onveiliger dan een beheerde
  dienst. Updates gaan met `install.sh`; zet automatische beveiligingsupdates
  aan en test eens per kwartaal het terugzetten van een back-up.
- **Groei:** foto's en verkeer. Quotum en verkleinen houden het klein.
- **Verhuizen:** alles is Docker en Postgres; naar een andere provider is een
  databasedump plus de objectopslag kopiëren.

## Beslissingen voor jou

1. Een aparte gehoste server (advies) of je huidige server openzetten?
2. Welk domein, bijvoorbeeld `markmysteps.nl` of `.eu`, bij een Europese registrar?
3. Gratis met een quotum, of later een betaalde versie?
4. Beginnen op uitnodiging (advies) of meteen open?
5. Hoeveel opslag per gebruiker?
