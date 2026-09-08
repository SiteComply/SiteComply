#!/usr/bin/env bash
# Deploy the report-delivery timer alongside the existing compliance tick.
#
# Same shape as scripts/sc020p4_timer.sh and idempotent: adds REPORT_DELIVERY_URL
# (appsettings set MERGES, so SCHEDULER_SECRET and TICK_URL survive) and ships the
# whole function directory, which now holds both timers.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; FNAPP=sitecomply-scheduler; WEBAPP=sitecomply-web
SRC=azure/scheduler-function; ZIP=/tmp/reportphase2_timer.zip
die() { echo "ERROR: $1. Aborting"; exit 1; }

echo "== REPORT DELIVERY TIMER DEPLOY =="

# Both timers must be present in what we are about to ship, and they must not
# fire at the same minute — one instance, and a four-minute HTTP timeout each.
[ -f "$SRC/src/functions/complianceTick.js" ] || die "the compliance tick is missing from the package"
[ -f "$SRC/src/functions/reportDelivery.js" ] || die "the delivery timer is missing from the package"
T1=$(grep -o "schedule: '[^']*'" "$SRC/src/functions/complianceTick.js" | head -1)
T2=$(grep -o "schedule: '[^']*'" "$SRC/src/functions/reportDelivery.js" | head -1)
[ "$T1" != "$T2" ] || die "both timers share a schedule ($T1)"
echo "      two timers, offset: tick $T1, delivery $T2"

echo "[1/3] Settings..."
BEFORE=$(az functionapp config appsettings list -g "$RG" -n "$FNAPP" --query "[].name" -o tsv | sort | tr '\n' ' ')
az functionapp config appsettings set -g "$RG" -n "$FNAPP" --settings \
  "REPORT_DELIVERY_URL=https://$WEBAPP.azurewebsites.net/api/system/reports/deliver" -o none \
  || die "could not set REPORT_DELIVERY_URL"
AFTER=$(az functionapp config appsettings list -g "$RG" -n "$FNAPP" --query "[].name" -o tsv | sort | tr '\n' ' ')
echo "      before: $BEFORE"
echo "      after:  $AFTER"
for keep in SCHEDULER_SECRET TICK_URL AzureWebJobsStorage; do
  echo "$AFTER" | grep -q "$keep" || die "$keep was lost"
done
echo "$AFTER" | grep -q REPORT_DELIVERY_URL || die "REPORT_DELIVERY_URL was not set"
echo "      the existing settings survived and the new one is present."

echo "[2/3] Packaging..."
rm -f "$ZIP"; ( cd "$SRC" && zip -rq "$ZIP" . ) || die "zip failed"
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[3/3] Deploying..."
az functionapp deployment source config-zip -g "$RG" -n "$FNAPP" --src "$ZIP" -o none || die "function deploy failed"

echo "      functions now registered:"
az functionapp function list -g "$RG" -n "$FNAPP" --query "[].{name:name}" -o tsv 2>/dev/null | sed 's/^/        /'
echo "== TIMER DEPLOY COMPLETE =="
