#!/usr/bin/env bash
# SC-025 production CODE deploy (Project Completion & Archive Management). The
# additive migration 20260810090000_add_project_completion must already be
# applied — run scripts/sc025_migrate.sh first.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sc025_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-025 CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Confirming SC-025 code IS present in this artifact..."
[ -f services/projectClosure/closureService.ts ] \
  && [ -f services/projectClosure/closureChecklist.ts ] \
  && [ -f services/projectClosure/projectWritable.ts ] \
  && [ -f components/platform/ProjectCompletionPanel.tsx ] \
  && [ -f components/platform/ProjectClosureHistory.tsx ] \
  && [ -f 'app/api/platform/sites/[id]/completion/route.ts' ] \
  && grep -q 'COMPLETED' prisma/schema.prisma \
  && grep -q 'model SiteClosureEvent' prisma/schema.prisma \
  && echo "      confirmed: closure service, checklist, guard, routes and UI present." \
  || { echo "ERROR: SC-025 code missing — aborting"; exit 1; }

# BEHAVIOUR, not file presence.

# The data-layer read-only guard must be attached to the shared client. Without
# it, a completed project is read-only only where someone remembered a check.
grep -q 'completed-project-read-only' lib/prisma.ts \
  && grep -q 'ProjectClosedError' lib/prisma.ts \
  || { echo "ERROR: the read-only guard is not attached to the Prisma client — aborting"; exit 1; }
echo "      confirmed: read-only guard attached at the data layer."

# Closure must run inside the lifecycle bypass, or it blocks its own writes.
grep -q 'runProjectLifecycleWrite' services/projectClosure/closureService.ts \
  || { echo "ERROR: closure does not use the lifecycle bypass — aborting"; exit 1; }
echo "      confirmed: closure runs inside the lifecycle bypass."

# The asymmetric permission split is the approved decision.
grep -q "PROJECT_REOPEN_ROLES: PlatformRoleValue\[\] = \['DIRECTOR'\]" services/projectClosure/closureService.ts \
  || { echo "ERROR: reopening is not Director-only — aborting"; exit 1; }
grep -q "'SITE_MANAGER'" services/projectClosure/closureService.ts \
  || { echo "ERROR: Site Managers cannot close projects — aborting"; exit 1; }
echo "      confirmed: close = SM+Director, reopen = Director only."

# Reopening must demand a reason.
grep -q 'reason_required' services/projectClosure/closureService.ts \
  || { echo "ERROR: reopening does not require a reason — aborting"; exit 1; }
echo "      confirmed: reopening requires a recorded reason."

# Assignments are suspended, never deleted.
grep -q "data: { status: 'SUSPENDED' }" services/projectClosure/closureService.ts \
  || { echo "ERROR: closure does not suspend assignments — aborting"; exit 1; }
if grep -q 'workerSiteAssignment.deleteMany' services/projectClosure/closureService.ts; then
  echo "ERROR: closure DELETES assignments — history must be preserved — aborting"; exit 1
fi
echo "      confirmed: worker access suspended, not deleted."

# Reports exclude completed projects by default, with an explicit opt-in.
grep -q 'includeCompleted' services/reports/reportFilters.ts \
  && grep -q 'includeCompleted' components/platform/ReportView.tsx \
  || { echo "ERROR: report separation missing — aborting"; exit 1; }
echo "      confirmed: reports exclude completed projects by default."

# The legacy archive control must not be a back door into reopening.
grep -q 'project_completed' services/sites/platformSiteService.ts \
  || { echo "ERROR: the archive/edit path does not refuse completed projects — aborting"; exit 1; }
echo "      confirmed: the legacy archive/edit path refuses completed projects."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -5
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

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
if [ -z "$LANDED" ]; then
  echo "WARNING: new build id not confirmed on disk yet. NOT cutting over."
  exit 2
fi
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
[ "$CODE" = "200" ] && echo "== SC-025 CODE DEPLOY COMPLETE ==" || echo "== HEALTH NOT 200 — investigate =="
