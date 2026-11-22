#!/usr/bin/env bash
# Kopieert de markupdate-module van Keeper ongewijzigd naar een andere app, of controleert of die kopie nog gelijk is.
#
#   sync.sh <android-map van een app>            kopieer de module naar <map>/markupdate en schrijf markupdate/BRON
#   sync.sh --check <android-map van een app>    vergelijk <map>/markupdate met Keeper (geeft niets, wijzigt niets; stopt met fout bij verschil)
#
# "android-map" is de map met settings.gradle(.kts) van de app (bij Keeper en Tandem de map android, bij Drip en Wijzer de rootmap).
# Het script schrijft alleen binnen <map>/markupdate en past nooit de settings of build van de app aan: het drukt af wat daar nog bij moet.
# Alleen draaien vanuit Keeper (de bron), en alleen met een schone map: anders liegt BRON over welke commit erin zit.
set -euo pipefail

fail() { echo "sync.sh: $*" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MODE=sync
if [ "${1:-}" = "--check" ]; then MODE=check; shift; fi
[ $# -eq 1 ] || fail "gebruik: sync.sh [--check] <android-map van een app>"

[ ! -f "$HERE/BRON" ] || fail "dit is zelf een kopie (er staat een BRON in): wijzig en sync alleen vanuit Keeper"
[ -d "$1" ] || fail "map bestaat niet: $1"
TARGET="$(cd "$1" && pwd -P)"
[ -f "$TARGET/settings.gradle.kts" ] || [ -f "$TARGET/settings.gradle" ] || fail "geen settings.gradle(.kts) in $TARGET: geef de map met de Gradle-instellingen van de app"
[ "$TARGET/markupdate" != "$HERE" ] || fail "doel is de bron zelf"

# Wat er mee gaat en wat niet: bouwresultaten en rommel nooit; BRON beheert alleen dit script in het doel.
EXCLUDES=(--exclude build --exclude .gradle --exclude .DS_Store --exclude BRON)

if [ "$MODE" = check ]; then
  [ -d "$TARGET/markupdate" ] || fail "$TARGET/markupdate bestaat niet; nog niet gesynct"
  if diff -r -q -x build -x .gradle -x .DS_Store -x BRON "$HERE" "$TARGET/markupdate"; then
    echo "gelijk: $TARGET/markupdate is dezelfde code als Keeper"
    [ -f "$TARGET/markupdate/BRON" ] && sed -n 's/^commit: /BRON staat op commit /p' "$TARGET/markupdate/BRON"
    exit 0
  fi
  echo "VERSCHIL: $TARGET/markupdate wijkt af van Keeper (zie boven). Wijzig niet in de app: pas Keeper aan en sync opnieuw." >&2
  exit 1
fi

# Sync: de bron moet schoon en gecommit zijn, anders klopt de commit in BRON niet.
git -C "$HERE" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Keeper is geen git-checkout"
[ -z "$(git -C "$HERE" status --porcelain -- .)" ] || { git -C "$HERE" status --short -- . >&2; fail "er zijn niet-gecommitte wijzigingen in markupdate; commit eerst in Keeper"; }
COMMIT="$(git -C "$HERE" log -1 --format=%H -- .)"
[ -n "$COMMIT" ] || fail "markupdate staat nog in geen enkele commit"

mkdir -p "$TARGET/markupdate"
rsync -a --delete "${EXCLUDES[@]}" "$HERE/" "$TARGET/markupdate/"
cat > "$TARGET/markupdate/BRON" <<BRON
Deze map is een kopie. Niet aanpassen in deze app: wijzig in Keeper (android/markupdate) en sync opnieuw (zie README.md).
bron: Keeper, android/markupdate
commit: $COMMIT
gesynct: $(date -u +%Y-%m-%dT%H:%M:%SZ)
BRON

echo "gesynct: $TARGET/markupdate  (Keeper-commit ${COMMIT:0:12})"
SETTINGS="$TARGET/settings.gradle.kts"; [ -f "$SETTINGS" ] || SETTINGS="$TARGET/settings.gradle"
if ! grep -q "markupdate:core" "$SETTINGS"; then
  echo
  echo "Nog te doen in de app (dit script past dat niet aan):"
  if [[ "$SETTINGS" == *.kts ]]; then
    echo "  settings.gradle.kts:   include(\":markupdate:core\", \":markupdate:card\")   // zonder Compose alleen de kern"
  else
    echo "  settings.gradle:       include ':markupdate:core'                            // en ':markupdate:card' als de app Compose heeft"
  fi
  echo "  app/build.gradle(.kts): implementation(project(':markupdate:card'))   // of ':markupdate:core' zonder Compose"
  echo "  Application.onCreate:   MarkUpdate.init(this, MarkUpdateConfig(...))  // zie README.md"
fi
if git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git -C "$TARGET" check-ignore -q "$TARGET/markupdate/core/build/x"; then
  echo
  echo "Let op: bouwmappen van de module worden door git van deze app nog niet genegeerd. Zet in de .gitignore: markupdate/*/build/"
fi
