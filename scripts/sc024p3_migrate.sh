#!/usr/bin/env bash
# SC-024 Phase 3 production migration — applies 20260809090000_add_close_out_sharing.
#
# Purely ADDITIVE:
#   - one new AiSummaryTarget enum value (CLOSE_OUT_PACK);
#   - four nullable AI-provenance columns on CloseOutPack;
#   - two new tables (CloseOutPackShare + CloseOutPackShareView).
#
# NO BACKFILL. Every existing pack comes through with no narrative and no share
# links, which is the truth for all of them. Safe to apply before the code
# deploy: the running code never reads these columns or tables.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc024p3-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-024 PHASE 3 PRODUCTION MIGRATION =="
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
DATABASE_URL="$DBURL" npx tsx scripts/sc024p3_verify.ts

echo "== SC-024 PHASE 3 MIGRATION COMPLETE =="
