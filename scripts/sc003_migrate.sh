#!/usr/bin/env bash
# SC-003 production migration — applies 20260724150000_add_worker_dashboard.
#
# Unlike SC-002 (which had to be applied as hand-written SQL from the Kudu
# console), this runs `prisma migrate deploy` from the build host: the Prisma CLI
# is available here and the production database is reachable once a temporary
# firewall rule for this host's public IP is in place. The rule is always removed
# on exit, including on failure.
#
# The migration is purely additive (one enum, two tables, three nullable JobSite
# columns), so it is backwards-compatible with the currently-running SC-002 code
# and is safe to apply BEFORE the code deploy, with no downtime.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc003-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-003 PRODUCTION MIGRATION =="
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

echo "[5/5] Verifying the new objects exist..."
DATABASE_URL="$DBURL" npx tsx -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const rows = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = '"'"'public'"'"'
      AND table_name IN ('"'"'SiteContact'"'"','"'"'SiteDashboardSetting'"'"')
    ORDER BY table_name`);
  const cols = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'JobSite'"'"'
      AND column_name IN ('"'"'firstAiderLocation'"'"','"'"'nearestHospital'"'"','"'"'emergencyNumber'"'"')
    ORDER BY column_name`);
  console.log("      tables:", rows.map(r => r.table_name).join(", ") || "(none)");
  console.log("      JobSite columns:", cols.map(c => c.column_name).join(", ") || "(none)");
  const ok = rows.length === 2 && cols.length === 3;
  console.log(ok ? "      VERIFIED" : "      *** VERIFICATION FAILED ***");
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
})();
'

echo "== SC-003 MIGRATION COMPLETE =="
