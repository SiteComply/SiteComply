#!/usr/bin/env bash
# CPP TIER 1 CONTENT — production deploy.
#
# Surfaces content that ALREADY EXISTS in the platform: site induction
# arrangements, competence/access requirements, the Site Rules Library, PPE,
# permit-to-work arrangements, RAMS references and the monitoring schedule.
# Read-only wiring — no schema change, no migration, no new data capture.
#
# THE PROPERTY THAT MATTERS MOST IS NEGATIVE: none of this may move a site's
# completion percentage. Completion was only just put on an honest footing, and
# a section added for reference must not quietly become a requirement. [3/8]
# refuses to deploy if any wired section starts gating completion.
#
# Rollback is a redeploy of the previous build. Nothing is written.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cppcontent_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/8] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/8] Asserting this change needs NO migration..."
git diff --quiet HEAD -- prisma/schema.prisma \
  || fail "prisma/schema.prisma is modified - this needs a migration and a different script"
echo "  ok   schema untouched"

echo "[3/8] Asserting the wiring, and that it changes nothing about completion..."
SVC=services/sites/cppService.ts
# Comments are stripped: this file EXPLAINS what it replaced and names the old
# behaviour while doing so. A plain grep would match its own documentation - the
# trap hit three times already on this project.
SVC_CODE=$(grep -v '^[[:space:]]*\*' "$SVC" | grep -v '^[[:space:]]*//' | grep -v '^[[:space:]]*/\*')
echo "$SVC_CODE" | grep -q "getCppDraft" \
  || fail "the comment strip removed real code - every check below would be vacuous"

# The seven wired sources.
for pat in "getSiteRules(siteId)" "getSitePpeRequirements(siteId)" \
           "getSiteServiceConfig(viewer, siteId)" "siteInductionConfig.findUnique" \
           "siteAccessRequirement.findMany" "category: 'RAMS'" \
           "complianceSchedule.findMany"; do
  echo "$SVC_CODE" | grep -qF "$pat" || fail "wired source missing: $pat"
done

# COMPLETION MUST BE UNTOUCHED.
echo "$SVC_CODE" | grep -q "gatesCompletion: false" \
  || fail "no section is marked as reference-only - wiring would gate completion"
echo "$SVC_CODE" | grep -q "if (!s.gatesCompletion || s.stepKey === null) continue;" \
  || fail "status stamping no longer skips wired sections"
COMP=services/sites/siteSetupCompletion.ts
REQ=$(sed -n '/const REQUIREMENTS/,/^export function requirementsFor/p' "$COMP")
echo "$REQ" | grep -qE "ppe|rams|permits|monitoring|induction|competence" \
  && fail "a wired source has been added to the completion requirements"
echo "$REQ" | grep -q "of: 'siteRules'" \
  || fail "the REQUIREMENTS slice is empty or mis-located - the check above is vacuous"

# Site rules must come from the Library, with the free text demoted.
echo "$SVC_CODE" | grep -q "section('rules', 'Site rules'" \
  && fail "the rules section is reading the free-text field again"

# Read-only.
echo "$SVC_CODE" | grep -qE "prisma\.[a-zA-Z]+\.(create|update|upsert|delete)" \
  && fail "the CPP service performs a write - it must stay read-only"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
for s in cpp_content_verify cpp_completion_verify site_rules_verify induction_grouping_verify; do
  npx tsx "scripts/$s.ts" | tail -1 | grep -q ", 0 failed" || fail "$s has failures"
done
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cppcontent_build.log 2>&1 || {
  tail -30 /tmp/cppcontent_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
# Scoped to what ships: .next/cache is excluded from the zip and written
# asynchronously after the build reports success, so grepping all of .next is
# non-deterministic - it failed a correct build once already.
SHIPPED=".next/server .next/static"
for t in "Site induction arrangements" "Competence and site access requirements" \
         "Personal protective equipment" "Permit-to-work arrangements" \
         "Risk assessments and method statements" "Monitoring and inspection arrangements"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "section missing from the build: $t"
done
grep -rqF "No access requirements are enforced on this site" $SHIPPED 2>/dev/null \
  || fail "the honest empty state is not in the build"
echo "  ok   all seven sections present"

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
