# iPhone-app

De iPhone-app is dezelfde web-app als de Android-app, in een eigen iOS-schil
(Capacitor). Alles wat de telefoon zelf moet doen, zit in Swift en heeft
dezelfde naam en dezelfde functies als op Android, zodat de webcode één
interface aanroept:

| Plugin | Wat het op iOS doet |
|---|---|
| `MmsLocation` | Route-tracking met CoreLocation: één GPS-meting per interval, ook met het scherm uit ("Altijd"). Een zuinige stroom op zendmasten en wifi houdt de app wakker; start iOS de app opnieuw na een grote verplaatsing, dan gaat tracking vanzelf verder. |
| `MmsGallery` | Foto's uit de fotobibliotheek (PhotoKit), op datum gekoppeld aan een reis, met hun locatie. Ze komen in de WebView via het `mmsphoto:`-adres (`PhotoSchemeHandler`). |
| `MmsNotify` | Meldingen van de app zelf, plus de controle op nieuwe berichten op de achtergrond (BGAppRefreshTask). iOS bepaalt wanneer die draait, dus minder stipt dan het kwartier op Android. |
| `MmsExport` | Back-ups in de map van de app (zichtbaar in de Bestanden-app), met het deelscherm erbij. |
| `MmsHaptics` | De trillingen bij lang drukken, vastklikken en drempels. |
| `MmsDynamicColor` | Antwoordt "niet beschikbaar": iOS heeft geen achtergrondkleuren om te lenen. |
| `MmsTabBar` | Alleen iOS: de tabbalk is die van het systeem (UITabBar), in Liquid Glass. De tabbalk van de pagina blijft onzichtbaar in de layout en bepaalt welk tabblad aan staat en of de balk er is (`nativeTabBar.ts`). |
| `MmsGlass` | Alleen iOS 26 en later: de vaste zwevende knoppen (terug, de knoppen van de reis, terug naar boven) in echt glas, verwante knoppen samen in één capsule (`nativeGlass.ts`). Knoppen die met de pagina meeschuiven blijven van de pagina zelf. |

De update-banner en "Check op updates" zijn er alleen voor de APK.

## Bouwen en testen

Nodig: een Mac met Xcode.

```bash
pnpm install
pnpm --filter @markmysteps/web build
pnpm --filter @markmysteps/web exec cap sync ios
open apps/web/ios/App/App.xcodeproj
```

Kies in Xcode een iPhone-simulator en druk op Run. Na elke wijziging in de
webcode: opnieuw `build` en `cap sync ios`.

Vanaf de command line:

```bash
cd apps/web/ios/App
xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath ../../build-ios build
```

## Op een echte iPhone: TestFlight

Vrienden testen de app via TestFlight, de test-app van Apple. Elke push naar
`main` die de app raakt, bouwt een nieuwe versie en zet die daar klaar
(`.github/workflows/ios-testflight.yml`), zoals de Android-workflow een APK
maakt. Zonder de geheimen hieronder slaat de workflow zichzelf over.

Eenmalig:

1. **Apple Developer Program**: aanmelden op developer.apple.com/programs met
   je Apple ID, als particulier (99 dollar per jaar). Je **Team ID** staat daarna
   onder Account, Membership details.
2. **App aanmaken** in App Store Connect (appstoreconnect.apple.com), Apps, het
   plusteken: platform iOS, bundle-ID `nl.markmaaktmedia.markmysteps` (staat die
   er nog niet tussen, registreer hem onder Certificates, Identifiers & Profiles).
3. **API-sleutel**: App Store Connect, Users and Access, Integrations, App Store
   Connect API, Team Keys. Maak een sleutel met de rol **Admin** (daarmee mag
   Xcode in de workflow zelf de certificaten regelen). Download het `.p8`-bestand
   meteen: dat kan maar één keer. Noteer de **Key ID** en bovenaan de
   **Issuer ID**.
4. **Geheimen in GitHub**: repo, Settings, Secrets and variables, Actions:

   | Naam | Waarde |
   |---|---|
   | `APPLE_TEAM_ID` | het Team ID uit stap 1 |
   | `APPSTORE_API_KEY_ID` | de Key ID |
   | `APPSTORE_API_ISSUER_ID` | de Issuer ID |
   | `APPSTORE_API_KEY_P8` | de inhoud van het `.p8`-bestand (of base64 ervan) |

5. **Eerste build**: Actions, iOS TestFlight, Run workflow (of een push naar
   `main`). Na een kwartiertje verwerken staat hij in App Store Connect onder
   TestFlight.
6. **Testers**: TestFlight, External Testing, een groep maken, de build
   toevoegen en **Public Link** aanzetten. De eerste build van een groep keurt
   Apple kort (meestal binnen een dag). Vul daarvoor bij Test Information een
   korte beschrijving en een e-mailadres in, en leg bij de review uit dat de app
   je route vastlegt op de achtergrond, alleen tijdens een reis die je zelf
   start.

Vrienden installeren de app TestFlight, openen de link en krijgen MarkMySteps.
Nieuwe builds komen als update binnen. Een build werkt 90 dagen.

Het buildnummer is het nummer van de workflow-run; de versie staat in Xcode
(`MARKETING_VERSION`). Het privacy-manifest dat Apple bij elke upload eist, is
`App/PrivacyInfo.xcprivacy`.

Zonder betaald account kan de app alleen op je eigen iPhone, via een kabel en
Xcode, en dan werkt hij zeven dagen.

## Netwerk

Net als de Android-app praat de iPhone-app alleen via https met een server,
behalve met het eigen netwerk (`NSAllowsLocalNetworking`). Een server die alleen
via `http://` op een Tailscale-adres bereikbaar is, werkt dus niet; zet er https
voor (bijvoorbeeld de Cloudflare Tunnel uit DEPLOY.md).
