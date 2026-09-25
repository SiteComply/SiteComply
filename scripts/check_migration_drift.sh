#!/usr/bin/env bash
# CAN prisma/migrations ACTUALLY REBUILD THE DATABASE?
#
# For months it could not, and nothing said so. Five enums, five tables and three
# columns existed only in schema.prisma because the features that needed them were
# applied to production out of band. Production was fine; a new developer, a
# staging instance and a disaster-recovery rebuild were not, and the symptom when
# it finally surfaced was a seed failing on an enum value.
#
# The check: build the schema from the migration history alone and diff it against
# schema.prisma. Anything other than empty is drift.
#
# This needs a scratch database to build into and throws it away afterwards.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."

SHADOW_DB="${MIGRATION_DRIFT_SHADOW_DB:-sitecomply_drift_check}"
URL="$(grep -m1 '^DATABASE_URL' .env 2>/dev/null | sed 's/^DATABASE_URL=//; s/^"//; s/"$//; s/[?&]schema=[^&]*//')"
[ -n "$URL" ] || { echo "  FAIL cannot read DATABASE_URL from .env"; exit 1; }
BASE="$(echo "$URL" | sed 's|/[^/?]*$||')"
SHADOW="${BASE}/${SHADOW_DB}"

cleanup() { psql "$URL" -X -q -c "DROP DATABASE IF EXISTS \"${SHADOW_DB}\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
psql "$URL" -X -q -c "CREATE DATABASE \"${SHADOW_DB}\"" >/dev/null 2>&1 \
  || { echo "  FAIL could not create the scratch database ${SHADOW_DB}"; exit 1; }

OUT=$(npx prisma migrate diff \
        --from-migrations prisma/migrations \
        --to-schema-datamodel prisma/schema.prisma \
        --shadow-database-url "$SHADOW" \
        --script 2>&1) || { echo "  FAIL prisma migrate diff failed:"; echo "$OUT" | tail -5; exit 1; }

# Comments and blank lines are not drift.
STATEMENTS=$(printf '%s\n' "$OUT" | grep -vcE '^\s*$|^--' || true)
if [ "${STATEMENTS:-0}" != "0" ]; then
  echo "  FAIL the migration history does not reproduce schema.prisma (${STATEMENTS} statement(s) of drift):"
  printf '%s\n' "$OUT" | grep -vE '^\s*$' | head -40
  echo
  echo "  A feature was applied without a migration. Generate one:"
  echo "    npx prisma migrate dev --name <what_it_adds>"
  echo "  or, if production already has it, add the migration and mark it applied there:"
  echo "    npx prisma migrate resolve --applied <migration_name>"
  exit 1
fi
echo "  ok   the migration history reproduces schema.prisma exactly"
