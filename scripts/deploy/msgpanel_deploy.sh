#!/usr/bin/env bash
# Deploy: remove the Worker Dashboard "Messages and notifications" panel.
# Same proven flow as prior deploys.
#
# NOTE ON ORDERING: the cleanup migration is NOT applied by this deploy — the
# App Service startup command is `next start`, not `npm run start:azure`, so
# `prisma migrate deploy` never runs. That is safe here ONLY because every read
# of the two settings tables filters on WORKER_DASHBOARD_PANEL_VALUES, so a
# leftover MESSAGES row is never deserialised. Guard [2/8] enforces that.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/msgpanel_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== WORKER MESSAGES PANEL REMOVAL DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
! grep -q "MESSAGES" services/workerDashboard/dashboardPanels.ts \
  && ! grep -q "MESSAGES" components/worker/WorkerNav.tsx \
  && ! grep -q "panels.MESSAGES" app/worker/dashboard/page.tsx \
  && ! grep -qE "^  MESSAGES$" prisma/schema.prisma \
  && [ ! -e app/worker/messages ] \
  && echo "      confirmed: MESSAGES panel removed from code, route deleted." \
  || { echo "ERROR: MESSAGES still referenced — aborting"; exit 1; }

# The stale-enum guard MUST be on every read of the two settings tables, or a
# leftover MESSAGES row takes down the worker dashboard (proven locally).
[ "$(grep -c 'WORKER_DASHBOARD_PANEL_VALUES' services/workerDashboard/dashboardConfigService.ts)" -ge 3 ] \
  && grep -q 'WORKER_DASHBOARD_PANEL_VALUES' services/workerAccess/workerAssignmentService.ts \
  && grep -q 'export const WORKER_DASHBOARD_PANEL_VALUES' services/workerDashboard/dashboardPanels.ts \
  && echo "      confirmed: stale-enum query guard present on all panel reads." \
  || { echo "ERROR: panel read guard missing — aborting"; exit 1; }

[ -f prisma/migrations/20260820100000_remove_worker_messages_panel/migration.sql ] \
  && echo "      confirmed: cleanup migration present (applied separately)." \
  || { echo "ERROR: migration missing — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
for NEEDLE in "Messages and notifications" "Worker messaging isn" "/worker/messages"; do
  if grep -rqF "$NEEDLE" .next/server .next/static 2>/dev/null; then
    echo "ERROR: '$NEEDLE' still present in built bundle — aborting"; exit 1
  fi
done
[ ! -e .next/server/app/worker/messages ] \
  || { echo "ERROR: /worker/messages route still built — aborting"; exit 1; }
# Sensitivity: retained panels must still be in the bundle, so the guards above
# cannot pass simply because nothing was built.
grep -rqF "Site notices, announcements and safety alerts." .next/server 2>/dev/null \
  || { echo "ERROR: retained panel copy missing (guard not sensitive) — aborting"; exit 1; }
echo "      confirmed: panel + route gone from bundle; retained panels intact."

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
[ "$CODE" = "200" ] && echo "== MESSAGES PANEL REMOVAL DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
