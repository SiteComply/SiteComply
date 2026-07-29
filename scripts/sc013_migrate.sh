#!/usr/bin/env bash
# SC-013 production migration + starter-template seed — applies
# 20260729120000_add_audit_templates and seeds the starter audit templates.
#
# Purely additive: AuditTemplate, AuditTemplateItem, AuditItem tables + three
# nullable snapshot columns on Audit. No backfill; backwards-compatible with the
# running SC-012 code; safe to apply BEFORE the code deploy. The template seed is
# idempotent (upsert by name). Both run inside one temporary PG firewall window.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc013-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-013 PRODUCTION MIGRATION =="
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

echo "[4/6] Applying pending migrations..."
DATABASE_URL="$DBURL" npx prisma migrate deploy 2>&1 | sed 's/^/      /'

echo "[5/6] Seeding the starter audit-template library (idempotent)..."
DATABASE_URL="$DBURL" npx tsx scripts/seed-audit-templates.ts 2>&1 | sed 's/^/      /'

echo "[6/6] Verifying the new objects + templates..."
DATABASE_URL="$DBURL" npx tsx -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const tbl = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = '"'"'public'"'"'
      AND table_name IN ('"'"'AuditTemplate'"'"','"'"'AuditTemplateItem'"'"','"'"'AuditItem'"'"')`);
  const templates = await p.auditTemplate.count();
  const items = await p.auditTemplateItem.count();
  console.log("      tables:", tbl.length, "of 3");
  console.log("      templates:", templates, "template items:", items);
  const ok = tbl.length === 3 && templates >= 3 && items >= 3;
  console.log(ok ? "      VERIFIED" : "      *** VERIFICATION FAILED ***");
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
})();
'

echo "== SC-013 MIGRATION COMPLETE =="
