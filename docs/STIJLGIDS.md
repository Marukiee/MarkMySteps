# Stijlgids: apps in de stijl van PixelPlayer en MarkMySteps

Een instructie voor een agent die een (Android-)app bouwt in dezelfde stijl als
PixelPlayer (Marks mod) en MarkMySteps native. Alles hieronder komt uit Marks
eigen opmerkingen, punt voor punt. Lees het helemaal voor je begint en houd je
er letterlijk aan. Nieuwe opmerkingen van Mark komen hier meteen bij.

Platform: Android in Jetpack Compose met Material 3 Expressive; iOS in SwiftUI
met echt Liquid Glass (de eigen onderdelen van Apple, geen nagemaakte Material).
Gedrag en detailniveau zijn op beide gelijk.

## 1. Houding

- Mark ziet elk detail: een pixel verschil in een rand, een frame waarin iets
  verspringt, een kleur die even bruin wordt. Ga ervan uit dat hij het ziet.
- Neem niets aan over de oorzaak. Meet het: screenshot op ware grootte en tel
  pixels, of neem het scherm op en bekijk het frame voor frame (ffmpeg, een
  contactvel van 10 tot 15 frames per seconde). Pas daarna veranderen.
- Een opname op een zwaar belaste emulator zegt niets over snelheid, wel over
  sprongen en volgorde. Snelheid beoordeel je op een echte telefoon.
- Nieuwe schermen eerst als screenshot laten zien, pas na akkoord uitbrengen.
- Elke opmerking komt op een lijst (roadmap) en wordt stap voor stap afgewerkt;
  niets vergeten. Een punt gaat er pas af na Marks akkoord.
- Kleine gedragingen van de oude versie gaan vanzelf mee bij een ombouw.

## 2. Vorm en kleur

- Geen schaduwen. Vlakken scheiden met tonale kleur (surfaceContainer-tonen) en
  hooguit een fijne rand (outlineVariant, ongeveer 55 procent). Enige
  uitzondering: een zwevende navigatiebalk met een zachte schaduw.
- Alles moet duidelijk loskomen van wat eronder ligt, in licht en donker: geen
  wit op lichtbeige, geen half doorzichtige knop op een kaart of foto zonder
  genoeg contrast. Controleer contrast (3:1 voor iconen, 4,5:1 voor tekst).
- Een knop moet altijd duidelijk zichtbaar zijn als knop. Zijn vlak verschilt
  duidelijk van wat eronder ligt (minstens 3:1 tussen knop en achtergrond), en
  zijn tekst is goed leesbaar op dat vlak (4,5:1). Dus nooit een lichtrode of
  lichte tonale knop op een lichtblauwe, lichtgrijze of beige dialoog: twee
  pasteltinten naast elkaar lezen als een vlek, niet als een knop. De
  hoofdactie (ook verwijderen) is een gevulde pil in de volle kleur met witte
  tekst; annuleren is een tonale pil die zelf ook duidelijk afsteekt. Meet het
  na met een kleurmeter of contrastberekening, niet op het oog.
- Donker is gewoon donker (bijvoorbeeld #14181D), geen OLED-zwart.
- Concentrische hoeken: een vorm binnen een vorm heeft als straal de buitenste
  straal min de ruimte ertussen. Voorbeeld: menu 28 dp, regels 4 dp ingesprongen,
  dus regels 24 dp aan de rand en 6 dp waar ze elkaar raken. Meet het na: de
  ruimte tussen binnen en buiten moet langs de hele bocht gelijk zijn.
- Teken afgeronde vlakken als echte afgeronde rechthoek (RoundedCornerShape met
  drawOutline). De vormen die Material zelf morphen (MenuItemShapes en
  dergelijke) worden als polygoon getekend en hun hoeken zijn platter dan
  gevraagd (24 dp werd ongeveer 21 dp).
- Gelijke binnenranden rondom: boven, onder en opzij dezelfde afstand. Meet in
  pixels, corrigeer tot op de pixel.
- Ronde hoeken van een paneel en wat erin staat lopen gelijk.
- Iconen zijn getekend (lijniconen), staan echt in het midden van hun vak en
  zijn nooit een letterteken uit een font (geen "→").
- Iconen bij cijfers staan los op de tegel, niet in een rondje.
- Hover op het web: alleen de kleur wordt iets donkerder. Niets beweegt omhoog
  en iconen worden niet groter of kleiner. De gewone kleur is de lichte; een
  knop mag er nooit uitzien alsof hij al gehoverd wordt.
- Een lijn met stippen (tijdlijn) loopt precies door het midden van elke stip;
  meet het na in pixels, op telefoon en desktop.
- Merkletter (in MarkMySteps Outfit) voor koppen en grote getallen, Inter voor
  tekst.
- Vlaggen zijn vlakke vlaggen met licht afgeronde hoeken, nooit emoji.
- Een knop zonder vlak (alleen een icoon op een kaart) heeft ook in animaties
  geen vlak: laat geen rondje verschijnen dat er normaal niet is.
- Knoppen op een kaart hebben de achtergrondkleur van de pagina zelf
  (MarkMySteps: #FBF7F2 / web --paper), niet het donkere beige van kaarten en
  geen gekleurde tint. Actief mag primary zijn.
- Een routelijn op een kaart volgt de zoom: dun over een heel land, volle dikte
  vanaf stadsniveau. Op een satellietfoto geen witte rand eronder.
- Een kruisje dat bij hover verschijnt krijgt ruimte (de rij schuift in), het
  valt nooit over een andere knop.

## 3. Beweging

Algemeen:

- Alles beweegt in en uit. Niets springt, niets popt er ineens in.
- Geen doorschieten bij formaat of plek wisselen. Gebruik een kritisch gedempte
  veer (dampingRatio 1) of een tween met emphasized easing
  CubicBezier(0.2, 0, 0, 1).
- Een veer neemt snelheid mee naar de volgende tik. Voor iets dat je snel heen
  en weer kunt tikken (tabs, schakelaars) een vaste tween gebruiken, zodat een
  enkele tik en snel heen en weer er hetzelfde uitzien.
- Een kleur die verdwijnt vervaagt naar dezelfde kleur met alpha 0, nooit naar
  Color.Transparent (dat is zwart en geeft een bruine of grijze tussenkleur).
- Geen tweetraps-beweging: een paneel of menu gaat in een vloeiende lijn.
- Bij een onderbreking (snel dichtdoen tijdens openen) loopt de beweging vanaf
  de huidige stand terug, niet vanaf het begin.

Vaste maten die Mark goedkeurde:

- Panelen (bottom sheets): Material's eigen ModalBottomSheet met
  skipPartiallyExpanded, binnen MaterialTheme(motionScheme = PanelMotion), waarbij
  PanelMotion het expressive schema is met fastEffectsSpec =
  tween(380, FastOutSlowInEasing). Dit is precies het Connect device-paneel van
  PixelPlayer. Niet aan sleutelen. Bovenhoeken 28 dp, opent in een keer helemaal
  zodat een keer terug hem sluit.
- ⋯-menu: groeit uit zijn eigen knop. De vorm begint als die knop (zelfde maat en
  rond), in de kleur van de knop, en groeit vanuit de rechterbovenhoek van de
  knop naar het hele menu: 240 ms openen met CubicBezier(0.2, 0, 0, 1), 220 ms
  dicht met FastOutSlowIn, ook bij een tik ernaast. De knop verdwijnt niet in een
  keer maar vloeit in het eerste stuk over in het menu en komt in het laatste
  stuk terug (overvloei over 30 procent van de beweging). De inhoud komt pas op
  na 10 procent en is er bij 70 procent. Na een keuze binnen het menu (een
  schakelaar) sluit het na ongeveer 420 ms, zodat je de keuze ziet.
- Navigatiebalk-pil: tween 260 ms CubicBezier(0.2, 0, 0, 1) voor breedte en
  kleur, label vervaagt in na 60 ms, geen grijze ripple (de pil is het antwoord
  op de tik).
- Uitklappil (bijvoorbeeld vervoer kiezen): de pil zelf klapt uit in zijn eigen
  kleur, geen los paneeltje. Breedte en hoeken groeien mee, opent naar boven als
  er onder geen ruimte is, klapt met animatie in bij scrollen of een tik ernaast.
  Openen 260 ms decelerate, sluiten 200 ms. Tikje bij uit- en inklappen.
- Kaart groot of klein wisselen: veer dampingRatio 1, stiffness 380, de
  onderkant gaat niet eerst omhoog en dan omlaag.
- Fotogroepen op een kaart: geneste groepen per halve zoomstap; bij inzoomen
  glijden de foto's uit de groep, bij uitzoomen glijden ze erin en vervagen.
  320 ms CubicBezier(0.2, 0, 0, 1). Groeperen alleen per vaste zoomstap, zodat
  een klein beetje schuiven niets hergroepeert.
- Een getal dat verandert terwijl je kijkt rolt naar de nieuwe waarde (omhoog
  bij meer, omlaag bij minder, 420 ms). Niet meteen bij het openen van een
  pagina: wacht tot de pagina staat (ongeveer 900 ms na openen).

## 4. Haptiek

- Een tikje op knoppen, tabs, schakelaars en bij elke keuze, zoals PixelPlayer
  en Tandem.
- Openen en sluiten van iets uitklapbaars allebei een tikje.
- Stappen (teller, schuiven door een fotostrip) een licht tikje per stap.
- Lang indrukken om op te pakken: de lange-druk-feedback; bij elke wissel van
  plek een tikje.
- Bij de grens van een teller een duidelijk "kan niet"-tikje.

## 5. Laden

- Wat al bekend is staat er meteen. Bewaar wat de pagina de vorige keer telde of
  liet zien (cijfers, foto's) op de telefoon en toon dat direct bij openen.
- Nooit eerst een verkeerde waarde die daarna verspringt (een lijst die
  dagtrips meetelde: 8 stops werd 5).
- Nog niet bekend: lege ruimte van de juiste hoogte. Geen grijs blokje, geen 0,
  geen spinner die de maat verandert.
- Een tegel of rij houdt zijn maat tijdens laden, zodat niets verspringt.
- Foto's die al op de telefoon staan eerst van de telefoon, daarna pas het
  netwerk. Komt een foto binnen 250 ms, dan zonder vervagen. Laadt een foto niet,
  dan de volgende kandidaat proberen in plaats van een flikkerend leeg vak.
- Vooruit laden zodat je bij scrollen nooit lege vakjes ziet.

## 6. Onderdelen

- ⋯-menu: Material 3 Expressive segmented menu (afgeronde groepen met een
  tussenruimte, geen schaduw, gekozen optie met vinkje in de warme accentkleur).
  Opent op de knop (bovenkant gelijk, rechts uitgelijnd), zo breed als nodig.
  Keuzes van een soort staan als verbonden knoppen naast elkaar, de gekozen is
  gevuld. In een donker scherm (fotoviewer) donkere tonen, geen fel wit.
- Teller (stepper): verbonden knoppengroep, min, waarde met eenheid, plus. Rond
  aan de buitenkant, strak waar ze elkaar raken; de ingedrukte kant rondt verder
  af (6 naar 20 dp).
- Dialogen: bevestigen als gevulde pil (rood bij verwijderen of verlaten),
  annuleren als tonale pil. Nooit losse tekstknoppen.
- Schakelaars en waarden die (nog) niets doen staan er niet. Wat niet kan is
  grijs en zegt pas bij een tik waarom; geen blijvende waarschuwingsteksten.
- Een knop met alleen een icoon heeft een voorleestekst.
- Lange tekst eindigt met een beletselteken, nooit midden in een regel
  afgesneden.
- Een invulveld staat altijd helemaal boven het toetsenbord, met lucht eronder
  (en bij een zoekveld ruimte voor de eerste suggesties); nooit met zijn rand
  tegen het toetsenbord.
- Bijwerken kan op twee plekken: de updatekaart bovenin en de balk in
  Instellingen › Updates (UpdateBar uit markupdate). Geen losse melding "versie
  X is beschikbaar" eronder.
- Scrollrijen lopen tot de rand van het scherm, het eerste item staat op de lijn
  van de rest.
- Galerijstrip onder een fotoviewer: gelijke vakken (36 dp tegel, 8 dp tussen),
  de middelste iets groter (1,26) met de buren opzij geschoven, over de hele
  breedte, volgt het vegen precies, scrubben bladert de viewer met een tikje per
  foto, stopt altijd op een foto. Tikken op de foto toont of verbergt de knoppen
  meteen (niet wachten op een dubbeltik; dubbeltik zoomt nog steeds).
- Een menu dat geen ruimte heeft onder de knop klapt naar boven uit met zijn
  onderkant op de knop, en groeit ook dan vanuit de knop zelf.
- Plaatsen bij een reis kies je op locatie (waar de foto's genomen zijn), nooit
  alleen op datum: een doorreisstop en een stad die geen stop was horen erbij.
- Cijfers op een pagina die opent staan er meteen; wat de pagina in de eerste
  seconden te weten komt neemt stil de plek in, zonder rollen.
- Cijfertegels zijn gekleurd: de tonale containers om de beurt (zalm, zand,
  turquoise) als een verbonden blok.
- Een strip of rij die op een item moet stoppen stopt altijd op een item; een
  terugglij-animatie mag zichzelf niet afbreken.
- Slepen om te herordenen: alleen het item zelf gaat omhoog (iets groter, licht
  gekanteld), niet wat erboven hangt (een lijntje of verbinding blijft staan en
  vervaagt). Het item volgt de vinger op het scherm, wisselt als het half over
  zijn buur is (met wat speling zodat het nooit terugflipt), de buren glijden
  opzij, en na loslaten glijdt het op zijn plek. Meet posities op de kaarten
  zelf, niet op iets waarvan de hoogte verandert als het verplaatst, en op waar
  de buren naartoe glijden (niet halverwege). Tijdens slepen loopt er een
  gelijkmatige lijn achter de hele lijst; de losse lijnstukjes wijken zolang.

## 7. Navigatie

- Terugveeggebaar: een seekbare shared-axis-overgang (350 ms, emphasized), de
  pagina gaat met de vinger mee en de vorige schuift er al onder; loslaten speelt
  verder, terugtrekken springt terug. Een paneel volgt het terugveeggebaar naar
  beneden.
- Terug sluit altijd de bovenste laag eerst.
- Een tab opent bovenaan; terug uit een detailpagina houdt de lijst zijn plek.
- De navigatiebalk komt pas terug als de pagina er echt is.

## 8. Werkwijze voor de agent

- Test nooit iets dat schrijft op echte data: een testmodus (dry run) die elke
  wijziging tegenhoudt, en controleer in het log dat die aan staat.
- Na elke wijziging: bouwen (release-build, exit code nakijken), op een emulator
  bekijken met screenshots of een opname, pas dan op de telefoon zetten.
- Meet randen en hoeken in pixels; neem bewegingen op en bekijk ze frame voor
  frame. Een vermoeden is geen oorzaak.
- Houd een lijst bij van elke opmerking met de stand per platform, en werk die
  stap voor stap af.
- Emulators en simulators na afloop afsluiten.
- Geen em dashes of en dashes, nergens.
