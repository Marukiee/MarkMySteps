# MarkMySteps

Self-hosted, open-source travel tracker — a lightweight shell over your own
[Immich](https://immich.app) server. Plan routes with drag-and-drop stops,
track your journey battery-efficiently (no Google services), import your
Polarsteps history, and relive trips on a beautiful map — without uploading
your photos twice.

## Features

- 🗺️ **Interactive map** (MapLibre + OpenFreeMap, no API keys, no Google) —
  routes per traveller, photo markers with clustering, per-person filters
- 📸 **Immich integration** — photos stay on your Immich server; MarkMySteps
  only stores asset references (id, timestamp, EXIF GPS). API keys are
  AES-256-GCM encrypted at rest
- 🔋 **Battery-friendly tracking** — Android app using AOSP location (works on
  LineageOS/GrapheneOS, no Google Play Services), GPS fix only on ≥50 m
  movement, offline buffer with idempotent sync
- 🧭 **Route planner** — stops with "X nights"; changing one stop shifts every
  later date automatically. City search with flags (Photon/OSM)
- 🧳 **Polarsteps import** — upload your "Download my data" zip: trips, full
  GPS tracks and stops come along
- 👥 **Travel together** — shared trips, combined routes and photos,
  per-person map toggles
- 🔒 **Self-hosted & locked down** — database has no host ports, single
  localhost-bound web port behind a Cloudflare Tunnel, rate limiting, Helmet

## Install (server, Linux + Docker)

```bash
git clone https://github.com/Marukiee/MarkMySteps.git && cd MarkMySteps && ./install.sh
```

The installer asks for your public URL once, generates all secrets, builds
the stack and prints the Cloudflare Tunnel settings to finish with. Default
port: `18790` (configurable via `WEB_PORT`). Update later with
`git pull && ./install.sh`; remove with `./uninstall.sh`.

Full walkthrough (Cloudflare Tunnel, Immich link, Polarsteps import, backup):
**[docs/DEPLOY.md](docs/DEPLOY.md)**

## Install (Android app)

Every push builds a debug APK via GitHub Actions:

1. [Actions](https://github.com/Marukiee/MarkMySteps/actions) → latest green
   **Android APK** run → download the `markmysteps-debug-apk` artifact
2. Install the APK on your phone (allow unknown sources)
3. Enter your server URL, log in, open a trip → **Start tracking**
4. Set location permission to **"Allow all the time"** for tracking with the
   screen off

Works without Google Play Services. The web app also runs as a PWA in any
mobile browser (tracking then requires the screen to stay on).

## Stack

| Layer    | Tech                                              |
|----------|---------------------------------------------------|
| Backend  | NestJS · Prisma · PostgreSQL 16 + PostGIS         |
| Frontend | React · Vite (PWA)                                |
| Mobile   | Capacitor (Android APK, no Google Play Services)  |
| Maps     | MapLibre GL · OpenFreeMap · Photon geocoding      |
| Deploy   | Docker Compose · Cloudflare Tunnel                |

## Development

Requirements: Node ≥ 22, pnpm, Docker. See the bottom of
[docs/DEPLOY.md](docs/DEPLOY.md) for the local setup. Architecture and
roadmap: [docs/PLAN.md](docs/PLAN.md).

## License

AGPL-3.0
