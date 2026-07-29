#!/usr/bin/env bash
# SC-017 production migration — applies 20260730000000_add_photo_annotation.
#
# Purely ADDITIVE: three nullable/defaulted columns on each of FindingEvidence,
# ActionEvidence and Document, plus their indexes. Nothing is rewritten and there
# is no backfill — existing uploads simply read as "not annotated". Safe to apply
# before the code deploy.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc017-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-017 PRODUCTION MIGRATION =="
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
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN ('"'"'FindingEvidence'"'"','"'"'ActionEvidence'"'"','"'"'Document'"'"')
      AND column_name IN ('"'"'annotated'"'"','"'"'annotationData'"'"','"'"'originalEvidenceId'"'"','"'"'originalDocumentId'"'"')`);
  const ae = await p.actionEvidence.count();
  const fe = await p.findingEvidence.count();
  const annotated = await p.actionEvidence.count({ where: { annotated: true } })
    + await p.findingEvidence.count({ where: { annotated: true } });
  console.log("      new columns:", cols.length, "of 9");
  console.log("      existing evidence rows:", ae + fe, "| annotated:", annotated, "(expect 0 — no backfill)");
  const ok = cols.length === 9 && annotated === 0;
  console.log(ok ? "      VERIFIED" : "      *** VERIFICATION FAILED ***");
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
})();
'

echo "== SC-017 MIGRATION COMPLETE =="
