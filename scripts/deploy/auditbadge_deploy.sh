#!/usr/bin/env bash
# Deploy: audit status badge — single line, consistent row heights.
# Visual only: colours and geometry must be unchanged.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/auditbadge_deploy.zip
kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

echo "== AUDIT STATUS BADGE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# Colours must be untouched — amber IN_PROGRESS in particular.
git diff --quiet HEAD~1 HEAD -- services/audits/auditConstants.ts \
  && echo "      confirmed: auditConstants.ts byte-identical (colours unchanged)." \
  || { echo "ERROR: the colour map changed — aborting"; exit 1; }
grep -qF "IN_PROGRESS: 'bg-hivis-400/25 text-ink'," services/audits/auditConstants.ts \
  && echo "      confirmed: amber IN_PROGRESS colour intact." \
  || { echo "ERROR: the amber colour changed — aborting"; exit 1; }

# Every place the shared badge renders must carry whitespace-nowrap.
MISS=""
for f in app/platform/dashboard/audits/page.tsx \
         'app/platform/dashboard/audits/[id]/page.tsx' \
         'app/platform/dashboard/sites/[id]/compliance/page.tsx'; do
  n=$(grep -c 'rounded-full px-2' "$f" || true)
  w=$(grep -c 'whitespace-nowrap rounded-full px-2' "$f" || true)
  [ "$n" = "$w" ] || MISS="$MISS $f($w/$n)"
done
[ -z "$MISS" ] && echo "      confirmed: every status badge carries whitespace-nowrap." \
  || { echo "ERROR: badges missing nowrap:$MISS — aborting"; exit 1; }

# Geometry must be unchanged — only the two new classes were added.
git diff HEAD~1 HEAD -- app/ | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -vE 'inline-flex items-center whitespace-nowrap rounded-full|inline-flex rounded-full' \
  && { echo "ERROR: something other than the badge class changed — aborting"; exit 1; } \
  || echo "      confirmed: only badge class strings changed."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
# Scoped to the audit badge's own literal. An earlier version of this guard
# checked EVERY rounded-full pill in the bundle and failed on count badges and
# chips, which legitimately do not need nowrap. Seven other status badges
# (Actions, Permits, Check-ins, Workers, Schedules, Audit findings) still use the
# un-nowrapped literal by design — they are outside this change's scope — so the
# old string must NOT be asserted absent globally.
grep -rqF 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold' .next/server .next/static 2>/dev/null \
  && echo "      confirmed: nowrapped audit badge literal compiled." \
  || { echo "ERROR: nowrapped badge literal absent from the bundle — aborting"; exit 1; }
grep -rqF 'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold' .next/server .next/static 2>/dev/null \
  && echo "      confirmed: nowrapped detail-header badge literal compiled." \
  || { echo "ERROR: detail-header badge literal absent — aborting"; exit 1; }
grep -rq 'bg-hivis-400/25' .next/server .next/static 2>/dev/null \
  && echo "      confirmed: amber colour compiled." \
  || { echo "ERROR: amber colour absent from the bundle — aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== AUDIT BADGE DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
