#!/usr/bin/env bash
# Deploy: remove internal project references (SC-0xx / REV-1 / dev terminology)
# from production UI copy. Same proven flow as prior deploys.
#
# The decisive guard is [4b]: a production `next build` strips comments, so ANY
# SC-nnn/REV-1 hit in the built bundle is by definition a shippable UI string.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/screfs_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-REFERENCE CLEANUP DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
grep -q 'track their approval' services/workerDashboard/dashboardPanels.ts \
  && ! grep -q '(SC-009)' services/workerDashboard/dashboardPanels.ts \
  && ! grep -q '(SC-011)' components/platform/InductionValidityConfig.tsx \
  && ! grep -q '(SC-019)' services/closeOut/closeOutSections.ts \
  && ! grep -q 'SC-018 removed' services/audits/auditTemplateSeed.ts \
  && ! grep -q 'Sent from Phase 2' components/platform/ScheduleActivityForm.tsx \
  && ! grep -q 'later stage' "app/admin/(dashboard)/platform-users/page.tsx" \
  && ! grep -q 'mock mode' services/ai/mockProvider.ts \
  && ! grep -q 'AI_PROVIDER=' services/ai/mockProvider.ts \
  && ! grep -q 'devCode' components/checkin/CheckInForm.tsx \
  && echo "      confirmed: all identified UI strings cleaned in source." \
  || { echo "ERROR: source guards failed — aborting"; exit 1; }
[ ! -f components/platform/PreviewBanner.tsx ] && [ ! -f components/platform/SectionPreview.tsx ] \
  && echo "      confirmed: orphaned preview/scaffolding components removed." \
  || { echo "ERROR: scaffolding components still present — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guard: no SC-nnn / REV-1 string may survive into the bundle..."
HITS=$(grep -rhoE "SC-[0-9]{2,3}|REV[- ]?1" .next/server .next/static 2>/dev/null | sort -u)
if [ -n "$HITS" ]; then
  echo "ERROR: internal references present in built bundle — aborting:"; echo "$HITS"; exit 1
fi
grep -rq 'track their approval' .next/server 2>/dev/null \
  || { echo "ERROR: corrected copy not found in bundle (guard not sensitive) — aborting"; exit 1; }
echo "      confirmed: zero SC/REV strings in bundle; corrected copy present."

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
[ "$CODE" = "200" ] && echo "== SC-REFERENCE CLEANUP DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
