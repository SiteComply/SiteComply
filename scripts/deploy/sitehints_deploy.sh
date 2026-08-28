#!/usr/bin/env bash
# Deploy: promote Invite Worker to the Workers tab toolbar.
# UI placement only — one invite path, permissions unchanged.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sitehints_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SITE-SELECTION ACCESS HINTS DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
WA="services/workerAccess/workerAssignmentService.ts"
SEL="components/checkin/SiteSelector.tsx"
LIST="app/check-in/site/page.tsx"

grep -q 'export function evaluateAssignmentGate' "$WA" \
  && grep -q 'export async function siteAccessHintsForWorker' "$WA" \
  && echo "      confirmed: shared gate + bulk hint lookup present." \
  || { echo "ERROR: shared gate/hints missing — aborting"; exit 1; }

# ONE source of wording: the phrase must exist exactly once in the service.
[ "$(grep -c 'You have not been invited to this project' "$WA")" -eq 1 ] \
  && echo "      confirmed: refusal wording has one source of truth." \
  || { echo "ERROR: refusal wording duplicated — the list can drift. Aborting"; exit 1; }

# ONE bulk query, not one per site.
[ "$(sed -n '/export async function siteAccessHintsForWorker/,/^}/p' "$WA" | grep -c 'await prisma\.')" -eq 1 ] \
  && echo "      confirmed: a single assignment query for the whole list." \
  || { echo "ERROR: hint lookup queries per site — aborting"; exit 1; }

# Sites must be SHOWN, not hidden or disabled.
grep -q 'blockedReason' "$SEL" && ! grep -q 'disabled={' "$SEL" \
  && echo "      confirmed: blocked sites shown and still tappable." \
  || { echo "ERROR: blocked sites hidden or disabled — aborting"; exit 1; }
grep -q 'siteAccessHintsForWorker' "$LIST" \
  || { echo "ERROR: list page not using the hints — aborting"; exit 1; }

# Enforcement must be unchanged.
grep -q 'canWorkerCheckIn' "app/check-in/site/[siteId]/page.tsx" \
  && grep -q 'canWorkerCheckIn' services/submissions/submissionService.ts \
  && grep -q 'canWorkerCheckIn' services/induction/inductionValidityService.ts \
  && echo "      confirmed: landing, submit and express checks all intact." \
  || { echo "ERROR: an access check was removed — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
grep -rqF "No access" .next/server 2>/dev/null \
  || { echo "ERROR: access badge not in bundle — aborting"; exit 1; }
grep -rqF "You have not been invited to this project" .next/server 2>/dev/null \
  || { echo "ERROR: refusal wording not in bundle — aborting"; exit 1; }
# Sensitivity: the normal selection path must still ship.
grep -rqF "Tap the site you" .next/server 2>/dev/null \
  || { echo "ERROR: site selection copy missing — guard not sensitive, aborting"; exit 1; }
echo "      confirmed: badge + reason + normal path all present."

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
[ "$CODE" = "200" ] && echo "== SITE-SELECTION ACCESS HINTS COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
