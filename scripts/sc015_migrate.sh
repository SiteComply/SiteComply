#!/usr/bin/env bash
# SC-015 production migration — applies 20260729200000_add_action_assignee.
#
# Purely ADDITIVE: three nullable columns on "Action" (assignedToCompany,
# assignedWorkerId, assignedPlatformUserId) plus two indexes and two FKs. The
# existing free-text "assignedTo" is UNCHANGED and becomes the name snapshot, so
# every historic action keeps its value. Mandatory assignment is enforced in
# validation for NEWLY created actions only — there is deliberately no NOT NULL
# constraint and no backfill, so legacy actions stay valid and editable.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc015-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-015 PRODUCTION MIGRATION =="
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

echo "[4/5] Applying pending migrations..."
DATABASE_URL="$DBURL" npx prisma migrate deploy 2>&1 | sed 's/^/      /'

echo "[5/5] Verifying the new objects..."
DATABASE_URL="$DBURL" npx tsx -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const cols = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = '"'"'Action'"'"'
      AND column_name IN ('"'"'assignedToCompany'"'"','"'"'assignedWorkerId'"'"','"'"'assignedPlatformUserId'"'"')`);
  const fks = await p.$queryRawUnsafe(`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = '"'"'Action'"'"' AND constraint_type = '"'"'FOREIGN KEY'"'"'
      AND constraint_name IN ('"'"'Action_assignedWorkerId_fkey'"'"','"'"'Action_assignedPlatformUserId_fkey'"'"')`);
  const total = await p.action.count();
  const legacyIntact = await p.action.count({ where: { assignedWorkerId: null, assignedPlatformUserId: null } });
  console.log("      new Action cols:", cols.length, "of 3");
  console.log("      new FKs:", fks.length, "of 2");
  console.log("      actions total:", total, "| untouched by this migration:", legacyIntact);
  const ok = cols.length === 3 && fks.length === 2 && legacyIntact === total;
  console.log(ok ? "      VERIFIED" : "      *** VERIFICATION FAILED ***");
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
})();
'

echo "== SC-015 MIGRATION COMPLETE =="
