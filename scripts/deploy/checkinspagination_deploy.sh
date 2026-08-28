#!/usr/bin/env bash
# Deploy: server-side pagination on the Check-ins workspace.
# Adopts the shared pattern (resolvePage + PaginationControls + WorkSurface footer).
# Exports, permissions, RBAC scoping and both filters must be unchanged.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/checkinspagination_deploy.zip
PAGE=app/platform/dashboard/submissions/page.tsx
SVC=services/submissions/checkinListService.ts

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== CHECK-INS PAGINATION DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# Strip comment lines before matching: a previous deploy aborted on a regex that
# matched its own explanatory comment rather than real code.
code() { grep -vE '^\s*(//|\*|/\*)' "$1"; }

code "$PAGE" | grep -q 'resolvePage(searchParams.page' \
  && code "$PAGE" | grep -q 'PaginationControls' \
  && echo "      confirmed: pagination wired into the Check-ins page." \
  || { echo "ERROR: pagination not wired in — aborting"; exit 1; }

code "$PAGE" | grep -q 'skip: pg.skip' && code "$PAGE" | grep -q 'take: pg.take' \
  && echo "      confirmed: page bounds passed to the row query." \
  || { echo "ERROR: page bounds not passed — aborting"; exit 1; }

code "$SVC" | grep -q 'opts.skip' && code "$SVC" | grep -q 'DEFAULT_PAGE_SIZE' \
  && echo "      confirmed: service takes an offset and the SHARED page size." \
  || { echo "ERROR: service not paginated / not using shared size — aborting"; exit 1; }

# No Check-ins-specific page size may creep back in.
if code "$SVC" | grep -qE 'take\s*=\s*[0-9]+'; then
  echo "ERROR: a hard-coded page size is back in the service — aborting"; exit 1
fi
echo "      confirmed: no hard-coded page size."

# The total must track the ACTIVE filter, or "of N" contradicts the pill above it.
code "$PAGE" | grep -q 'resolvePage(searchParams.page, countByFilter\[status\])' \
  && echo "      confirmed: total is the active filter's count." \
  || { echo "ERROR: total is not the active filter's count — aborting"; exit 1; }

# Exports / permissions / scoping must be byte-identical to the previous commit.
for f in app/api/platform/submissions/export/route.ts \
         services/platformUsers/platformPermissions.ts \
         services/platformUsers/platformAccess.ts \
         services/submissions/checkinFilter.ts \
         components/platform/SiteFilterSelect.tsx \
         components/platform/PaginationControls.tsx \
         lib/pagination.ts; do
  if ! git diff --quiet HEAD~1 HEAD -- "$f"; then
    echo "ERROR: $f changed — exports/permissions/shared pagination must be untouched. Aborting."; exit 1
  fi
done
echo "      confirmed: exports, permissions, scoping and shared pagination unchanged."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle — comments are stripped here)..."
ROUTE=$(find .next/server/app/platform/dashboard/submissions -name 'page.js' 2>/dev/null | head -1)
[ -n "$ROUTE" ] || { echo "ERROR: compiled submissions route not found — aborting"; exit 1; }
echo "      route chunk: $ROUTE"

grep -qF "Showing" "$ROUTE" && grep -qF "Previous" "$ROUTE" \
  && echo "      confirmed: pagination bar compiled into THIS route." \
  || { echo "ERROR: pagination bar absent from the compiled route — aborting"; exit 1; }

# Sensitivity: the two existing filters must still ship, or the guard proves nothing.
grep -rqF "Filter check-ins by status" .next/server 2>/dev/null \
  && grep -rqF "Filter check-ins by site" .next/server 2>/dev/null \
  && echo "      confirmed: status AND site filters still in the bundle." \
  || { echo "ERROR: an existing filter vanished — aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== CHECK-INS PAGINATION DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
