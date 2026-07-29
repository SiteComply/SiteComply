#!/usr/bin/env bash
# SC-014 production migration — applies 20260729180000_add_audit_scoring.
#
# Purely ADDITIVE: three new enums (ScoringMethod, QuestionScoringRule,
# ItemResult), three new tables (AuditSection, AuditTemplateSection,
# AuditScoreBand) and new columns on Audit / AuditTemplate / AuditItem /
# AuditTemplateItem. Every new column is nullable or defaulted, and
# Audit."scoringEnabled" defaults FALSE — so the running SC-013 code is
# unaffected and this is safe to apply BEFORE the code deploy (no downtime).
# No backfill and no data change.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc014-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-014 PRODUCTION MIGRATION =="
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
    WHERE table_schema = '"'"'public'"'"'
      AND table_name IN ('"'"'AuditSection'"'"','"'"'AuditTemplateSection'"'"','"'"'AuditScoreBand'"'"')`);
  const cols = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = '"'"'Audit'"'"'
      AND column_name IN ('"'"'scoringEnabled'"'"','"'"'scoringMethod'"'"','"'"'totalPossibleScore'"'"','"'"'passingScore'"'"','"'"'calculatedScore'"'"','"'"'calculatedPassed'"'"')`);
  const itemCols = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = '"'"'AuditItem'"'"'
      AND column_name IN ('"'"'sectionId'"'"','"'"'scoringRule'"'"','"'"'points'"'"','"'"'mandatory'"'"','"'"'result'"'"','"'"'pointsAwarded'"'"')`);
  const enums = await p.$queryRawUnsafe(`
    SELECT typname FROM pg_type
    WHERE typname IN ('"'"'ScoringMethod'"'"','"'"'QuestionScoringRule'"'"','"'"'ItemResult'"'"')`);
  // Every pre-existing audit must be untouched: scoring off by default.
  const enabled = await p.audit.count({ where: { scoringEnabled: true } });
  console.log("      new tables:", tbl.length, "of 3");
  console.log("      new enums:", enums.length, "of 3");
  console.log("      Audit cols:", cols.length, "of 6");
  console.log("      AuditItem cols:", itemCols.length, "of 6");
  console.log("      audits with scoring already enabled:", enabled, "(expect 0)");
  const ok =
    tbl.length === 3 && enums.length === 3 && cols.length === 6 &&
    itemCols.length === 6 && enabled === 0;
  console.log(ok ? "      VERIFIED" : "      *** VERIFICATION FAILED ***");
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
})();
'

echo "== SC-014 MIGRATION COMPLETE =="
