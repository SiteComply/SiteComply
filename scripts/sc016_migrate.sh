#!/usr/bin/env bash
# SC-016 production migration — applies 20260729220000_add_notification_events.
#
# Purely ADDITIVE: one new enum (NotificationEventType) and one new table
# (NotificationEvent). Nothing existing is altered, so the running SC-015 code is
# unaffected and this is safe to apply before the code deploy. No backfill —
# events are recorded from the deploy onward; the existing DERIVED notification
# types keep working unchanged for managers.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc016-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-016 PRODUCTION MIGRATION =="
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
  const tbl = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'NotificationEvent'"'"'`);
  const en = await p.$queryRawUnsafe(`
    SELECT typname FROM pg_type WHERE typname = '"'"'NotificationEventType'"'"'`);
  const fks = await p.$queryRawUnsafe(`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = '"'"'NotificationEvent'"'"' AND constraint_type = '"'"'FOREIGN KEY'"'"'`);
  const events = await p.notificationEvent.count();
  const actions = await p.action.count();
  console.log("      NotificationEvent table:", tbl.length, "of 1");
  console.log("      NotificationEventType enum:", en.length, "of 1");
  console.log("      foreign keys:", fks.length, "of 2");
  console.log("      existing actions:", actions, "| events so far:", events, "(expect 0 — no backfill)");
  const ok = tbl.length === 1 && en.length === 1 && fks.length === 2 && events === 0;
  console.log(ok ? "      VERIFIED" : "      *** VERIFICATION FAILED ***");
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
})();
'

echo "== SC-016 MIGRATION COMPLETE =="
