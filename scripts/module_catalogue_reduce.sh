#!/usr/bin/env bash
# REDUCE THE COMPANY-WIDE MODULE SET IN PRODUCTION (owner's decision, 2026-09-30).
#
#   RETIRE   PPE expectations, Housekeeping, Environmental awareness — each already
#            covered by Site Setup, a generated site scene or a default site rule.
#   OPTIONAL Manual handling — training, not induction: kept, off by default.
#   PROMOTE  Company introduction — the one genuinely universal module, currently
#            mandatory=false AND defaultIncluded=false with no per-site opt-in, so the
#            wording the owner issued has been reaching NOBODY.
#
# Nothing is deleted. Retiring keeps the row and its revisions; a published induction
# holds the wording it was approved with, and the next generation leaves it out.
#
# Editing the catalogue in code does NOT do this: seedModuleCatalogue skips any slug
# that already exists, so live flags are only ever changed here.
#
# DRY_RUN=1 runs the whole thing and rolls back.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

RG=rgSiteComply; APP=sitecomply-web; PG=sitecomply-pg
RULE=tmp-module-reduce
BODY="$(dirname "$0")/module_catalogue_reduce.sql"
[ -f "$BODY" ] || { echo "ERROR: missing $BODY"; exit 1; }

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" --name "$RULE" --yes -o none 2>/dev/null || true
  echo "      firewall rule removed."
}
trap cleanup EXIT

MYIP=$(curl -s --max-time 20 https://api.ipify.org)
[ -n "$MYIP" ] || { echo "ERROR: no IP"; exit 1; }
az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" --name "$RULE" --yes -o none 2>/dev/null || true
az postgres flexible-server firewall-rule create -g "$RG" -s "$PG" \
  --name "$RULE" --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none \
  || { echo "ERROR: could not open the firewall rule"; exit 1; }

DBURL=$(az webapp config appsettings list -g "$RG" -n "$APP" \
  --query "[?name=='DATABASE_URL'].value | [0]" -o tsv)
[ -n "$DBURL" ] || { echo "ERROR: could not read DATABASE_URL"; exit 1; }

RUN=$(mktemp); cat "$BODY" > "$RUN"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN - the transaction will be rolled back."
  printf 'rollback;\n\\echo %s\n' "'*** ROLLED BACK - nothing changed ***'" >> "$RUN"
else
  printf 'commit;\n\\echo %s\n' "'*** COMMITTED ***'" >> "$RUN"
fi
psql "$DBURL" -v ON_ERROR_STOP=1 -f "$RUN"; RC=$?
rm -f "$RUN"
[ "$RC" -eq 0 ] || { echo "FAILED: the transaction aborted - NOTHING changed (exit $RC)"; exit "$RC"; }
