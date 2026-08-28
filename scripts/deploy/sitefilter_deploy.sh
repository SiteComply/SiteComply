#!/usr/bin/env bash
# Deploy: site filter on the Check-ins workspace.
# UI/filtering only — exports, permissions and RBAC scoping unchanged.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sitefilter_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== CHECK-INS SITE FILTER DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
[ -f components/platform/SiteFilterSelect.tsx ] \
  && grep -q 'parseCheckinSiteFilter' app/platform/dashboard/submissions/page.tsx \
  && grep -q 'checkinFilterHref' app/platform/dashboard/submissions/page.tsx \
  && echo "      confirmed: site filter wired into the Check-ins page." \
  || { echo "ERROR: site filter missing — aborting"; exit 1; }

# The two filters must COMPOSE: status links carry the site, row links carry both.
grep -q 'site: siteId' app/platform/dashboard/submissions/page.tsx \
  && echo "      confirmed: row links carry the site filter." \
  || { echo "ERROR: row links drop the site filter — aborting"; exit 1; }

# The org-wide empty branch must NOT key off the site-narrowed count, or an empty
# site hides the filters and strands the user.
grep -q 'hasAnyCheckins' app/platform/dashboard/submissions/page.tsx \
  && ! grep -qE '\{counts\.all === 0 \?' app/platform/dashboard/submissions/page.tsx \
  && echo "      confirmed: empty-site state keeps the filters reachable." \
  || { echo "ERROR: empty-state dead end — aborting"; exit 1; }

# Exports / permissions / scoping must be byte-identical.
for f in app/api/platform/submissions/export/route.ts \
         services/platformUsers/platformPermissions.ts \
         services/platformUsers/platformAccess.ts; do
  if ! git diff --quiet HEAD~1 HEAD -- "$f"; then
    echo "ERROR: $f changed — exports/permissions must be preserved. Aborting."; exit 1
  fi
done
echo "      confirmed: exports, permissions and scoping unchanged."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
grep -rqF "All Sites" .next/server 2>/dev/null \
  || { echo "ERROR: site filter copy not in bundle — aborting"; exit 1; }
grep -rqF "Filter check-ins by site" .next/server 2>/dev/null \
  || { echo "ERROR: site filter control not compiled in — aborting"; exit 1; }
# Sensitivity: the existing status filter must still ship.
grep -rqF "Filter check-ins by status" .next/server 2>/dev/null \
  || { echo "ERROR: status filter missing — guard not sensitive, aborting"; exit 1; }
echo "      confirmed: both filters present in the bundle."

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
[ "$CODE" = "200" ] && echo "== SITE FILTER DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
