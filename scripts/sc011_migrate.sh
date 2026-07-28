#!/usr/bin/env bash
# SC-011 production migration — applies 20260728180000_add_induction_signature.
#
# Purely additive: a SignatureType enum, six nullable/defaulted signature columns
# on Submission, and one defaulted toggle (inductionSignatureRequired) on
# SiteInductionConfig. No backfill; backwards-compatible with the running SC-010
# code; ships dark (the toggle defaults false). Safe to apply BEFORE the code
# deploy, no downtime.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc011-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-011 PRODUCTION MIGRATION =="
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
  const sub = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'Submission'"'"'
      AND column_name IN ('"'"'declarationAccepted'"'"','"'"'declarationText'"'"','"'"'signedName'"'"','"'"'signatureType'"'"','"'"'signatureBlobPath'"'"','"'"'signedAt'"'"')`);
  const cfg = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'SiteInductionConfig'"'"'
      AND column_name = '"'"'inductionSignatureRequired'"'"'`);
  console.log("      Submission signature cols:", sub.length, "of 6");
  console.log("      SiteInductionConfig toggle:", cfg.length, "of 1");
  const ok = sub.length === 6 && cfg.length === 1;
  console.log(ok ? "      VERIFIED" : "      *** VERIFICATION FAILED ***");
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
})();
'

echo "== SC-011 MIGRATION COMPLETE =="
