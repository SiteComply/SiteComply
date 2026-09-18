#!/usr/bin/env bash
# CPP COMPLETION — DERIVED FROM CONTENT — production deploy.
#
# Completion was a list of ticked step keys that never saw a field value, so a
# site could be marked through with everything blank and the Construction Phase
# Plan printed "Status: All required sections recorded" directly above a list of
# the sections that were missing. Completion is now computed from the data;
# `completedSteps` becomes a REVIEWED marker that carries no compliance claim.
#
# NO SCHEMA CHANGE. completedSteps is reused in place, so there is no migration
# and no ordering constraint. [2/8] proves that rather than asserting it.
#
# EXPECTED AND INTENDED IMPACT: sites that were ticked through with thin data
# will report a LOWER percentage than before. That is the point. The wizard
# explains the recalculation in place — [3/8] refuses to deploy without it.
#
# Rollback is a redeploy of the previous build; nothing is written or migrated.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cppcompletion_deploy.zip

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

echo "[3/8] Asserting the new completion model in the SOURCE..."
COMP=services/sites/siteSetupCompletion.ts
WIZ=components/platform/SiteSetupWizard.tsx
CONSTS=services/sites/siteSetupConstants.ts
CPPSVC=services/sites/cppService.ts
CPPPAGE="app/platform/dashboard/sites/[id]/cpp/page.tsx"

[ -f "$COMP" ] || fail "the derived-completion module is missing"
grep -q "export function computeDerivedCompleteness" "$COMP" \
  || fail "computeDerivedCompleteness is gone"
grep -q "export function hasSubstance" "$COMP" \
  || fail "the substance check is gone - presence alone would pass again"

# The old tick-based model must be DELETED, not merely unused. Comments are
# stripped first: this module documents what it replaced and names the old
# function while doing so, and a plain grep would match its own history.
CONSTS_CODE=$(grep -v '^[[:space:]]*\*' "$CONSTS" | grep -v '^[[:space:]]*//')
echo "$CONSTS_CODE" | grep -q "export function computeCompleteness" \
  && fail "the tick-based computeCompleteness is back"
echo "$CONSTS_CODE" | grep -q "SETUP_STEPS" \
  || fail "the comment strip removed real code - the check above is vacuous"

# Nothing may compute completion from the tick list again.
grep -q "computeCompleteness" "$WIZ" && fail "the wizard imports the old model"
grep -q "computeDerivedCompleteness" "$WIZ" \
  || fail "the wizard does not use derived completion"
grep -q "Save and mark reviewed" "$WIZ" \
  || fail "the wizard still claims to mark sections complete"
grep -q "Save and mark complete" "$WIZ" && fail "the old complete button is back"

# The explanatory messaging is a REQUIREMENT of this change, not a nicety:
# percentages drop on existing sites and an unexplained drop reads as a fault.
grep -q "Completion is now based on the information recorded" "$WIZ" \
  || fail "the recalculation explainer is missing"
grep -q "reviewedButIncomplete" "$WIZ" \
  || fail "previously-ticked-but-incomplete sections are not surfaced"

# The CPP's printed status and its gap list must share one source.
grep -q "completeness.statuses\[s.stepKey\]" "$CPPSVC" \
  || fail "the CPP does not take section status from the shared computation"
grep -q "function isRelevant" "$CPPSVC" \
  && fail "isRelevant is back - that is a third opinion on what counts as a gap"
grep -q "outstandingTitles" "$CPPPAGE" \
  && fail "the CPP page still uses its own gap list"
grep -q "cpp.outstanding.length" "$CPPPAGE" \
  || fail "the CPP page does not report the shared outstanding count"

# Site rules must come from the LIBRARY, not the free-text field.
grep -q "of: 'siteRules'" "$COMP" \
  || fail "the rules requirement no longer reads the Site Rules Library"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
npx tsx scripts/cpp_completion_verify.ts | tail -1 | grep -q ", 0 failed" \
  || fail "cpp_completion_verify has failures"
npx tsx scripts/site_rules_verify.ts | tail -1 | grep -q ", 0 failed" \
  || fail "site_rules_verify has failures"
npx tsx scripts/induction_grouping_verify.ts | tail -1 | grep -q ", 0 failed" \
  || fail "induction_grouping_verify has failures"
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cppcompletion_build.log 2>&1 || {
  tail -30 /tmp/cppcompletion_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
# SCOPED TO WHAT SHIPS. .next/cache is excluded from the zip and is written
# asynchronously after the build reports success, so grepping all of .next is
# non-deterministic - it failed a correct build once already.
SHIPPED=".next/server .next/static"
grep -rq "Completion is now based on the information recorded" $SHIPPED 2>/dev/null \
  || fail "the recalculation explainer is not in the build"
grep -rq "Save and mark reviewed" $SHIPPED 2>/dev/null \
  || fail "the reviewed button is not in the build"
grep -rq "Save and mark complete" $SHIPPED 2>/dev/null \
  && fail "the old complete button is in the build"
echo "  ok   new model present, old wording absent"

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
  SERVED=$(served_buildid)
  echo "      served build id: ${SERVED:-<unreadable>}"
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
