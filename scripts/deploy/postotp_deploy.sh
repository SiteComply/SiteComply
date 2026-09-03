#!/usr/bin/env bash
# Deploy: R2 — a checked-in worker returns to their dashboard after OTP.
#
# Guards written fresh. What must hold:
#   - the verify route reports `checkedIn`, derived from the worker's OWN open
#     check-ins (not from anything the client sends)
#   - the client branches on it
#   - /check-in/details carries the server-side guard
#   - /check-in/site does NOT — guarding it would break second-site check-in,
#     which is the one regression this change could plausibly cause
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/postotp_deploy.zip
VERIFY='app/api/worker/otp/verify/route.ts'
FORM='components/checkin/CheckInForm.tsx'
DETAILS='app/check-in/details/page.tsx'
SITE='app/check-in/site/page.tsx'
DEPLOYED=94f028e

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== POST-OTP ROUTING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/api/worker/otp/verify/route.ts
app/check-in/details/page.tsx
components/checkin/CheckInForm.tsx
scripts/deploy/postotp_deploy.sh
scripts/postotp_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the verify route, the form, the details page, scripts." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# The flag must come from the SERVER's view of this worker's check-ins.
code "$VERIFY" | grep -qF 'listOpenCheckIns(result.workerId)' \
  || { echo "ERROR: checkedIn is not derived from the worker's open check-ins. Aborting"; exit 1; }
code "$VERIFY" | grep -qF 'checkedIn,' \
  || { echo "ERROR: the verify response does not carry checkedIn. Aborting"; exit 1; }
# workerKnown must be unchanged — other callers depend on it.
code "$VERIFY" | grep -qF 'workerKnown: Boolean(result.workerId)' \
  || { echo "ERROR: workerKnown changed shape. Aborting"; exit 1; }
echo "      verify reports checkedIn from the server's own data; workerKnown intact."

code "$FORM" | grep -qF "router.push(data.checkedIn ? '/worker/dashboard' : '/check-in/details')" \
  || { echo "ERROR: the client does not branch on checkedIn. Aborting"; exit 1; }
echo "      the client routes a checked-in worker to the dashboard."

code "$DETAILS" | grep -qF "if (await getWorkerContext()) redirect('/worker/dashboard')" \
  || { echo "ERROR: /check-in/details is missing the server-side guard. Aborting"; exit 1; }
echo "      /check-in/details guards server-side too."

# THE REGRESSION GUARD. Guarding the site list would strand a worker who is on
# one site and needs to check in at a second.
if code "$SITE" | grep -q 'getWorkerContext'; then
  echo "ERROR: /check-in/site was guarded — that breaks second-site check-in. Aborting"; exit 1
fi
echo "      /check-in/site left reachable, so second-site check-in still works."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
V=".next/server/app/api/worker/otp/verify/route.js"
[ -f "$V" ] || { echo "ERROR: $V not built. Aborting"; exit 1; }
grep -qF 'checkedIn' "$V" || { echo "ERROR: the compiled verify route has no checkedIn. Aborting"; exit 1; }
grep -rqF '/worker/dashboard' .next/static .next/server 2>/dev/null \
  || { echo "ERROR: the dashboard target is absent from the bundle. Aborting"; exit 1; }
D=".next/server/app/check-in/details/page.js"
[ -f "$D" ] || { echo "ERROR: $D not built. Aborting"; exit 1; }
echo "      compiled verify route carries checkedIn; details page built."

echo "[5/8] Packaging zip..."; rm -f "$ZIP"; zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Deploying..."; az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/8] Waiting for BUILD_ID ${NEW_BUILD}..."
LANDED=""; for i in $(seq 1 40); do sleep 15; CURB=$(kudu_buildid); echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  [ "$CURB" = "$NEW_BUILD" ] && { LANDED=yes; break; }; done
[ -n "$LANDED" ] || { echo "WARNING: build id not confirmed. NOT cutting over."; exit 2; }
echo "      new build landed on disk."

echo "[8/8] Cutting over..."; az webapp stop -g "$RG" -n "$APP" -o none; az webapp start -g "$RG" -n "$APP" -o none
CODE=""; for i in $(seq 1 20); do sleep 15; CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"; [ "$CODE" = "200" ] && break; done

echo "== DEPLOY SUMMARY =="; echo "   old build: ${OLD_BUILD:-<unknown>}"; echo "   new build: ${NEW_BUILD}"; echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== POST-OTP ROUTING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
