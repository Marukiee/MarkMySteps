# MarkMySteps — installatie & testen

## Op je server zetten (exacte stappen)

Kopieer dit blok regel voor regel (of in één keer) op je Ubuntu-server.
Vereist: Docker + docker compose (heb je al voor Immich).

```bash
# 1. Code ophalen
cd ~
git clone https://github.com/Marukiee/MarkMySteps.git
cd MarkMySteps

# 2. Secrets genereren en .env schrijven (één keer; daarna nooit meer aanpassen,
#    anders kun je bestaande versleutelde API-keys en logins niet meer lezen!)
DB_PASS=$(openssl rand -hex 24)
cat > .env <<EOF
NODE_ENV=production
API_PORT=3000
WEB_ORIGIN=https://reis.markmaaktmedia.nl
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=markmysteps
POSTGRES_USER=markmysteps
POSTGRES_PASSWORD=${DB_PASS}
DATABASE_URL=postgresql://markmysteps:${DB_PASS}@db:5432/markmysteps?schema=public
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d
MASTER_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
EOF
chmod 600 .env

# 3. Bouwen en starten (eerste keer duurt een paar minuten)
docker compose up -d --build

# 4. Controleren
docker compose ps                            # alle services "healthy"
curl -s http://127.0.0.1:8080/api/health     # → {"status":"ok","postgis":"3.5.7"}
```

> `WEB_ORIGIN` hierboven aanpassen als je een ander subdomein kiest.

### Cloudflare Tunnel koppelen (dashboard, geen config-bestand)

Je beheert je tunnel via het Cloudflare-dashboard, dus:

1. **Cloudflare Zero Trust** → **Networks → Tunnels** → jouw bestaande tunnel
   → tab **Public Hostname** → **Add a public hostname**
2. Subdomain: `reis` · Domain: `markmaaktmedia.nl`
3. Service type: **HTTP** · URL: `localhost:8080`
4. Opslaan — het DNS-record wordt automatisch aangemaakt.

DNS koppel je nooit aan een poort: hostname → tunnel → `localhost:8080` op de
server waar cloudflared en Docker draaien.

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
