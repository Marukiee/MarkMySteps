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

## Op een echte iPhone

Zonder betaald Apple-account kan het alleen via Xcode en een kabel, met een
gratis Apple ID, en dan werkt de app zeven dagen. Voor vrienden zonder kabel en
zonder verlopen is een Apple Developer-account nodig (99 dollar per jaar), met
TestFlight.

## Netwerk

Net als de Android-app praat de iPhone-app alleen via https met een server,
behalve met het eigen netwerk (`NSAllowsLocalNetworking`). Een server die alleen
via `http://` op een Tailscale-adres bereikbaar is, werkt dus niet; zet er https
voor (bijvoorbeeld de Cloudflare Tunnel uit DEPLOY.md).
