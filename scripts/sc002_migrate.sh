#!/usr/bin/env bash
# SC-002 production migration — applies the pending add_site_bulletins migration.
# SC-001 is already applied, so this is the only pending migration. Adds a
# temporary DB firewall rule for this host, applies, verifies, and always removes
# the firewall rule on exit.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
PG=sitecomply-pg
APP=sitecomply-web
RULE=tmp-sc002-deploy

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
  echo "[cleanup] firewall rule removed."
}
trap cleanup EXIT

echo "== SC-002 PRODUCTION MIGRATION =="
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

echo "[4/5] Pending migrations (should be add_site_bulletins only):"
PENDING=$(DATABASE_URL="$DBURL" npx prisma migrate status 2>/dev/null \
  | grep -iE "^[0-9]{14}_" || true)
echo "$PENDING"
# Safety: refuse to proceed if anything other than add_site_bulletins is pending.
if echo "$PENDING" | grep -qv "add_site_bulletins"; then
  if [ -n "$(echo "$PENDING" | grep -v 'add_site_bulletins' | tr -d '[:space:]')" ]; then
    echo "ERROR: unexpected pending migration(s) — aborting to stay SC-002-only."; exit 1
  fi
fi
echo "      Applying..."
DATABASE_URL="$DBURL" npx prisma migrate deploy

echo "[5/5] Verifying migration status:"
DATABASE_URL="$DBURL" npx prisma migrate status 2>/dev/null | tail -4

echo "== MIGRATION COMPLETE (SC-002). =="
