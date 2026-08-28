#!/usr/bin/env bash
# Deploy: explicit response contract for the worker OTP endpoint.
# Response shaping only — provider selection and auth behaviour untouched.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/otpshape_deploy.zip
ROUTE=app/api/worker/otp/request/route.ts

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== WORKER OTP RESPONSE HARDENING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# The field must not exist anywhere (comments excepted).
if grep -rn "devCode" --include=*.ts --include=*.tsx app components services lib 2>/dev/null \
     | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*|/\*)' | grep -q .; then
  echo "ERROR: devCode still referenced in code — aborting"
  grep -rn "devCode" --include=*.ts --include=*.tsx app components services lib \
    | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*|/\*)'
  exit 1
fi
echo "      confirmed: devCode exists nowhere in code."

# The route must never hand back the service result wholesale. Comment lines are
# excluded — the route documents the banned form in prose, and matching that is a
# false positive (it aborted a deploy once).
if grep -nE 'NextResponse\.json\(\s*result\s*[,)]' "$ROUTE" \
     | grep -qvE ':\s*(//|\*|/\*)'; then
  echo "ERROR: worker OTP route still returns the raw service result — aborting"; exit 1
fi
echo "      confirmed: worker OTP route builds an explicit response."

# Provider selection, Twilio and auth behaviour must be byte-identical.
for f in services/sms/index.ts services/sms/smsConfigService.ts \
         services/sms/twilioProvider.ts services/sms/acsProvider.ts \
         app/api/worker/otp/verify/route.ts app/api/platform/auth/start/route.ts; do
  if ! git diff --quiet HEAD~1 HEAD -- "$f"; then
    echo "ERROR: $f changed — this deploy must be response-shaping only. Aborting."; exit 1
  fi
done
echo "      confirmed: provider selection + auth behaviour unchanged."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
if grep -rqF "devCode" .next/server .next/static 2>/dev/null; then
  echo "ERROR: devCode present in built bundle — aborting"; exit 1
fi
# Sensitivity: the retained contract fields must still ship, so the guard above
# cannot pass simply because the route was not built.
for F in maskedMobile expiresInSeconds resendInSeconds; do
  grep -rqF "$F" .next/server 2>/dev/null \
    || { echo "ERROR: contract field $F missing — guard not sensitive, aborting"; exit 1; }
done
echo "      confirmed: devCode absent; response contract intact."

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
[ "$CODE" = "200" ] && echo "== OTP HARDENING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
