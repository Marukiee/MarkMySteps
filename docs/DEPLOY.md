# MarkMySteps — installatie & testen

## Lokaal testen (ontwikkel-modus)

Vereisten: Node ≥ 22, pnpm, Docker.

```bash
git clone https://github.com/Marukiee/MarkMySteps.git
cd MarkMySteps
pnpm install

# 1. Dev-database starten (PostGIS, alleen op 127.0.0.1)
docker compose -f docker-compose.dev.yml up -d

# 2. API-configuratie
cp .env.example apps/api/.env
# In apps/api/.env:
#   DATABASE_URL=postgresql://markmysteps:dev-only-password@localhost:5432/markmysteps?schema=public
#   JWT_SECRET=$(openssl rand -base64 48)
#   MASTER_ENCRYPTION_KEY=$(openssl rand -base64 32)

# 3. Database-migraties + Prisma-client
pnpm --filter @markmysteps/api db:generate
pnpm --filter @markmysteps/api db:deploy

# 4. Starten (API :3000 + web :5173)
pnpm dev
```

Open <http://localhost:5173>:

1. **Account maken** → registreren met e-mail + wachtwoord (min. 10 tekens).
2. **Instellingen → Immich** → server-URL + API-key invullen (Immich →
   Accountinstellingen → API-keys). Key wordt gevalideerd en versleuteld
   opgeslagen.
3. **Reis aanmaken** met de datums van een periode waarin je foto's hebt →
   open de reis → **"Foto's syncen"**. Foto's met GPS verschijnen op de kaart,
   alles op de tijdlijn.
4. **Polarsteps importeren**: Instellingen → Polarsteps → zip uploaden
   (polarsteps.com → Settings → Privacy → "Download my data").
5. **Routepunt toevoegen**: open een reis → "+ Routepunt" → klik op de kaart →
   tijdstip kiezen → opslaan.

## Productie (Ubuntu-server + Cloudflare Tunnel)

```bash
git clone https://github.com/Marukiee/MarkMySteps.git
cd MarkMySteps

cp .env.example .env
nano .env      # échte secrets invullen:
# POSTGRES_PASSWORD=$(openssl rand -base64 24)
# DATABASE_URL   → zelfde wachtwoord, host 'db'
# JWT_SECRET=$(openssl rand -base64 48)
# MASTER_ENCRYPTION_KEY=$(openssl rand -base64 32)
# WEB_ORIGIN=https://<jouw-subdomein>.markmaaktmedia.nl

docker compose up -d --build
```

Wat er dan draait:

| Service | Poort | Bereikbaar |
|---------|-------|-----------|
| `db` (PostGIS) | — | alleen intern Docker-netwerk, géén host-poort |
| `api` (NestJS) | — | alleen intern; migraties draaien automatisch bij start |
| `web` (nginx) | `127.0.0.1:8080` | alleen localhost — voor de tunnel |

### Cloudflare Tunnel

In je bestaande `cloudflared`-config (`~/.cloudflared/config.yml`) een
ingress-regel toevoegen:

```yaml
ingress:
  - hostname: reis.markmaaktmedia.nl   # kies je subdomein
    service: http://127.0.0.1:8080
  # ... bestaande regels ...
  - service: http_status:404
```

DNS-record aanmaken: `cloudflared tunnel route dns <tunnel-naam> reis.markmaaktmedia.nl`
en cloudflared herstarten. Klaar — de app draait op https://reis.markmaaktmedia.nl.

### Controleren

```bash
curl -s http://127.0.0.1:8080/api/health
# → {"status":"ok","postgis":"3.5.7"}
docker compose ps          # alles "healthy"
docker compose logs -f api # live logs
```

### Updaten

```bash
git pull
docker compose up -d --build   # migraties draaien automatisch
```

### Back-ups

Alle data zit in het Docker-volume `markmysteps_db-data`:

```bash
docker compose exec db pg_dump -U markmysteps markmysteps | gzip > backup-$(date +%F).sql.gz
```
