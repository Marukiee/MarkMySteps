# markupdate

De updater en de updatekaart van al Marks apps, in één map die in elke app **precies hetzelfde** is.

> **Niet aanpassen in een app.** Elke kleine afwijking maakt de apps weer verschillend. Wijzigingen worden alleen in **Keeper**
> (`android/markupdate`) gemaakt, getest en gecommit, en daarna met `sync.sh` naar alle apps gekopieerd. In een app staat daarom een
> bestand `markupdate/BRON` met de Keeper-commit waar de kopie vandaan komt.

## Wat het doet

Zoekt de nieuwste release op GitHub (`releases/latest`), laat een kaart bovenaan de app zien ("Nieuwe versie X", twee regels uit de
releasetekst, Later en Bijwerken), downloadt het apk met een controle op de SHA-256, en installeert het via een PackageInstaller-sessie met
`USER_ACTION_NOT_REQUIRED`. Zonder tweede tik: Android vraagt de eerste keer zelf om een bevestiging en daarna niet meer, zodra de app de
installer van zichzelf is.

## Twee projecten in één map

| Project | Wat | Heeft Compose nodig |
|---|---|---|
| `:markupdate:core` | `MarkUpdate`, `MarkUpdater`, `UpdateState`, de ontvanger van de installer, de releasetekst, teksten voor meldingen en foutredenen (en/nl) | nee |
| `:markupdate:card` | `UpdateCard` en `UpdateCardStyle`, teksten van de kaart (en/nl); haalt de kern mee | ja |

Een app zonder Compose (MarkMySteps, Capacitor) neemt alleen de kern.

## Instellen in een app

`settings.gradle.kts` (of `settings.gradle`, dan `include ':markupdate:core'`):

```kotlin
include(":markupdate:core", ":markupdate:card")
```

`app/build.gradle.kts`:

```kotlin
implementation(project(":markupdate:card"))   // zonder Compose: ":markupdate:core"
```

In `Application.onCreate` (de ontvanger van de installer gebruikt hetzelfde exemplaar, ook als Android het proces er alleen voor wakker maakt):

```kotlin
MarkUpdate.init(
    this,
    MarkUpdateConfig(
        owner = "Marukiee", repo = "Keeper", apkAsset = "Keeper.apk",
        currentVersion = BuildConfig.VERSION_NAME, appName = "Keeper", notificationIcon = R.drawable.ic_stat_keeper,
    ),
)
```

Bij het openen van de app (bijvoorbeeld in de root van de UI) en bovenaan het hoofdscherm:

```kotlin
LaunchedEffect(Unit) { MarkUpdate.get().checkIfDue() }      // hooguit elke 6 uur, en alleen als autoCheck aan staat
UpdateCard(Modifier.padding(top = 8.dp))                    // of UpdateCard(style = UpdateCardStyle(successColor = ...))
```

Een instellingenrij "Nu controleren" gebruikt `MarkUpdate.get().check()`, `state` en `autoCheck` / `setAutoCheck(on)`.

De module brengt zelf mee (via de manifest-merge): `REQUEST_INSTALL_PACKAGES`, `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, `INTERNET`,
`POST_NOTIFICATIONS` en de ontvanger `InstallResultReceiver`. Een app declareert die niet zelf en heeft er geen eigen ontvanger voor.

`UpdateCardStyle` is voor wat per app anders is: de vorm van de kaart, het groen van het vinkje, hoe ver een knop krimpt, de regel onder "Installeren"
(`installingSubtitle`) en `UpdateCardMotion` (veer- en tweenwaarden, ook de veer waarmee Later krimpt: demping 0,9 en stijfheid 90, als aandeel van de
breedte). Alles is standaard Keeper. Kleuren, lettertypen en vormen komen uit `MaterialTheme`.

### Wat een app zelf doet rond de installatie (`InstallHook`)

Een app die zichzelf bijwerkt wordt door Android gesloten en start niet vanzelf opnieuw. Standaard doet de module daar niets aan en zegt de kaart
"De app sluit zo even, daarna is hij bijgewerkt". Wil een app er zelf iets mee (Drip opent zich weer via zijn toegankelijkheidsdienst), dan geeft hij
`MarkUpdateConfig(installHook = ...)` een `InstallHook`; alle functies zijn optioneel, en een fout in de haak breekt de update niet af:

```kotlin
installHook = object : InstallHook {
    // Vlak voordat het apk aan de installer gaat. inFront: de app stond op het scherm (alleen dan is heropenen zinvol). Bewaar hier wat je daarna nodig hebt.
    override fun onInstallStarting(context: Context, release: ReleaseInfo, inFront: Boolean) { /* ... */ }
    // De installer meldde iets terwijl dit proces nog leeft: mislukt/afgebroken (success = false), of een ander pakket werd geïnstalleerd (success = true).
    // Maak ongedaan wat onInstallStarting bewaarde. Niet aangeroepen als deze app zelf vervangen werd: het proces is dan weg.
    override fun onInstallFinished(context: Context, success: Boolean) { /* ... */ }
    // De eerste start na een update (de versie is anders dan bij de vorige start), vroeg in Application.onCreate, dus voordat MarkUpdate.get() bestaat.
    override fun onUpdated(context: Context, previousVersion: String) { /* ... */ }
}
```

Zegt de kaart dan iets anders dan de standaard ("De app opent zo weer"), zet dan `UpdateCardStyle(installingSubtitle = "...")`. Vanuit Java is `InstallHook` een gewone
interface (de functies hebben een lege standaard).

### Vanuit Java (zonder Compose)

```java
MarkUpdater updater = MarkUpdate.init(application,
    new MarkUpdateConfig("Marukiee", "MarkMySteps", "MarkMySteps.apk", BuildConfig.VERSION_NAME, "MarkMySteps", R.drawable.ic_stat, "update", 6L * 60 * 60 * 1000));
updater.checkIfDueAsync();
Closeable stop = updater.addListener(state -> { /* UpdateState: Available, Downloading, Installing, Failed, ... */ });
updater.startUpdate(release);   // release uit UpdateState.Available
```

## Wat een release nodig heeft

Een tag `v*` met het apk als asset `<apkAsset>` (en `<apkAsset>.sha256`, met de som en de bestandsnaam zoals `sha256sum` het schrijft).

De kaart toont twee korte regels van wat er nieuw is, op één regel afgekapt: schrijf ze dus kort. Bron, in deze volgorde:

1. **`changelog.json`** in de root van de repo, zoals het op de tag van de release stond (`raw.githubusercontent.com/<owner>/<repo>/<tag>/changelog.json`;
   een ander pad of geen bestand via `MarkUpdateConfig.changelogPath`, `null` slaat het ophalen over). Een lijst met de nieuwste versie bovenaan:
   `[{"version": "0.1.30", "en": {"new": ["..."], "better": [...], "fixed": [...]}, "nl": {...}}]`. De kaart neemt de taal van de telefoon (nl of
   en; heeft het bestand geen nl, dan en) en daaruit eerst `new`, dan `better`, dan `fixed`, twee regels.
2. De **releasetekst** als er geen `changelog.json` is, het geen regels voor deze versie heeft of het niet te lezen was: de eerste twee punten, in de taal van
   de app als de tekst een deel `## Wat is nieuw (Nederlands)` heeft, anders Engels.

Het bestand wordt alleen opgehaald als er een nieuwere versie is. De hoeveelheid die gedownload wordt staat als megabytes met één decimaal ("7,7 van 22,0 MB").

## Wijzigen en syncen

1. Wijzig in Keeper, draai de tests (`:markupdate:core:testDebugUnitTest`, `:app:testDebugUnitTest`) en bekijk de kaart op een emulator.
   Zonder echte release: `MarkUpdate.get().showPreview()` toont een nepversie 9.9.9 (22 MB) die je met Bijwerken door alles heen kunt laten lopen,
   `showFailurePreview("...")` toont de foutkaart. Keeper heeft daar een debugcommando voor (`--es update preview|fail|clear`, zie CLAUDE.md).
2. Commit in Keeper. `sync.sh` weigert een map met niet-gecommitte wijzigingen.
3. Per app: `android/markupdate/sync.sh <android-map van de app>`. Dat kopieert de map ongewijzigd (zonder `build/` en `.gradle`), schrijft `BRON` en
   drukt af wat de app zelf nog moet doen (de `include`, de dependency en de `init`). Het script past de settings of build van de app nooit aan.
4. `sync.sh --check <android-map van de app>` vergelijkt de kopie met Keeper en stopt met een fout bij elk verschil. Draai het als je twijfelt of een app nog gelijk is.

Het script weigert te draaien vanuit een kopie (een map met `BRON`).

## Eisen aan de app

- Android Gradle Plugin 8.x **of** 9.x. De buildbestanden kijken zelf welke: onder AGP 8 passen ze `org.jetbrains.kotlin.android` toe (die moet op de
  classpath van de root staan), onder AGP 9 niet (Kotlin is daar ingebouwd en de plugin wordt geweigerd). De kaart past in beide gevallen
  `org.jetbrains.kotlin.plugin.compose` toe: die moet op de classpath van de root staan, dus in de root `alias(...) apply false` of
  `id("org.jetbrains.kotlin.plugin.compose") version "..." apply false`, ook als hij uit een catalogus komt.
  De buildbestanden van de module zijn zelfstandig: geen `libs.`-verwijzingen, geen `repositories {}`, plugins zonder versie.
- `minSdk` van de app 24 of hoger, `compileSdk` 36 of hoger. De module gebruikt `compileSdk = 36`, `minSdk = 24`, Java 17.
- Getest met AGP 8.13.2 / Kotlin 2.2.21 (Keeper) en met AGP 9.3.1 / Gradle 9.5.1 / Kotlin 2.4.10 in een los scratchproject (kern: 27 tests, kaart en
  app bouwen). Dat scratchproject heeft de versies van GuitarTuner en PixelPlayer (AGP 9.3.1, Kotlin 2.4.10); in die apps zelf is het nog niet gebouwd.
- **MarkMySteps (Capacitor, Java, Groovy-Gradle)** heeft geen Kotlin-plugin op de classpath: voeg in de root `build.gradle` bij `buildscript.dependencies`
  `classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.21'` toe, dan kan `:markupdate:core` bouwen (hij komt met zijn eigen Kotlin-stdlib).

## Lessen (uit Keeper en MarkMySteps)

1. **Eigen scope.** De download draait in een scope van de updater, niet in `rememberCoroutineScope` van een scherm, ook het doorgaan na het
   scherm "onbekende apps installeren". Anders breekt wisselen van tab de download af en toont de kaart een fout.
2. **Succes zet de kaart uit.** `STATUS_SUCCESS` van de installer zet de toestand terug naar `Idle`. Leeft het proces nog (een debug-build installeert de
   release als tweede app), dan blijft de kaart anders op "Installeren…" staan.
3. **Geen herstart beloven.** Android sluit een app die zichzelf bijwerkt en start hem niet vanzelf opnieuw; ook een `MY_PACKAGE_REPLACED`-receiver
   mag het scherm niet vanuit de achtergrond openen ("Background activity launch blocked"). De tekst is daarom "De app sluit zo even, daarna is hij
   bijgewerkt". Een receiver mag hooguit achtergronddiensten weer starten. Wil een app zich toch zelf heropenen, dan doet hij dat vanuit iets dat Android
   wel een scherm laat openen (Drip: zijn toegankelijkheidsdienst), via de `InstallHook`.
4. **Stil installeren** werkt pas als de app zelf de vorige versie installeerde. Een versie die met `adb install -i ...` is neergezet telt niet als door
   de app zelf geïnstalleerd: de eerstvolgende update vraagt dan nog één keer.
5. **Tempo.** Android remt als dezelfde app zichzelf binnen ongeveer 30 seconden twee keer bijwerkt; dan komt de systeemvraag toch. De kaart handelt dat
   af: de vraag opent vanzelf (staat de app niet voorin, dan komt er een melding en opent hij bij terugkomen; de balk is dan tikbaar).
6. **Debug naast release.** Een debug-build heeft een ander package dan de release. De module telt een `-debug`-achtervoegsel niet mee bij de
   versievergelijking, maar installeert de release wel als aparte app. Een echte update zie je pas met de release over de release.
7. **iOS (TestFlight)** toont geen kaart: de app kan geen nieuwere build zien.
8. Of een stille update doorgaat terwijl de app voorin staat is niet bekeken; zo niet, dan opent de systeemvraag vanzelf.
