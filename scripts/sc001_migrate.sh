#!/usr/bin/env bash
# SC-001 production migration — applies ONLY the add_cscs_smart_check migration.
# Safe to run more than once. Adds a temporary DB firewall rule for this host,
# applies the migration, verifies, and always removes the firewall rule on exit.
# SC-002's migration is moved aside first so `migrate deploy` cannot apply it.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc001-deploy
SC002=prisma/migrations/20260724101608_add_site_bulletins
HOLD=/tmp/sc002_hold_migration

cleanup() {
  # Always restore the SC-002 migration folder and remove the firewall rule.
  [ -d "$HOLD" ] && mv "$HOLD" "$SC002" 2>/dev/null || true
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed; SC-002 migration folder restored (unapplied)."
}
trap cleanup EXIT

echo "== SC-001 PRODUCTION MIGRATION =="
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

# Scope strictly to SC-001: hide SC-002's migration so it is NOT applied.
mv "$SC002" "$HOLD"
echo "[4/5] Pending migrations (should be add_cscs_smart_check only):"
DATABASE_URL="$DBURL" npx prisma migrate status 2>/dev/null | grep -iE "following|have not|add_cscs|add_site" || true

echo "      Applying..."
DATABASE_URL="$DBURL" npx prisma migrate deploy

echo "[5/5] Verifying migration status:"
DATABASE_URL="$DBURL" npx prisma migrate status 2>/dev/null | tail -4

echo "== MIGRATION COMPLETE (SC-001 only). =="
