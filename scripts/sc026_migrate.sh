#!/usr/bin/env bash
# SC-026 production migration — applies 20260811090000_auth_config_org_access.
#
# Purely ADDITIVE: six columns on the existing AuthConfig singleton. No column
# is altered or dropped, no table is created, there is no backfill and no data
# is written. Total lock time is a handful of milliseconds — Postgres 11+ adds
# a NOT NULL column with a constant default without rewriting the table.
#
# SAFE TO APPLY BEFORE THE CODE DEPLOY, and that is the intended order:
#   - the build currently in production has no Prisma client for these columns
#     and never selects them, so it cannot see the change;
#   - every boolean default reproduces today's behaviour exactly, so when the
#     new build does read them it reads the behaviour the product already had.
# This gives a window where the schema is ahead of the code and nothing differs,
# which is what makes the code deploy independently revertible.
#
# PRODUCTION STATE CONFIRMED BEFORE WRITING THIS SCRIPT (2026-08-06):
#   - _prisma_migrations: 54 rows, ZERO failed or unfinished. The failed
#     20260625060232_init row that blocks `migrate deploy` locally does NOT
#     exist in production; it is a local-database artefact.
#   - exactly one migration is pending — this one.
#   - AuthConfig has 0 rows: the platform runs on env-and-defaults, and no
#     App Service setting overrides any auth key.
#
# ROLLBACK: none required and none provided. Leaving the columns in place is
# the rollback — the previous build ignores them entirely. Dropping them would
# be a destructive change to recover from a non-destructive one.
set -euo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc026-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-026 PRODUCTION MIGRATION =="
MYIP=$(curl -s --max-time 20 https://api.ipify.org)
echo "[1/6] Host public IP: $MYIP"

echo "[2/6] Adding temporary firewall rule '$RULE'..."
az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
  --name "$RULE" --yes -o none 2>/dev/null || true
az postgres flexible-server firewall-rule create -g "$RG" -s "$PG" \
  --name "$RULE" --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none
echo "      done."

echo "[3/6] Reading prod DATABASE_URL from App Service settings..."
DBURL=$(az webapp config appsettings list -g "$RG" -n "$APP" \
  --query "[?name=='DATABASE_URL'].value | [0]" -o tsv)
[ -n "$DBURL" ] || { echo "ERROR: could not read DATABASE_URL"; exit 1; }
echo "      got it (host: $(echo "$DBURL" | sed -E 's#.*@([^/:?]+).*#\1#'))."

# ---------------------------------------------------------------------------
# PRE-FLIGHT. `prisma migrate deploy` refuses to run if the history contains a
# failed migration, and it refuses AFTER connecting — which on a bad day means
# discovering it mid-window. Ask first, and say plainly what is wrong.
#
# This check exists because the LOCAL database carries exactly such a row. It
# is not in production, but a script that assumes that rather than asserting it
# is a script that will one day be run against the wrong database.
# ---------------------------------------------------------------------------
echo "[4/6] Pre-flight: checking migration history is clean..."
BAD=$(psql "$DBURL" -X -q -t -A -c \
  "SELECT count(*) FROM _prisma_migrations
   WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;" 2>/dev/null || echo ERR)
if [ "$BAD" = "ERR" ]; then
  echo "ERROR: could not read _prisma_migrations. Not proceeding blind."
  exit 1
fi
if [ "$BAD" != "0" ]; then
  echo "ERROR: $BAD failed or unfinished migration(s) in production history."
  psql "$DBURL" -X -q -c \
    "SELECT migration_name, started_at, rolled_back_at
     FROM _prisma_migrations
     WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;" | sed 's/^/         /'
  echo "       'migrate deploy' will refuse to run. Resolve the history first;"
  echo "       do NOT clear the row without understanding what half-applied."
  exit 1
fi
APPLIED=$(psql "$DBURL" -X -q -t -A -c "SELECT count(*) FROM _prisma_migrations;")
echo "      clean: ${APPLIED} applied, 0 failed."

# What is about to happen, before it happens.
echo "      pending:"
DATABASE_URL="$DBURL" npx prisma migrate status 2>&1 \
  | grep -iE 'following migration|^  ?20[0-9]{6}|have not yet been applied|up to date' \
  | sed 's/^/        /' || true

echo "[5/6] Applying pending migrations..."
DATABASE_URL="$DBURL" npx prisma migrate deploy 2>&1 | sed 's/^/      /'

echo "[6/6] Verifying the new columns and that no data was invented..."
DATABASE_URL="$DBURL" npx tsx scripts/sc026_verify.ts

echo "== SC-026 MIGRATION COMPLETE =="
echo "   The schema is now ahead of the code, and nothing has changed for users."
echo "   Next: scripts/sc026_deploy.sh"
