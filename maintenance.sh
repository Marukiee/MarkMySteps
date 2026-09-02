#!/usr/bin/env bash
# Put the "back in a minute" page up, or take it down again.
#
#   ./maintenance.sh aan   — de site gaat uit, de onderhoudspagina komt ervoor
#   ./maintenance.sh uit   — de site komt terug
#
# install.sh does this on its own around a deploy; this is for the times you
# are doing something to the server by hand and would rather visitors saw a
# page than a browser error.
set -euo pipefail
cd "$(dirname "$0")"

case "${1:-}" in
  aan | on)
    docker compose --profile maintenance build maintenance
    docker compose stop web >/dev/null 2>&1 || true
    docker compose --profile maintenance up -d maintenance
    echo "✔ Onderhoudspagina staat online."
    ;;
  uit | off)
    # Stopped is not enough: a stopped container still holds its port binding.
    docker compose --profile maintenance stop maintenance >/dev/null 2>&1 || true
    docker compose --profile maintenance rm -f maintenance >/dev/null 2>&1 || true
    docker compose up -d
    echo "✔ De site is weer online."
    ;;
  *)
    echo "Gebruik: ./maintenance.sh aan|uit" >&2
    exit 1
    ;;
esac
