#!/usr/bin/env bash
# SC-031 production migration — applies 20260812090000_company_profile_branding.
#
# Purely ADDITIVE: twenty columns on the existing CompanyConfig singleton. No
# column is altered or dropped, no table is created, there is no backfill and
# no row is written.
#
# NOT SAFE TO APPLY AFTER THE CODE — this one is the other way round from a
# usual code-only release. The new build SELECTs these columns, and
# CompanyConfig is read by close-out packs and the public pack share page, so
# the code must land second. scripts/sc031_deploy.sh refuses to run until all
# twenty are present.
#
# Every boolean defaults TRUE, which reproduces exactly what packs render
# today: company info, logo and standard details all appear. Text columns are
# nullable with no default — NULL means not set, and every reader falls back to
# what it does now, including the hard-coded pack disclaimer.
#
# ROLLBACK: none required and none provided. Leaving the columns in place is
# the rollback — the previous build ignores them. Dropping them would be a
# destructive change to recover from a non-destructive one.
set -euo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
# Postgres is a userland install: psql finds libpq.so.5 only via this path, and
# without it every psql call fails with a shared-library error that reads like
# a database problem. The pre-flight below correctly refused to proceed when it
# happened — it could not read the history, so it did not guess.
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc031-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-031 PRODUCTION MIGRATION — COMPANY PROFILE & BRANDING =="
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
DATABASE_URL="$DBURL" npx tsx scripts/sc031_verify.ts

echo "== SC-031 MIGRATION COMPLETE =="
echo "   The schema is now ahead of the code, and nothing has changed for users."
echo "   Next: scripts/sc031_deploy.sh"
