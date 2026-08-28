#!/usr/bin/env bash
# Deploy: Admin Check-ins export returns every matching record; the list reports
# the true total and discloses its own cap.
# Filters, permissions (ADMIN_WRITE_ROLES) and the CSV columns must be unchanged.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/adminexport_deploy.zip
SVC=services/submissions/submissionQueryService.ts
ROUTE_SRC=app/api/admin/submissions/export/route.ts
PAGE='app/admin/(dashboard)/submissions/page.tsx'

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== ADMIN SUBMISSIONS EXPORT DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards (comment lines stripped before matching)..."
code() { grep -vE '^\s*(//|\*|/\*)' "$1"; }

# The export must use the UNCAPPED query, and must no longer share the list one.
code "$ROUTE_SRC" | grep -q 'querySubmissionsForExport' \
  && ! code "$ROUTE_SRC" | grep -qE '\bquerySubmissions\(' \
  && echo "      confirmed: export uses the uncapped query, not the list query." \
  || { echo "ERROR: export still on the capped list query — aborting"; exit 1; }

# Count BEFORE load is what keeps the uncapped query safe.
code "$ROUTE_SRC" | grep -q 'countSubmissions(filters)' \
  && code "$ROUTE_SRC" | grep -q 'EXPORT_MAX_ROWS' \
  && code "$ROUTE_SRC" | grep -q '413' \
  && echo "      confirmed: counts first, refuses with 413 above the ceiling." \
  || { echo "ERROR: ceiling safeguard missing — aborting"; exit 1; }

# The ceiling must REFUSE, never truncate: no take: in the export query.
code "$SVC" | grep -A8 'querySubmissionsForExport' | grep -q 'take:' \
  && { echo "ERROR: export query has a take: — that would truncate. Aborting"; exit 1; } \
  || echo "      confirmed: export query is uncapped (refusal, not truncation)."

# The page total must be an independent count, not rows.length.
code "$PAGE" | grep -q 'countSubmissions(filters)' \
  && ! code "$PAGE" | grep -qE '\{rows\.length\} \{rows\.length === 1' \
  && echo "      confirmed: page reports the true total, not rows.length." \
  || { echo "ERROR: page still reports rows.length — aborting"; exit 1; }

# The list cap must still exist and be disclosed.
code "$SVC" | grep -q 'LIST_MAX_ROWS = 1000' \
  && code "$PAGE" | grep -q 'export CSV' \
  && echo "      confirmed: list still capped at 1000 and says so." \
  || { echo "ERROR: list cap or its disclosure missing — aborting"; exit 1; }

# Permissions + CSV columns must be byte-identical where they live.
git diff --quiet HEAD~1 HEAD -- lib/adminAuth.ts \
  && echo "      confirmed: admin permissions unchanged." \
  || { echo "ERROR: lib/adminAuth.ts changed — aborting"; exit 1; }

for h in 'Job reference' 'Check-in reference' 'Compliance status'; do
  code "$ROUTE_SRC" | grep -qF "$h" || { echo "ERROR: CSV header '$h' missing — aborting"; exit 1; }
done
code "$ROUTE_SRC" | grep -q 'ADMIN_WRITE_ROLES' \
  || { echo "ERROR: export lost its role check — aborting"; exit 1; }
echo "      confirmed: CSV columns and the export role check intact."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
EXPCHUNK=$(find .next/server/app/api/admin/submissions/export -name 'route.js' 2>/dev/null | head -1)
[ -n "$EXPCHUNK" ] || { echo "ERROR: compiled export route not found — aborting"; exit 1; }
echo "      export chunk: $EXPCHUNK"
grep -qF "above the" "$EXPCHUNK" && grep -qF "Narrow the date range" "$EXPCHUNK" \
  && echo "      confirmed: refusal message compiled into the export route." \
  || { echo "ERROR: refusal message absent from the bundle — aborting"; exit 1; }

PAGECHUNK=$(find '.next/server/app/admin/(dashboard)/submissions' -maxdepth 1 -name 'page.js' 2>/dev/null | head -1)
[ -n "$PAGECHUNK" ] || { echo "ERROR: compiled admin submissions page not found — aborting"; exit 1; }
grep -qF "export CSV for all" "$PAGECHUNK" \
  && echo "      confirmed: cap disclosure compiled into the page." \
  || { echo "ERROR: cap disclosure absent from the bundle — aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== ADMIN EXPORT DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
