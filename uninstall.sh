#!/usr/bin/env bash
# MarkMySteps uninstaller — removes ONLY what install.sh created.
# Touches nothing else on the server (Immich, Home Assistant, cloudflared
# and other Docker projects stay untouched).
#
#   cd ~/MarkMySteps && ./uninstall.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "Dit verwijdert de MarkMySteps-containers, -images en het interne netwerk."
read -rp "Doorgaan? [j/N] " answer
[[ "${answer,,}" == "j" ]] || { echo "Afgebroken."; exit 0; }

# Containers, project images and network of THIS compose project only.
docker compose down --rmi local --remove-orphans

echo
echo "De database (al je reizen, routes en accounts) staat in een Docker-volume."
read -rp "Database-volume óók verwijderen? Dit is ONOMKEERBAAR. [j/N] " answer
if [[ "${answer,,}" == "j" ]]; then
  docker compose down -v --remove-orphans 2>/dev/null || true
  docker volume rm markmysteps_db-data 2>/dev/null || true
  echo "→ database-volume verwijderd"
else
  echo "→ database-volume bewaard (markmysteps_db-data); een nieuwe install"
  echo "  met dezelfde .env pakt je data gewoon weer op"
fi

echo
echo "✔ Klaar. Handmatig nog te doen als je álles weg wilt:"
echo "  - Cloudflare: Public Hostname 'reis.markmaaktmedia.nl' verwijderen uit je tunnel"
echo "  - Deze map verwijderen: rm -rf $(pwd)"
echo "    (let op: daarmee verdwijnt ook .env met je encryptiesleutels —"
echo "     zonder dat bestand is een bewaard database-volume niet meer bruikbaar)"
