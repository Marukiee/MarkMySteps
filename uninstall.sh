#!/usr/bin/env bash
# MarkMySteps uninstaller. Removes ONLY what install.sh created.
# Touches nothing else on the server (Immich, Home Assistant, cloudflared
# and other Docker projects stay untouched).
#
#   cd ~/MarkMySteps && ./uninstall.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "This removes the MarkMySteps containers, images and the internal network."
read -rp "Continue? [y/N] " answer
[[ "${answer,,}" == "y" || "${answer,,}" == "j" ]] || { echo "Cancelled."; exit 0; }

# Containers, project images and network of THIS compose project only.
docker compose down --rmi local --remove-orphans

echo
echo "The database (all your trips, routes and accounts) lives in a Docker volume."
read -rp "Remove the database volume as well? This CANNOT be undone. [y/N] " answer
if [[ "${answer,,}" == "y" || "${answer,,}" == "j" ]]; then
  docker compose down -v --remove-orphans 2>/dev/null || true
  docker volume rm markmysteps_db-data 2>/dev/null || true
  echo "→ database volume removed"
else
  echo "→ database volume kept (markmysteps_db-data); a new install"
  echo "  with the same .env picks your data up again"
fi

echo
echo "✔ Done. To remove everything, you still have to do this by hand:"
echo "  - Cloudflare: remove the Public Hostname of this app from your tunnel"
echo "  - Remove this folder: rm -rf $(pwd)"
echo "    (note: that also removes .env with your encryption keys."
echo "     Without that file a kept database volume can no longer be used)"
