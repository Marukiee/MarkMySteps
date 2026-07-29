# MarkMySteps

Zelf-gehoste, open-source reis-tracker. Plan je route met versleepbare stops,
houd je reis bij zonder je batterij leeg te trekken (en zonder Google), en kijk
alles later terug op een kaart die er goed uitziet.

Je foto's blijven waar ze staan: in de galerij van je telefoon, of op je eigen
[Immich](https://immich.app)-server. MarkMySteps kopieert ze niet.

## Wat het doet

- 🗺️ **Kaart en globe** (MapLibre + OpenFreeMap) — geen API-sleutels, geen
  Google. Een route per reiziger, foto's als markers met clustering, en per
  persoon aan of uit te zetten
- 🧭 **Routeplanner** — stops met "X nachten"; verander er één en alle datums
  erna schuiven vanzelf mee. Vervoer per stuk (auto, trein, bus, boot, vlucht
  met tussenlandingen), en dagtrips die vanuit een stop vertrekken zonder je
  planning te verzetten
- 🔋 **Zuinige tracking** — Android-app op de AOSP-locatievoorziening, dus geen
  Google Play Services. Werkt op LineageOS en GrapheneOS. Eén meting per
  interval, dichter op elkaar zodra je echt onderweg bent, en offline gebufferd
  tot er weer verbinding is
- 📸 **Foto's** — uit de galerij van je toestel, of van je eigen Immich-server.
  In beide gevallen worden ze op datum aan een reis gekoppeld en met hun
  EXIF-locatie op de kaart gezet
- 📴 **Werkt zonder server** — alles kan volledig op je telefoon. Een server
  koppelen kan later alsnog, zonder iets opnieuw in te voeren
- 🧳 **Polarsteps-import** — upload je "Download my data"-zip: reizen, volledige
  GPS-sporen en stops komen mee
- 👥 **Samen reizen** — gedeelde reizen, gecombineerde routes en foto's, en een
  privélink voor het thuisfront zonder dat die een account nodig heeft
- 🔒 **Van jou** — de database heeft geen poorten naar buiten, er is één
  web-poort die alleen op localhost luistert (bedoeld achter een Cloudflare
  Tunnel), en Immich-sleutels staan versleuteld opgeslagen (AES-256-GCM)

## Zonder server gebruiken

Installeer de app, kies **Doorgaan zonder server** en vul je naam in. Geen
account, geen wachtwoord, niets dat je toestel verlaat. Je kunt later alsnog een
server koppelen; je reizen gaan dan in één keer mee.

## Server installeren (Linux + Docker)

Een server is gewoon een computer die aan blijft staan. Een oude laptop met
Linux voldoet prima, net als een Raspberry Pi of een NAS. Je hebt Docker nodig.

```bash
git clone https://github.com/Marukiee/MarkMySteps.git && cd MarkMySteps && ./install.sh
```

De installer vraagt één keer om het adres waarop je de app wilt bereiken,
genereert alle sleutels, bouwt de boel en laat zien wat je in Cloudflare Tunnel
moet invullen. Standaardpoort: `18790` (aan te passen met `WEB_PORT`).

Bijwerken: `git pull && ./install.sh`. Verwijderen: `./uninstall.sh`.

Uitgebreide uitleg (Cloudflare Tunnel, Immich koppelen, Polarsteps-import,
back-ups): **[docs/DEPLOY.md](docs/DEPLOY.md)**

## Android-app

Elke push bouwt automatisch een getekende APK:

1. Ga naar [Releases](https://github.com/Marukiee/MarkMySteps/releases) en pak
   `markmysteps.apk` uit de nieuwste release
2. Installeer 'm op je telefoon (sta installeren uit onbekende bron toe)
3. Kies bij het starten of je een server gebruikt of niet
4. Zet locatie op **"Altijd toestaan"** als je wilt dat tracking doorloopt met
   het scherm uit

Werkt zonder Google Play Services. De web-app draait ook als PWA in elke mobiele
browser; tracking vereist daar wel dat het scherm aan blijft.

## Techniek

| Laag      | Gebruikt                                          |
|-----------|---------------------------------------------------|
| Backend   | NestJS · Prisma · PostgreSQL 16 + PostGIS         |
| Frontend  | React · Vite (PWA)                                |
| Mobiel    | Capacitor (Android, eigen plugins, geen GMS)      |
| Kaarten   | MapLibre GL · OpenFreeMap · Photon-geocoding      |
| Weer      | Open-Meteo                                        |
| Uitrollen | Docker Compose · Cloudflare Tunnel                |

## Meebouwen

Nodig: Node ≥ 22, pnpm, Docker. De lokale opzet staat onderaan
[docs/DEPLOY.md](docs/DEPLOY.md). Architectuur en planning:
[docs/PLAN.md](docs/PLAN.md).

## Licentie

AGPL-3.0
