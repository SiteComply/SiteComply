#!/usr/bin/env bash
# Deploy: account-scoped worker test sign-in code (planted challenge).
# Ships DISABLED — inert until WORKER_TEST_LOGIN_* app settings are added.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/workertest_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== WORKER TEST LOGIN DEPLOY (ships disabled) =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
[ -f services/auth/workerTestLogin.ts ] \
  && grep -q 'WORKER_TEST_LOGIN_ENABLED' services/auth/workerTestLogin.ts \
  && grep -q 'isWorkerTestAccount' services/auth/otpService.ts \
  && echo "      confirmed: scoped worker override present." \
  || { echo "ERROR: override module/hook missing — aborting"; exit 1; }

# NO literal code may be hard-coded. It must come from env only.
# Match the code as a QUOTED STANDALONE literal. A bare substring search also
# hits legitimate values such as the SMS placeholder '+441234567890'.
CODE_LITERAL="['\"](231001|123456)['\"]"
if grep -rnE "$CODE_LITERAL" --include=*.ts --include=*.tsx services app components lib 2>/dev/null \
     | grep -vE ':\s*(//|\*|/\*)' | grep -q .; then
  echo "ERROR: a literal override code is hard-coded in source — aborting"
  grep -rnE "$CODE_LITERAL" --include=*.ts --include=*.tsx services app components lib \
    | grep -vE ':\s*(//|\*|/\*)'
  exit 1
fi
echo "      confirmed: no override code hard-coded (env-supplied only)."

# Fail-closed: the mechanism must be gated on the ENABLED flag being exactly "1".
grep -q "process.env.WORKER_TEST_LOGIN_ENABLED !== '1'" services/auth/workerTestLogin.ts \
  || { echo "ERROR: override is not gated fail-closed — aborting"; exit 1; }
echo "      confirmed: fail-closed (disabled unless ENABLED=1 + list + code)."

# The VERIFICATION path must be untouched — this is a planted challenge, not a bypass.
if git diff HEAD~1 HEAD -- services/auth/otpService.ts \
     | grep -E '^[+-]' | grep -qiE 'verifyChallenge|verifyCode|challenge.attempts|codeHash.*actual'; then
  echo "ERROR: verification logic changed — must be a planted challenge only. Aborting."; exit 1
fi
echo "      confirmed: verification path unchanged."

# devCode must still be absent (regression guard from the previous hardening).
if grep -rn "devCode" --include=*.ts --include=*.tsx app components services lib 2>/dev/null \
     | grep -vE ':\s*(//|\*|/\*)' | grep -q .; then
  echo "ERROR: devCode reintroduced — aborting"; exit 1
fi
echo "      confirmed: devCode still absent."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
grep -rqF "WORKER_TEST_LOGIN_ENABLED" .next/server 2>/dev/null \
  || { echo "ERROR: override not compiled in — aborting"; exit 1; }
if grep -rqE "$CODE_LITERAL" .next/server .next/static 2>/dev/null; then
  echo "ERROR: a literal override code is baked into the bundle — aborting"; exit 1
fi
echo "      confirmed: compiled in; no literal code in the bundle."

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

echo "[9] Confirming the override is OFF in production..."
ON=$(az webapp config appsettings list -g "$RG" -n "$APP" \
       --query "[?name=='WORKER_TEST_LOGIN_ENABLED'].value" -o tsv 2>/dev/null)
echo "      WORKER_TEST_LOGIN_ENABLED=${ON:-<unset>}  (unset = inert, as intended)"

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== WORKER TEST LOGIN DEPLOY COMPLETE (disabled) ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
