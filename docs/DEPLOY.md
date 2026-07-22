# MarkMySteps — installatie & testen

## Op je server zetten (één commando)

Vereist: Docker + docker compose (heb je al voor Immich). Alles in één keer:

```bash
cd ~ && git clone https://github.com/Marukiee/MarkMySteps.git && cd MarkMySteps && ./install.sh
```

Het script vraagt éénmalig je publieke URL (Enter = `https://reis.markmaaktmedia.nl`),
genereert alle secrets, bouwt de containers, wacht tot de API gezond is en
print daarna precies wat je in Cloudflare moet invullen.

Standaard draait de app op **poort 18790** (bewust ongebruikelijk — botst niet
met Home Assistant e.d.). Andere poort? Vóór de eerste run:
`WEB_PORT=12345 ./install.sh`, of later `WEB_PORT` in `.env` aanpassen en
`docker compose up -d` draaien.

> `.env` daarna **nooit meer weggooien of opnieuw genereren** — daar staan de
> sleutels in waarmee je logins en versleutelde Immich-keys leesbaar blijven.

Controleren:

```bash
docker compose ps                             # alle services "healthy"
curl -s http://127.0.0.1:18790/api/health     # → {"status":"ok","postgis":"3.5.7"}
```

### Cloudflare Tunnel koppelen (dashboard, geen config-bestand)

1. **Cloudflare Zero Trust** → **Networks → Tunnels** → jouw bestaande tunnel
   → tab **Public Hostname** → **Add a public hostname**
2. Subdomain: `reis` · Domain: `markmaaktmedia.nl`
3. Service type: **HTTP** · URL: `localhost:18790`
4. Opslaan — het DNS-record wordt automatisch aangemaakt.

**`localhost` letterlijk zo laten staan** — cloudflared draait op dezelfde
server als Docker, dus het wijst naar de eigen machine. Alleen als cloudflared
op een ándere machine zou draaien, vul je hier het LAN-IP van de Docker-server
in. DNS koppel je nooit aan een poort: hostname → tunnel → `localhost:18790`.

Klaar: **https://reis.markmaaktmedia.nl**

### Daarna in de app (eerste gebruik)

1. Open de site → **Account maken**.
2. **Instellingen → Immich**: server-URL (interne URL mag, bijv.
   `http://<server-ip>:2283`) + API-key (Immich → Accountinstellingen →
   API-keys) → **Verbinden**.
3. **Instellingen → Polarsteps importeren**: zip uploaden
   (polarsteps.com → Settings → Privacy → *Download my data*). Je krijgt je
   reis terug mét volledige GPS-route én stops.
4. Reis openen → kaart, tijdlijn, **Planning** (stops slepen, nachten +/−),
   **Foto's syncen**, **Start tracking**.

### Updaten naar een nieuwe versie

```bash
cd ~/MarkMySteps
git pull
docker compose up -d --build     # migraties draaien automatisch bij start
```

### Back-up (database = alle data)

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

Verwijdert alleen de MarkMySteps-containers, -images en het interne netwerk —
de rest van de server (Immich, Home Assistant, cloudflared) blijft onaangeraakt.
Het script vraagt apart of je ook het database-volume (alle data) wilt wissen;
bewaar je dat, dan pakt een nieuwe install met dezelfde `.env` je data weer op.
