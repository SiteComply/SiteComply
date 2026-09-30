#!/usr/bin/env bash
# CLEAR `mandatory` ON ANY RETIRED MODULE (production).
#
# WHY THIS IS NEEDED: setModuleActive REFUSES to retire a mandatory module — "This
# module is mandatory for every site. Make it optional before retiring it." — because
# restoring one would put it back on EVERY site at once. The reduction script retired
# PPE expectations with a direct SQL update and so walked straight past that guard,
# leaving a row that is retired AND mandatory: a state the product cannot create
# through its own service, and a footgun the moment somebody restores it.
#
# Only `mandatory` is cleared. `defaultIncluded` is left alone, so a deliberate
# restore returns the module to the inclusion default it had — and the archive now
# states what restoring would do before anybody presses the button.
#
# DRY_RUN=1 runs it and rolls back.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

RG=rgSiteComply; APP=sitecomply-web; PG=sitecomply-pg; RULE=tmp-retired-mandatory
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
  || { echo "ERROR: firewall"; exit 1; }
DBURL=$(az webapp config appsettings list -g "$RG" -n "$APP" \
  --query "[?name=='DATABASE_URL'].value | [0]" -o tsv)
[ -n "$DBURL" ] || { echo "ERROR: no DATABASE_URL"; exit 1; }

RUN=$(mktemp)
cat > "$RUN" <<'SQL'
begin;
\echo '--- retired modules still flagged mandatory (the bad state) ---'
select slug, active, mandatory, "defaultIncluded"
from "InductionModule" where active = false and mandatory = true order by "order";

update "InductionModule" set mandatory = false
where active = false and mandatory = true;

\echo '--- after: the invariant holds ---'
select count(*) as retired_and_mandatory
from "InductionModule" where active = false and mandatory = true;
\echo '--- every retired module, for the record ---'
select slug, active, mandatory, "defaultIncluded"
from "InductionModule" where active = false order by "order";
SQL
if [ "${DRY_RUN:-0}" = "1" ]; then
  printf 'rollback;\n\\echo %s\n' "'*** ROLLED BACK ***'" >> "$RUN"
else
  printf 'commit;\n\\echo %s\n' "'*** COMMITTED ***'" >> "$RUN"
fi
psql "$DBURL" -v ON_ERROR_STOP=1 -f "$RUN"; RC=$?
rm -f "$RUN"
[ "$RC" -eq 0 ] || { echo "FAILED (exit $RC) - nothing changed"; exit "$RC"; }
