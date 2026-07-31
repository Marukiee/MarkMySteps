# MarkMySteps: installatie & testen

## Op je server zetten (één commando)

Vereist: Docker + docker compose (heb je al voor Immich). Alles in één keer:

```bash
cd ~ && git clone https://github.com/Marukiee/MarkMySteps.git && cd MarkMySteps && ./install.sh
```

Het script vraagt éénmalig je publieke URL (Enter = `https://reis.markmaaktmedia.nl`),
genereert alle secrets, bouwt de containers, wacht tot de API gezond is en
print daarna precies wat je in Cloudflare moet invullen.

Standaard draait de app op **poort 18790** (bewust ongebruikelijk, botst niet
met Home Assistant e.d.). Andere poort? Vóór de eerste run:
`WEB_PORT=12345 ./install.sh`, of later `WEB_PORT` in `.env` aanpassen en
`docker compose up -d` draaien.

> `.env` daarna **nooit meer weggooien of opnieuw genereren**: daar staan de
> sleutels in waarmee je logins en versleutelde Immich-keys leesbaar blijven.

Controleren:

```bash
docker compose ps                             # alle services "healthy"
curl -s http://127.0.0.1:18790/api/health     # → {"status":"ok","postgis":"3.5.7"}
```

## De server openbaar krijgen

Na `install.sh` draait alles op `http://<server-ip>:18790`, alleen op je eigen
netwerk. Om er van buiten bij te kunnen (en om de Android-app te laten werken)
heb je een publieke HTTPS-URL nodig. Drie manieren, van makkelijk naar meer werk.

### 1. Cloudflare Tunnel (aanbevolen)

Geen open poorten in je router, gratis HTTPS-certificaat, werkt achter CGNAT.
Je hebt een domein nodig dat bij Cloudflare staat.

Heb je nog geen tunnel:

```bash
# op de server
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login          # opent een browserlink, kies je domein
```

Daarna via het dashboard, zonder config-bestand:

1. **Cloudflare Zero Trust** > **Networks > Tunnels** > je tunnel
   > tab **Public Hostname** > **Add a public hostname**
2. Subdomain: bijvoorbeeld `reis` · Domain: je eigen domein
3. Service type: **HTTP** · URL: `localhost:18790`
4. Opslaan. Het DNS-record wordt automatisch aangemaakt.

**`localhost` letterlijk zo laten staan**: cloudflared draait op dezelfde
server als Docker, dus het wijst naar de eigen machine. Alleen als cloudflared
op een andere machine draait, vul je hier het LAN-IP van de Docker-server in.
DNS koppel je nooit aan een poort: hostname > tunnel > `localhost:18790`.

Zet daarna dezelfde URL in `.env` bij `WEB_ORIGIN` (komma-gescheiden als je er
meerdere hebt) en draai `docker compose up -d`. Zonder dat weigert de API de
requests van je eigen site, want CORS staat op een allowlist.

Klaar: `https://reis.jouwdomein.nl`

Wil je er ook Cloudflare Access voor zetten, dan kan dat, maar houd er rekening
mee dat de Android-app dan niet meer bij de API kan: die stuurt geen
browser-login mee.

#### Waar je tegenaan loopt

Een tunnel is gratis en ongelimiteerd in verkeer, maar er zitten grenzen aan
wat er doorheen mag. Deze gelden voor het gratis plan; Cloudflare verandert ze
af en toe, dus check ze in hun docs als iets niet werkt.

| Grens | Waarde | Wat je merkt |
| --- | --- | --- |
| Grootte van één upload | 100 MB | Een grotere Polarsteps-zip wordt geweigerd met een 413 |
| Tijd tot je server begint te antwoorden | 100 seconden | Duurt een import langer, dan krijg je foutcode 524 |
| Aantal tunnels per account | 1000 | Ruim voldoende |
| Hostnames per tunnel | onbeperkt | Immich en MarkMySteps kunnen door dezelfde tunnel |

De zip-import zit met zijn eigen 100 MB precies op die eerste grens. Zit je
export daarboven, dan zijn er twee uitwegen: importeren terwijl je thuis op
`http://<server-ip>:18790` zit (de tunnel wordt dan niet gebruikt), of de zip
splitsen.

Let ook op de gebruiksvoorwaarden: video's in bulk door het gratis netwerk
pompen is volgens Cloudflare niet de bedoeling. MarkMySteps streamt video's uit
je Immich-server door de tunnel heen, dus als je daar veel filmpjes in hebt
staan en je kijkt ze veel van buitenaf terug, kies dan liever de reverse proxy
hieronder of een VPN.

### 2. Reverse proxy met eigen certificaat

Draai je al Caddy, Nginx Proxy Manager of Traefik, dan wijs je die naar
`localhost:18790`. Caddy is één regel:

```
reis.jouwdomein.nl {
	reverse_proxy localhost:18790
}
```

Poort 80 en 443 moeten dan wel open staan in je router. Ook hier: `WEB_ORIGIN`
in `.env` op je publieke URL zetten.

### 3. Alleen op je eigen netwerk

Kan ook: laat de poort dicht en gebruik `http://<server-ip>:18790` thuis, of
via je eigen VPN (WireGuard, Tailscale). Tracking blijft dan gewoon werken:
de app buffert alles wat hij onderweg opneemt en uploadt het zodra je weer
binnen bereik bent.

## Limieten

De server is bedoeld voor jou en je reisgenoten, niet voor het open internet.
Dat zie je terug in de grenzen die vastliggen:

| Wat | Grens |
| --- | --- |
| Alle verzoeken samen | 300 per minuut, per sessie (per IP zonder login) |
| Inloggen, registreren, wachtwoord wijzigen | 5 per minuut |
| Deel-link openen met wachtwoord | 10 per minuut |
| Deel-link aanmaken | 10 per minuut |
| Foto's synchroniseren | 6 per minuut per reis |
| Trackpunten uploaden | 30 per minuut (bundels van 500 punten) |
| Thumbnails | 600 per minuut (1200 op een deelpagina) |
| Video's | 120 per minuut |
| Openstaande registratieverzoeken | 15 tegelijk |
| Profielfoto | 2 MB |
| Polarsteps-zip | 100 MB |
| Toegangstoken | 15 minuten (ververst zichzelf) |
| Onthoud-mij | 30 dagen |
| Deel-link-sessie | 7 dagen, en meteen weg als je de link intrekt |

Verder: de database heeft geen poort naar buiten, foto's blijven op je
Immich-server (MarkMySteps bewaart alleen verwijzingen), en je Immich-API-key
gaat versleuteld de database in met de sleutel uit `.env`.

## Daarna in de app (eerste gebruik)

1. Open de site → **Account maken**.
2. **Instellingen → Immich**: server-URL (interne URL mag, bijv.
   `http://<server-ip>:2283`) + API-key (Immich → Accountinstellingen →
   API-keys) → **Verbinden**.
3. **Instellingen → Polarsteps importeren**: zip uploaden
   (polarsteps.com → Settings → Privacy → *Download my data*). Je krijgt je
   reis terug mét volledige GPS-route én stops.
4. Reis openen → kaart, tijdlijn, **Planning** (stops slepen, nachten +/−),
   **Foto's syncen**, **Start tracking**.

## Updaten naar een nieuwe versie

```bash
cd ~/MarkMySteps
git pull
docker compose up -d --build     # migraties draaien automatisch bij start
```

## Back-up (database = alle data)

```bash
cd ~/MarkMySteps
docker compose exec db pg_dump -U markmysteps markmysteps | gzip > ~/mms-backup-$(date +%F).sql.gz
```

---

## Android-app (APK) installeren

De APK wordt automatisch gebouwd door GitHub Actions bij elke push:

1. Ga naar https://github.com/Marukiee/MarkMySteps/actions → workflow
   **Android APK** → nieuwste groene run → onderaan bij **Artifacts**:
   `markmysteps-debug-apk` downloaden.
2. Zip uitpakken → `app-debug.apk` naar je telefoon (of direct op de telefoon
   downloaden) → installeren ("onbekende bronnen" toestaan).
3. App openen → **Server-URL** invullen: `https://reis.markmaaktmedia.nl` →
   inloggen met je account.
4. Reis openen → **Start tracking**. Geef locatietoestemming en zet die daarna
   in Android-instellingen → Apps → MarkMySteps → Locatie op
   **"Altijd toestaan"** (nodig voor tracking met scherm uit).

Batterijgedrag: de app vraagt alleen een GPS-fix bij ≥50 m verplaatsing,
buffert offline in de app en upload zodra er weer netwerk is. Werkt zonder
Google Play Services (LineageOS / GrapheneOS).

---

## Lokaal ontwikkelen

```bash
git clone https://github.com/Marukiee/MarkMySteps.git
cd MarkMySteps
pnpm install
docker compose -f docker-compose.dev.yml up -d

cat > apps/api/.env <<EOF
DATABASE_URL=postgresql://markmysteps:dev-only-password@localhost:5432/markmysteps?schema=public
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d
MASTER_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
WEB_ORIGIN=http://localhost:5173
API_PORT=3000
EOF

pnpm --filter @markmysteps/api db:generate
pnpm --filter @markmysteps/api db:deploy
pnpm dev        # API :3000 + web :5173
```

---

## Verwijderen (uninstall)

```bash
cd ~/MarkMySteps && ./uninstall.sh
```

Verwijdert alleen de MarkMySteps-containers, -images en het interne netwerk;
de rest van de server (Immich, Home Assistant, cloudflared) blijft onaangeraakt.
Het script vraagt apart of je ook het database-volume (alle data) wilt wissen;
bewaar je dat, dan pakt een nieuwe install met dezelfde `.env` je data weer op.
