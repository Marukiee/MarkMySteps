#!/usr/bin/env bash
# MarkMySteps one-shot installer/updater.
#
#   git clone https://github.com/Marukiee/MarkMySteps.git && cd MarkMySteps && ./install.sh
#
# Re-running is safe: an existing .env is never touched (it holds the
# encryption keys for your data), and the containers are simply rebuilt.
set -euo pipefail
cd "$(dirname "$0")"

WEB_PORT="${WEB_PORT:-18790}"
FIRST_INSTALL=false

if [[ ! -f .env ]]; then
  FIRST_INSTALL=true
  WEB_ORIGIN=""
  while [[ -z "$WEB_ORIGIN" ]]; do
    read -rp "Public URL of the app (for example https://trips.example.com): " WEB_ORIGIN
  done

  DB_PASS=$(openssl rand -hex 24)
  cat > .env <<EOF
NODE_ENV=production
API_PORT=3000
WEB_PORT=${WEB_PORT}
WEB_ORIGIN=${WEB_ORIGIN}
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
# Immich on a private address (192.168.x.x, 10.x.x.x, ...)? Allow its host here:
# IMMICH_ALLOWED_HOSTS=192.168.1.50
EOF
  chmod 600 .env
  echo "→ .env created with fresh secrets (keep this file safe!)"
else
  echo "→ existing .env found, secrets stay unchanged"
  # Pick up the port from the existing .env for the final message.
  WEB_PORT=$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || true)
  WEB_PORT="${WEB_PORT:-18790}"
fi

# The images are built BEFORE anything is stopped, so a build that fails (or
# takes ten minutes) never costs a second of uptime: the old containers keep
# serving the whole time.
echo "→ building new images (the site keeps running meanwhile)…"
docker compose build
docker compose --profile maintenance build maintenance

# From here the app really is going down, so put a page in its place. The
# maintenance container binds the same port, which is why web has to go first.
echo "→ putting the maintenance page up…"
docker compose stop web >/dev/null 2>&1 || true
docker compose --profile maintenance up -d maintenance

echo "→ replacing database and API…"
docker compose up -d --remove-orphans db api

# The API has no host port of its own, and its usual way in is answering 503
# right now, so the container's own healthcheck is what gets asked.
echo "→ waiting for the API to be healthy…"
API_OK=false
for _ in $(seq 1 60); do
  API_CID=$(docker compose ps -q api || true)
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$API_CID" 2>/dev/null || echo starting)
  if [[ "$STATUS" == healthy ]]; then
    API_OK=true
    break
  fi
  sleep 2
done

if [[ "$API_OK" != true ]]; then
  echo "✗ API not healthy after 2 minutes. Check: docker compose logs api" >&2
  echo "  The maintenance page stays up until this is fixed." >&2
  exit 1
fi

# Hand the port back. `rm -f` as well as `stop`: a container that is only
# stopped still holds its port binding when web comes back up.
echo "→ bringing the site back online…"
docker compose --profile maintenance stop maintenance
docker compose --profile maintenance rm -f maintenance
docker compose up -d web

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    echo
    echo "✔ MarkMySteps is running at http://127.0.0.1:${WEB_PORT}"
    if [[ "$FIRST_INSTALL" == true ]]; then
      echo
      echo "Next step (once): Cloudflare Zero Trust > Networks > Tunnels"
      echo "> your tunnel > Public Hostname > Add:"
      echo "    subdomain:  the one in ${WEB_ORIGIN}"
      echo "    domain:     your own domain"
      echo "    service:    HTTP > <LAN IP of this server>:${WEB_PORT}"
      echo "    (the LAN IP is needed because cloudflared often runs in Docker; check: hostname -I)"
    fi
    exit 0
  fi
  sleep 2
done

echo "✗ Web container not reachable. Check: docker compose logs web" >&2
exit 1
