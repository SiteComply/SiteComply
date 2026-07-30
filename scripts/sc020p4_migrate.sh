#!/usr/bin/env bash
# SC-020 Phase 1 production migration — applies 20260731080000_add_scheduler_run.
#
# Purely ADDITIVE: four new enums and two new tables (ComplianceSchedule,
# ComplianceOccurrence). No existing column is touched and there is no backfill.
# The unique index on (scheduleId, dueAt) is the idempotency guarantee for
# occurrence generation — repeated or concurrent generation cannot double-create.
# Also re-runs the idempotent audit-template seed, which now includes the REV-1
# compliance-calendar activity types. Safe to apply before the code deploy.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc020p4-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-020 PHASE 4 PRODUCTION MIGRATION =="
MYIP=$(curl -s --max-time 20 https://api.ipify.org)
echo "[1/5] Host public IP: $MYIP"

echo "[2/5] Adding temporary firewall rule '$RULE'..."
az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
  --name "$RULE" --yes -o none 2>/dev/null || true
az postgres flexible-server firewall-rule create -g "$RG" -s "$PG" \
  --name "$RULE" --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none
echo "      done."

echo "[3/5] Reading prod DATABASE_URL from App Service settings..."
DBURL=$(az webapp config appsettings list -g "$RG" -n "$APP" \
  --query "[?name=='DATABASE_URL'].value | [0]" -o tsv)
[ -n "$DBURL" ] || { echo "ERROR: could not read DATABASE_URL"; exit 1; }
echo "      got it (host: $(echo "$DBURL" | sed -E 's#.*@([^/:?]+).*#\1#'))."

echo "[4/5] Applying pending migrations + seeding activity types..."
DATABASE_URL="$DBURL" npx prisma migrate deploy 2>&1 | sed 's/^/      /'


echo "[5/5] Verifying the new objects..."
DATABASE_URL="$DBURL" npx tsx scripts/sc020p4_verify.ts

echo "== SC-020 PHASE 4 MIGRATION COMPLETE =="
