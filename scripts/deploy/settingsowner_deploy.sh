#!/usr/bin/env bash
# Deploy: single owner for session timeout + retire the Admin Centre company form.
# Same proven flow as prior deploys.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/settingsowner_deploy.zip
ADMIN_PAGE="app/admin/(dashboard)/settings/company/page.tsx"

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SETTINGS OWNERSHIP DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# saveAuthConfig must no longer write sessionTtlSeconds.
if awk '/export async function saveAuthConfig/,/^}/' services/auth/authConfigService.ts \
     | grep -qE '^\s*sessionTtlSeconds:'; then
  echo "ERROR: saveAuthConfig still writes sessionTtlSeconds — aborting"; exit 1
fi
echo "      confirmed: Admin Centre no longer writes sessionTtlSeconds."

# Platform must REMAIN the writer — the point is single ownership, not no owner.
awk '/export async function savePlatformAuthSettings/,/^}/' services/auth/authConfigService.ts \
  | grep -qE '^\s*sessionTtlSeconds:' \
  || { echo "ERROR: Platform no longer writes sessionTtlSeconds — aborting"; exit 1; }
echo "      confirmed: Platform Settings remains the owner."

# Admin-only auth settings must be PRESERVED until a migration is agreed.
for F in otpTtlSeconds otpMaxAttempts smsOtpEnabled emailOtpEnabled; do
  awk '/export async function saveAuthConfig/,/^}/' services/auth/authConfigService.ts \
    | grep -qE "^\s*${F}:" \
    || { echo "ERROR: Admin-only setting ${F} lost — aborting"; exit 1; }
done
echo "      confirmed: OTP expiry / attempts / SMS / email settings preserved."

# Company screen must be genuinely read-only: no inputs, no save handler.
[ ! -f components/admin/CompanySettings.tsx ] \
  && ! grep -q "<input" "$ADMIN_PAGE" \
  && ! grep -q "fetch(" "$ADMIN_PAGE" \
  && ! grep -q "Manage your organisation" "$ADMIN_PAGE" \
  && echo "      confirmed: company page is read-only (no inputs, no save, no 'Manage' copy)." \
  || { echo "ERROR: company page still editable — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
grep -rqF "Platform Settings → Company profile & branding" .next/server 2>/dev/null \
  || { echo "ERROR: read-only pointer copy missing from bundle — aborting"; exit 1; }
if grep -rqF "Manage your organisation’s name, support contacts" .next/server 2>/dev/null; then
  echo "ERROR: retired 'Manage ...' company copy still in bundle — aborting"; exit 1
fi
# Sensitivity: the Platform-side editor must still ship, or ownership went nowhere.
grep -rqF "Company profile & branding" .next/server 2>/dev/null \
  || { echo "ERROR: platform company editor missing — guard not sensitive, aborting"; exit 1; }
echo "      confirmed: retired copy gone; owning screen intact."

echo "[5/8] Packaging zip..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Deploying to App Service..."
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/8] Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
LANDED=""
for i in $(seq 1 40); do
  sleep 15
  CURB=$(kudu_buildid)
  echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  if [ "$CURB" = "$NEW_BUILD" ]; then LANDED=yes; break; fi
done
[ -n "$LANDED" ] || { echo "WARNING: new build id not confirmed on disk. NOT cutting over."; exit 2; }
echo "      new build landed on disk."

echo "[8/8] Cutting over (stop/start) and health-checking..."
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 20); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== SETTINGS OWNERSHIP DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
