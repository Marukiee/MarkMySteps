# MarkMySteps

Self-hosted, open-source travel tracker — a lightweight shell over your own
[Immich](https://immich.app) server. Plan routes, track your journey
battery-efficiently, and relive trips on a beautiful map, without uploading
your photos twice.

> Status: **M1 — foundation**. See [`docs/PLAN.md`](docs/PLAN.md) for the full
> architecture and roadmap.

## Stack

| Layer    | Tech                                              |
|----------|---------------------------------------------------|
| Backend  | NestJS · Prisma · PostgreSQL 16 + PostGIS         |
| Frontend | React · Vite (PWA)                                |
| Mobile   | Capacitor (Android APK, no Google Play Services)  |
| Maps     | MapLibre GL · Protomaps PMTiles                   |
| Deploy   | Docker Compose · Cloudflare Tunnel                |

## Development

Requirements: Node ≥ 22, pnpm ≥ 9, Docker.

```bash
# 1. Install dependencies
pnpm install

# 2. Start the dev database (PostGIS on 127.0.0.1:5432)
docker compose -f docker-compose.dev.yml up -d

# 3. Configure the API
cp .env.example apps/api/.env
#    → set DATABASE_URL to postgresql://markmysteps:dev-only-password@localhost:5432/markmysteps?schema=public
#    → generate JWT_SECRET (openssl rand -base64 48)
#    → generate MASTER_ENCRYPTION_KEY (openssl rand -base64 32)

# 4. Apply migrations & generate the Prisma client
pnpm --filter @markmysteps/api db:generate
pnpm --filter @markmysteps/api db:deploy

# 5. Run API (localhost:3000) + web (localhost:5173)
pnpm dev
```

## Production

```bash
cp .env.example .env   # fill in real secrets
docker compose up -d --build
```

The stack exposes exactly one port: `127.0.0.1:8080` (web + API proxy), meant
to be published through a Cloudflare Tunnel. The database has **no** host
ports and lives on an internal Docker network only.

## License

AGPL-3.0
