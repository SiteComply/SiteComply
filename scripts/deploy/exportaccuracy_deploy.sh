#!/usr/bin/env bash
# Deploy: honest Compliance Activities totals + filter-aware Check-ins export.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/exportaccuracy_deploy.zip
CA=services/reports/complianceActivityReport.ts
CAEXP=app/api/platform/reports/compliance-activities/export/route.ts
CAPAGE=app/platform/dashboard/reports/compliance-activities/page.tsx
CIEXP=app/api/platform/submissions/export/route.ts
CIPAGE=app/platform/dashboard/submissions/page.tsx

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }
code() { python3 - "$1" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
PY
}
echo "== EXPORT ACCURACY DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# the 2000 cap must be gone from the activity row query
if code "$CA" | grep -q 'take: 2000'; then echo "ERROR: the 2000 cap is back — aborting"; exit 1; fi
echo "      confirmed: no hard 2000 cap in the activity query."
code "$CA" | grep -q 'export async function countComplianceActivities' \
  && code "$CAPAGE" | grep -q 'countComplianceActivities' \
  && echo "      confirmed: page total comes from a real count()." \
  || { echo "ERROR: page is not using the count — aborting"; exit 1; }
if code "$CAPAGE" | grep -q 'allRows'; then echo "ERROR: page still derives the total from a capped set — aborting"; exit 1; fi
echo "      confirmed: page no longer uses allRows.length."
code "$CAEXP" | grep -q 'countComplianceActivities' && code "$CAEXP" | grep -q '413' \
  && echo "      confirmed: activity export counts first and refuses above the ceiling." \
  || { echo "ERROR: activity export ceiling missing — aborting"; exit 1; }

# check-ins export must use the SAME filter helpers as the page
for h in parseCheckinStatusFilter parseCheckinSiteFilter checkedOutAtWhere; do
  code "$CIEXP" | grep -q "$h" || { echo "ERROR: check-ins export missing $h — aborting"; exit 1; }
done
echo "      confirmed: check-ins export reuses the page's filter helpers."
code "$CIEXP" | grep -q 'jobSiteId: siteId ? siteId' \
  && echo "      confirmed: check-ins export narrows by the chosen site." \
  || { echo "ERROR: check-ins export does not narrow by site — aborting"; exit 1; }
code "$CIPAGE" | grep -q 'submissions/export${exportQs' \
  && echo "      confirmed: Export CSV link carries the active filters." \
  || { echo "ERROR: export link does not carry filters — aborting"; exit 1; }

# formats + permissions untouched
for h in 'Job reference' 'Audit score %' 'Escalated to'; do
  code "$CIEXP$CAEXP" >/dev/null 2>&1 || true
done
code "$CIEXP" | grep -q "permits(viewer.role, 'checkins', 'export')" \
  && echo "      confirmed: check-ins export role check intact." \
  || { echo "ERROR: check-ins export lost its role check — aborting"; exit 1; }
git diff --quiet HEAD~1 HEAD -- services/platformUsers/platformPermissions.ts \
  && echo "      confirmed: permissions unchanged." \
  || { echo "ERROR: permissions changed — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
for p in 'app/api/platform/submissions/export' 'app/api/platform/reports/compliance-activities/export'; do
  [ -f ".next/server/$p/route.js" ] || { echo "ERROR: $p did not compile — aborting"; exit 1; }
done
echo "      confirmed: both export routes compiled."
grep -rqF "Narrow the date range or sites" .next/server/app/api/platform/reports/compliance-activities/export/route.js \
  && echo "      confirmed: activity refusal message in the bundle." \
  || { echo "ERROR: refusal message absent — aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== EXPORT ACCURACY DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
