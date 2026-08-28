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
ZIP=/tmp/siteorder_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SITE-SELECTION ORDERING + BADGES DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
WA="services/workerAccess/workerAssignmentService.ts"
SEL="components/checkin/SiteSelector.tsx"

grep -q "short: 'Not invited'" "$WA" && grep -q "short: 'Awaiting approval'" "$WA" \
  && echo "      confirmed: short labels defined beside the full sentences." \
  || { echo "ERROR: short labels missing — aborting"; exit 1; }

# ONE source: full sentence still appears exactly once, in the service.
[ "$(grep -c 'You have not been invited to this project' "$WA")" -eq 1 ] \
  && echo "      confirmed: full wording still has one source of truth." \
  || { echo "ERROR: full wording duplicated — aborting"; exit 1; }

# The list must NOT carry the full sentence — that is the point of the change.
if grep -q 'You have not been invited to this project' "$SEL"; then
  echo "ERROR: full refusal sentence leaked into the list — aborting"; exit 1
fi
echo "      confirmed: list carries the short label only."

# "Access Granted" must be gated on the requirements check, not on blocked=false.
grep -q "state: 'granted'" "$WA" && grep -q "state: 'unknown'" "$WA" \
  && grep -q 'siteAccessRequirement.findMany' "$WA" \
  && echo "      confirmed: granted vs unknown separated by the requirements query." \
  || { echo "ERROR: Access Granted not gated on requirements — aborting"; exit 1; }

grep -q "state === 'granted'" "$SEL" && grep -q 'Access Granted' "$SEL" \
  && echo "      confirmed: badge rendered only for the granted state." \
  || { echo "ERROR: badge not tied to the granted state — aborting"; exit 1; }

# Ordering + blocked sites still visible and tappable.
grep -q "access?.state !== 'blocked'" "$SEL" && ! grep -q 'disabled={' "$SEL" \
  && echo "      confirmed: usable first, blocked still shown and tappable." \
  || { echo "ERROR: ordering/visibility wrong — aborting"; exit 1; }

# Enforcement unchanged.
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
for N in "Access Granted" "No access" "Not available to you" "Not invited"; do
  grep -rqF "$N" .next/server 2>/dev/null \
    || { echo "ERROR: '$N' not in bundle — aborting"; exit 1; }
done
grep -rqF "You have not been invited to this project" .next/server 2>/dev/null \
  || { echo "ERROR: full wording missing — the gate needs it. Aborting"; exit 1; }
grep -rqF "Tap the site you" .next/server 2>/dev/null \
  || { echo "ERROR: selection copy missing — guard not sensitive, aborting"; exit 1; }
echo "      confirmed: badges, divider, short + full wording all present."

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
[ "$CODE" = "200" ] && echo "== SITE-SELECTION ORDERING + BADGES COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
