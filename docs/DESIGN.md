# Ontwerpregels

Waar elk nieuw onderdeel van MarkMySteps aan moet voldoen, voordat het erin
gaat. Opgeschreven uit Marks keuzes bij de aanpassingen uit Simons fork
(oktober 2026) en wat de app al deed.

## Plaats en uitlijning

- **Eén linkerrand.** Een nieuw blok begint op dezelfde rand als zijn buren: in
  de tijdlijn de rand van de foto's, op een pagina de paginarand
  (`1.25rem`). Niet inspringen omdat het "bij de dag hoort".
- **Zwevende balken op de paginarand.** Een melding, selectiebalk of knoppenrij
  die boven de inhoud zweeft, heeft links en rechts dezelfde marge als de
  kaarten eronder (`max(1.25rem, env(safe-area-inset-*))`) en staat boven de
  tabbalk.
- **Vaste plekken.** Vlaggetjes op een foto staan rechtsboven, naast elkaar, in
  één vorm. Een sluitknop zit rechtsboven, een terugknop linksboven.
- **Veilige zones.** Alles aan de rand van het scherm telt de veilige zone van
  dat apparaat mee (notch, veegstreep, statusbalk).

## Vorm

- **Bestaande knoppen.** `.btn`, `.btn-ghost`, `.btn-primary` en de pill-switch:
  zelfde hoogte, rondheid, lettergrootte en icoongrootte (15 tot 17 px). Geen
  kale tekst als knop, geen nieuwe vorm voor één scherm.
- **Icoon waar het icoon het zegt.** Een like is een hartje met het aantal
  ernaast, geen "Vind ik leuk". Elk icoon heeft een `aria-label`.
- **Kaarten.** Een eigen vlak alleen voor wat een eigen ding is (een
  dagverhaal), met `--radius-m`, de rand `--line` en `--paper-raised`.
- **Geen versiering die het systeem al geeft.** Een schuifgreep krijgt geen
  oranje lijn: de cursor verandert al.

## Beweging

- **Wat binnenkomt, gaat ook netjes weg.** Niets verdwijnt in één frame. Houd
  een element vast met `useExit` en speel de omgekeerde animatie af
  (`.closing` of `.leaving`).
- **Zelfde maat als de rest.** Curve `var(--ease)`. Binnenkomen 0,24 tot
  0,35 s, weggaan 0,18 tot 0,24 s. Sheets: achtergrond vervaagt in 0,28 s en het
  vel schuift 30 px omhoog (`sheetUp`); dicht in 0,24 s (`sheetDown`).
  Popovers schalen en vervagen vanaf hun eigen knop.
- **Niets springt van maat.** Een paneel dat groter wordt, groeit (hoogte,
  `grid-template-rows` of een FLIP-transform); een raster dat herschikt, schuift
  de tegels naar hun nieuwe plek.
- **Minder beweging.** Onder `prefers-reduced-motion: reduce` staan de
  animaties uit.

## Gedrag

- **Terug sluit de bovenste laag.** De terugknop van Android en het veeggebaar
  van iOS sluiten eerst wat er bovenop ligt (popover, paneel, sheet, viewer,
  opengeklapte kaart) en pas daarna de pagina. Gebruik `useBackToClose`.
- **Tikken doet wat je verwacht.** Een foto op de kaart opent de foto; tikken op
  de lege kaart vergroot de kaart.
- **Geen houtje-touwtje.** Wat bij de bron hoort, regel je bij de bron. Welke
  foto's in een reis staan, bepaal je in Immich (archiveren, datum en plaats in
  de metadata), niet met een tweede selectie in MarkMySteps. Foto's komen
  vanzelf binnen.
- **De deelpagina blijft rustig.** De foto's staan voorop. Geen extra tabs of
  panelen boven de kaart; de getallen in de kop zijn losse bolletjes.

## Tekst en platform

- **Nederlands uit Nederland.** Telefoon of mobiel, niet gsm; reservering, niet
  reservatie. Geen gedachtestreepjes (het lange en het halflange streepje) in zichtbare tekst of in code.
- **Elk platform zijn eigen woorden.** iOS heet het "Altijd" en "Bestanden",
  Android "Altijd toestaan" en "Downloads". Zie `alwaysLabel()` in `native.ts`.
- **iOS-velden zijn 16 px**, anders zoomt iOS bij het tikken de hele pagina in.
- **Op de iPhone echt glas, van het systeem.** De tabbalk is die van iOS, en
  knoppen die vast op het scherm zweven zijn echt Liquid Glass, verwante knoppen
  samen in één capsule (`MmsTabBar`, `MmsGlass`). Inhoud staat op gewone vlakken,
  nooit glas op glas, en geen nagemaakt glas in CSS.
- **Nieuwe teksten gaan door de vertaling** zodra de i18n er is.
