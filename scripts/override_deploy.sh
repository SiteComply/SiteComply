#!/usr/bin/env bash
# Deploy: replace global 123456 Platform bypass with account-scoped dev override.
# Same proven flow as prior deploys. Guards assert the global code is GONE and
# the scoped override IS present, both in source and in the built artifact.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/override_deploy.zip
VERIFY=app/api/platform/auth/verify/route.ts
START=app/api/platform/auth/start/route.ts

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SCOPED OVERRIDE CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
[ -f services/auth/platformDevOverride.ts ] \
  && grep -q 'PLATFORM_DEV_LOGIN_ENABLED' services/auth/platformDevOverride.ts \
  && grep -q 'PLATFORM_TEST_LOGIN_ENABLED' services/auth/platformDevOverride.ts \
  && grep -q 'verifyPlatformCodeLogin' "$VERIFY" \
  && ! grep -q "const DEV_CODE" "$VERIFY" \
  && ! grep -q "const DEV_CODE" "$START" \
  && ! grep -q "code: DEV_CODE" "$START" \
  && echo "      confirmed: overrides present; global DEV_CODE constant removed." \
  || { echo "ERROR: override source guards failed — aborting"; exit 1; }
# Real SMS-first OTP wiring must be present.
grep -q 'export async function verifyChallenge' services/auth/otpService.ts \
  && grep -q "audience" services/auth/otpService.ts \
  && grep -q "requestCode(user.mobile, { audience: 'platform' })" "$START" \
  && grep -q 'verifyChallenge(user.mobile' "$VERIFY" \
  && echo "      confirmed: platform SMS OTP wired (requestCode audience + verifyChallenge)." \
  || { echo "ERROR: OTP wiring guards failed — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built server bundle)..."
AUTH_ART=.next/server/app/api/platform/auth
if grep -rq '123456' "$AUTH_ART" 2>/dev/null; then
  echo "ERROR: '123456' still present in built platform auth bundle — aborting"; exit 1
fi
grep -rq 'PLATFORM_DEV_LOGIN_ENABLED' .next/server 2>/dev/null \
  || { echo "ERROR: override env key not found in built bundle — aborting"; exit 1; }
echo "      confirmed: no '123456' in built auth routes; override compiled in."

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
[ "$CODE" = "200" ] && echo "== OVERRIDE DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }