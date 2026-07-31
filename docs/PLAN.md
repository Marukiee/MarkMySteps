# MarkMySteps: architectuur & Gefaseerd Plan

Self-hosted, open-source Polarsteps-alternatief. Backend + PWA + Android APK.
Werkt als schil over een externe Immich-server (foto's blijven in Immich).

---

## 0. Vastgestelde keuzes

| Onderdeel | Keuze | Reden |
|-----------|-------|-------|
| Backend | **NestJS + TypeScript** | Modulair, DI, guards/Helmet ingebouwd |
| Frontend | **React + Vite + TypeScript** | Grootste ecosysteem voor kaart/animatie/Capacitor |
| Mobiel | **Capacitor** (web-codebase → PWA + Android APK) | Één codebase, native background-geolocation |
| DB | **PostgreSQL 16 + PostGIS** | Geo-opslag/query, lijn-simplificatie |
| ORM | **Prisma** + rauwe PostGIS-queries waar nodig | Type-safe, injectie-veilig |
| Kaart | **MapLibre GL JS** (geen Mapbox) | Open source, geen vendor lock-in |
| Tiles | **Protomaps PMTiles** (self-hosted single file) | Offline-capabel, geen Google, geen API-key |
| Deploy | Docker Compose op Ubuntu + Cloudflare Tunnel | Zoals gevraagd |

### Harde constraint: GEEN Google Play Services
Doeltoestellen: Xperia 1 VI (LineageOS de-Googled), Pixel 10 Pro (GrapheneOS).
Geen GMS/microG gegarandeerd aanwezig. Gevolg:
- **Geen** `FusedLocationProviderClient`, **geen** Google Maps SDK, **geen** FCM push.
- Locatie via **AOSP `LocationManager`** (GPS/network provider).
- Battery-efficiëntie via **`TYPE_SIGNIFICANT_MOTION`** hardware-sensor (AOSP, geen GMS) +
  `distanceFilter`, i.p.v. Google's activity recognition.
- Foreground service met persistente notificatie (verplicht op Android 12+ voor
  betrouwbare achtergrond-tracking; GrapheneOS staat dit toe mits notificatie).
- Push (indien nodig): **UnifiedPush** (open source), niet FCM.

---

## 1. Repo-structuur (monorepo, pnpm workspaces)

```
markmysteps/
├─ apps/
│  ├─ api/            # NestJS backend
│  ├─ web/            # React + Vite PWA (ook gewrapt door Capacitor)
│  └─ mobile/         # Capacitor config + Android project + native plugin(s)
├─ packages/
│  ├─ shared/         # gedeelde types, zod-schemas, API-client
│  └─ geo/            # geo-helpers (simplificatie, afstand) gedeeld web/native
├─ docker/            # Dockerfiles, compose, tile-server
├─ docs/              # dit plan, API-spec, DB-schema
└─ docker-compose.yml
```

Modules NestJS: `auth`, `users`, `trips`, `stops` (planner), `tracking`,
`immich`, `sharing`, `media` (metadata-only), `common` (crypto, guards, config).

---

## 2. Datamodel (kern)

- **User**: account, wachtwoord-hash (argon2), rol.
- **ImmichConnection**: per user: `serverUrl`, `apiKeyEncrypted` (AES-256-GCM,
  master-key uit `.env`), laatste sync-cursor.
- **Trip**: titel, start/eind, eigenaar. Many-to-many **TripMember** (samen reizen).
- **Stop**: trip-stop met `nights`, volgorde-index, locatie (PostGIS `Point`),
  afgeleide `arrivalDate`/`departureDate` (herberekend bij verschuiving).
- **LocationPoint**: `userId`, `tripId`, `geom Point`, `recordedAt`, accuracy,
  `batchId` (offline-sync). Geïndexeerd op tijd + GIST op geom.
- **MediaRef**: `immichAssetId`, `userId`, `tripId`, `takenAt`, `geom` (EXIF-GPS).
  **Nooit** fysieke media; enkel metadata.
- **ShareLink**: `slugHash`, optionele `passwordHash`, read-only scope.

Belangrijk: alle "who"-filtering op de kaart draait op `userId` in
`LocationPoint`/`MediaRef` → frontend-toggle stuurt user-filter naar API.

---

## 3. Battery-zuinige tracking (het hart)

**Client (native, Capacitor plugin):**
1. Foreground service + notificatie tijdens actieve trip.
2. Significant-motion sensor triggert een GPS-fix (geen continue GPS).
3. `distanceFilter` (bv. 50–100 m) + min-tijd tussen fixes.
4. Fixes lokaal in SQLite bufferen (offline).
5. Batch-upload zodra netwerk beschikbaar; idempotent via `batchId`.

**Server:** ontvangt batches, dedupe, slaat op als PostGIS points, ruwe punten
worden bij ophalen gesimplificeerd (`ST_SimplifyPreserveTopology`) per zoomniveau.

**Plugin-keuze:** eerst `@capacitor-community/background-geolocation` (MIT, AOSP
LocationManager, geen GMS). Later evt. dunne eigen native laag voor
`TYPE_SIGNIFICANT_MOTION` als de community-plugin te veel GPS gebruikt.

---

## 4. Immich-integratie

- Config in-app (server-URL + API-key), key **AES-256-GCM encrypted at rest**.
- Cron/interval-job: per actieve trip Immich `/search` op datumrange bevragen.
- Sla enkel `assetId`, `takenAt`, EXIF-GPS op als `MediaRef`.
- Thumbnails: proxy-endpoint dat live via Immich API streamt met de (ontsleutelde,
  in-memory) key, niets cachen op disk. Rate-limited.

---

## 5. Security & Deploy

- Helmet, CORS-allowlist, rate-limiting (`@nestjs/throttler`).
- `trust proxy` correct → `X-Forwarded-For`/`-Proto` van Cloudflare Tunnel.
- Postgres: **geen** `ports:` mapping, enkel intern Docker-netwerk.
- Docker `deploy.resources.limits` (cpu/memory) op elke service.
- Secrets via `.env` (master-key, DB-pass); nooit in image.
- Deellinks: gehashte slug + optioneel argon2-wachtwoord, read-only.

---

## 6. Milestones

**M1: Fundament**
Monorepo, docker-compose (postgres+postgis, api, web), NestJS skeleton, Prisma
schema + migraties, auth (register/login/JWT), gebruikers. Health checks.

**M2: Immich + media-metadata**
ImmichConnection CRUD + AES-encryptie, sync-job, MediaRef, thumbnail-proxy.

**M3: Tracking**
LocationPoint API (batch-ingest, idempotent), PostGIS-simplificatie-endpoint,
Capacitor Android-app met background-geolocation + offline SQLite-buffer.

**M4: Kaart & tijdlijn**
MapLibre + PMTiles, gecombineerde routes/foto's, per-persoon toggle-filter,
premium tijdlijn-UI (hero-images, animaties).

**M5: Routeplanner**
Drag-and-drop stops, "X nachten" → auto-datums, cascade-verschuiving.

**M6: Deellinks & hardening**
Publieke read-only shares (hash+wachtwoord), security-headers audit,
resource-limits, Cloudflare Tunnel-config, release-APK build.

---

## 7. Openstaande vragen (voor later)
- Multi-user: alle reizigers op **één** server-account-systeem (aangenomen: ja),
  of federatie tussen aparte servers? → aangenomen: één server, meerdere accounts.
- Push nodig in v1? (UnifiedPush) of eerst zonder.
- Offline kaart-tiles vooraf downloaden per regio? (nice-to-have M4+).
