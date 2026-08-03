#!/usr/bin/env bash
# SC-024 Phase 2 production migration — applies 20260808090000_add_close_out_zip.
#
# Purely ADDITIVE: five new columns on CloseOutPack recording the stored ZIP
# artefact (blob path, size, generated-at, truncated flag, file count). Every
# column is nullable or defaulted, so existing packs remain valid untouched —
# absence of zipBlobPath simply means "no archive built yet", which is what the
# UI reports. NO BACKFILL. Safe to apply before the code deploy: the old code
# never reads these columns.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc024p2-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-024 PHASE 2 PRODUCTION MIGRATION =="
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
DATABASE_URL="$DBURL" npx tsx scripts/sc024p2_verify.ts

echo "== SC-024 PHASE 2 MIGRATION COMPLETE =="
