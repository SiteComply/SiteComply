#!/usr/bin/env bash
# CPP TIER 2 — STRUCTURED RISK REGISTER — production deploy.
#
# THE MIGRATION RUNS FIRST AND IS NOT PART OF THIS SCRIPT. Production startup is
# `next start`, so `prisma migrate deploy` never runs here. ~/cpp_tier2.sql is
# applied by hand BEFORE this script, and [2/8] refuses to deploy until it can
# see the result in the LIVE database.
#
# That ordering is not optional. Prisma lists every column and enum value
# explicitly, so a build that knows SiteRiskTopic THROWS against a database that
# does not have it — and getCppDraft is on a live path. Migration first, with the
# old build still serving; deploy second. Rollback is only safe between the two.
#
# POSTGRES CANNOT REMOVE AN ENUM VALUE: DocumentCategory.DRAWING and the
# RiskTopic type are permanent. Rollback = redeploy the previous build and leave
# them inert. See ~/cpp_tier2_rollback.sql.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cpptier2_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/8] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/8] Asserting the MIGRATION is already live..."
# Asked of the DATABASE, not of a file. A schema.prisma that mentions the model
# proves only that somebody edited it.
LIVE=$(~/pgprod -At -c "
  SELECT
    (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
      WHERE t.typname='DocumentCategory' AND e.enumlabel='DRAWING')
  || '/' ||
    (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
      WHERE t.typname='RiskTopic')
  || '/' ||
    (SELECT count(*) FROM information_schema.tables WHERE table_name='SiteRiskTopic');
" 2>/dev/null | tr -d '[:space:]')
echo "      live: DRAWING/RiskTopic values/SiteRiskTopic = ${LIVE:-<unreadable>}"
[ "$LIVE" = "1/25/1" ] || fail "the migration is not fully live (expected 1/25/1) - run ~/cpp_tier2.sql first"
echo "  ok   migration confirmed in the live database"

echo "[3/8] Asserting the feature in the SOURCE..."
SVC=services/sites/cppService.ts
# Comments stripped: these files document what they replaced and would otherwise
# match their own history.
SVC_CODE=$(grep -v '^[[:space:]]*\*' "$SVC" | grep -v '^[[:space:]]*//' | grep -v '^[[:space:]]*/\*')
echo "$SVC_CODE" | grep -q "getCppDraft" || fail "comment strip removed real code - checks would be vacuous"
echo "$SVC_CODE" | grep -q "riskSection('risks-safety'" || fail "the safety risk section is missing"
echo "$SVC_CODE" | grep -q "riskSection('risks-health'" || fail "the health risk section is missing"
echo "$SVC_CODE" | grep -q "d.category === 'DRAWING'" || fail "the drawings appendix is not using the category"
echo "$SVC_CODE" | grep -q "DRAWING_TITLE_HINTS" && fail "filename matching is back"
# The narrative fields are preserved by explicit agreement.
echo "$SVC_CODE" | grep -q "section('hazards', 'Hazards and existing site risks'" \
  || fail "the narrative hazard fields were dropped - they are to be preserved"
# Tier 2 must not move completion, exactly as Tier 1 did not.
grep -q "gatesCompletion: false" "$SVC" || fail "risk sections are not reference-only"
REQ=$(sed -n '/const REQUIREMENTS/,/^export function requirementsFor/p' services/sites/siteSetupCompletion.ts)
echo "$REQ" | grep -q "of: 'siteRules'" || fail "REQUIREMENTS slice mis-located - the next check would be vacuous"
echo "$REQ" | grep -qE "RiskTopic|cppRisk|PREVENTING_FALLS|ASBESTOS" \
  && fail "a risk topic leaked into the completion requirements"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
for s in cpp_tier2_verify cpp_content_verify cpp_completion_verify site_rules_verify induction_grouping_verify; do
  npx tsx "scripts/$s.ts" | tail -1 | grep -q ", 0 failed" || fail "$s has failures"
done
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cpptier2_build.log 2>&1 || {
  tail -30 /tmp/cpptier2_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Significant safety risks and controls" "Significant health risks and controls" \
         "Considered — does not apply to this site" "APPLIES — control measures not yet recorded" \
         "Drawings & Site Plans"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
# A couple of topics that are the whole point of asking.
grep -rqF "Asbestos — survey, management and removal" $SHIPPED 2>/dev/null \
  || fail "the asbestos topic is not in the build"
grep -rqF "Control of lifting operations" $SHIPPED 2>/dev/null \
  || fail "the lifting operations topic is not in the build"
echo "  ok   risk register present in the shipped output"

echo "[7/8] Packaging and deploying..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[8/8] Cutting over (stop/start) and verifying..."
sleep 60
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 24); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done
[ "$CODE" = "200" ] || fail "health never returned 200"

SERVED=""
for i in $(seq 1 10); do
  SERVED=$(served_buildid); echo "      served build id: ${SERVED:-<unreadable>}"
  [ "$SERVED" = "$NEW_BUILD" ] && break
  sleep 15
done
[ "$SERVED" = "$NEW_BUILD" ] || fail "prod is serving ${SERVED:-<unreadable>}, not ${NEW_BUILD}"

echo "      route smoke test (3xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in /platform/dashboard/sites /check-in/site /worker/dashboard ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
