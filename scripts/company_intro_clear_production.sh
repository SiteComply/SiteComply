#!/usr/bin/env bash
# Delete the ORPHANED company-video production blocking a fresh "Company Introduction"
# generation run, in PRODUCTION.
#
# WHAT IS BEING DELETED AND WHY
#   InductionVideo cmum4nxw100018umlckso13xp - version 1 of the Company Introduction
#   library asset's production. It was produced from the PPE EXPECTATIONS module
#   (source module revision cmuf40zki0002tfba6zgeha3i) before the asset was re-pointed
#   at the new COMPANY_INTRODUCTION module, so its three scenes carry PPE wording under
#   a Company Introduction title. It cannot be "finished" - the content is wrong - and
#   startCompanyVideo refuses a second production while any unpublished one exists.
#
# EVERY CONDITION versionMayBeDeleted() CHECKS IS RE-CHECKED HERE, IN SQL, INSIDE THE
# TRANSACTION: never published, never watched, not superseded, not approved, a
# deletable status, no job in flight, and the expected scene count. The earlier
# investigation is NOT trusted - the data could have moved since.
#
# ONE CONDITION IS HANDLED DIFFERENTLY FROM THE SERVICE. deleteVideoVersion deletes
# the blobs before the row; this script cannot reach blob storage, so instead of
# deleting media it REFUSES if any media path is non-null - a row deleted here would
# orphan the file. Today every path is null and no scene has audio, so there is
# nothing to clean up. If that ever changes, delete through the UI instead.
#
# Scenes, jobs, events and views cascade (onDelete: Cascade on all four).
# AiUsageEvent.videoId is a plain column with NO relation, so recorded spend survives
# deliberately - deleting must not become a way to buy past the daily budget cap.
#
# DRY_RUN=1 runs the whole thing and ROLLS BACK.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

RG=rgSiteComply
APP=sitecomply-web
PG=sitecomply-pg
RULE=tmp-company-intro-clear
VIDEO_ID=cmum4nxw100018umlckso13xp   # pinned from the investigation
ASSET_ID=cmulyqn7p002f38btrm93otwx   # Company Introduction
EXPECT_STATUS=SCRIPT_READY
EXPECT_SCENES=3
BODY="$(dirname "$0")/company_intro_clear_production.sql"

[ -f "$BODY" ] || { echo "ERROR: missing $BODY"; exit 1; }

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "      firewall rule removed."
}
trap cleanup EXIT

MYIP=$(curl -s --max-time 20 https://api.ipify.org)
[ -n "$MYIP" ] || { echo "ERROR: could not determine this machine's IP"; exit 1; }
az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" --name "$RULE" --yes -o none 2>/dev/null || true
az postgres flexible-server firewall-rule create -g "$RG" -s "$PG" \
  --name "$RULE" --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none || {
    echo "ERROR: could not open a temporary firewall rule"; exit 1; }

DBURL=$(az webapp config appsettings list -g "$RG" -n "$APP" \
  --query "[?name=='DATABASE_URL'].value | [0]" -o tsv)
[ -n "$DBURL" ] || { echo "ERROR: could not read DATABASE_URL"; exit 1; }

# The transaction is ENDED EXPLICITLY, appended here rather than left to psql's
# end-of-session behaviour - which differs between versions and is the last thing
# a delete against production should depend on.
RUN=$(mktemp); trap 'rm -f "$RUN"' RETURN 2>/dev/null || true
cat "$BODY" > "$RUN"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN - the transaction will be rolled back."
  echo "rollback;"  >> "$RUN"
  echo "\\echo '*** ROLLED BACK - nothing was deleted ***'" >> "$RUN"
else
  echo "commit;" >> "$RUN"
  echo "\\echo '*** COMMITTED ***'" >> "$RUN"
fi

psql "$DBURL" -v ON_ERROR_STOP=1 \
  -v vid="$VIDEO_ID" -v aid="$ASSET_ID" -v st="$EXPECT_STATUS" -v sc="$EXPECT_SCENES" \
  -f "$RUN"
RC=$?
rm -f "$RUN"
if [ "$RC" -ne 0 ]; then
  echo "FAILED: the transaction aborted - NOTHING was deleted (exit $RC)"
  exit "$RC"
fi
