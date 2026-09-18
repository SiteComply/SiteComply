#!/usr/bin/env bash
# CPP GUIDED WORKFLOW — production deploy.
#
# The revision controls worked but only REPORTED state: two headers that could
# contradict each other, a row of equally-weighted buttons, and a primary action
# reading "Create a revision from the current plan" — a mechanism with no stated
# purpose. This computes ONE recommended next action from the real state, adds a
# stage indicator, and puts outstanding content in front of the person about to
# sign for it.
#
# NO MIGRATION. Nothing is stored; the guidance is derived. [2/8] proves that
# rather than asserting it.
#
# WARN, NEVER BLOCK: an incomplete plan can still be prepared and issued, because
# CDM expects the plan to exist before work starts and to develop as the project
# proceeds. The guards below fail if that ever becomes a refusal.
#
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cppworkflow_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}
# Comments stripped before every content grep. These files document the design
# decisions and name the very things being asserted; a raw grep matches its own
# documentation, which has caught this project four times now.
strip() { grep -v '^[[:space:]]*\*' "$1" | grep -v '^[[:space:]]*//' | grep -v '^[[:space:]]*///' | grep -v '^[[:space:]]*/\*'; }

echo "[1/8] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/8] Asserting this change needs NO migration..."
git diff --quiet HEAD -- prisma/schema.prisma \
  || fail "prisma/schema.prisma is modified - this needs a migration and a different script"
echo "  ok   schema untouched"

echo "[3/8] Asserting the guided workflow in the SOURCE..."
WF=services/sites/cppWorkflow.ts
BAR=components/platform/CppRevisionBar.tsx
PAGE=app/platform/dashboard/sites/[id]/cpp/page.tsx
WF_CODE=$(strip "$WF")
echo "$WF_CODE" | grep -q "recommendNextAction" || fail "strip removed real code - checks vacuous"

# One computed action, not a row of equal buttons.
grep -q "recommendNextAction({" "$BAR" || fail "the bar no longer computes a recommended action"
grep -q "CPP_STAGES.map" "$BAR" || fail "the stage indicator is missing"
grep -q "Create a revision from the current plan" "$BAR" \
  && fail "the old technical wording is back"

# A current plan must still offer something.
echo "$WF_CODE" | grep -q "kind: 'PREPARE_REVISION', label: \`Prepare Revision \${input.issued.version + 1}\`" \
  || fail "a current plan offers no secondary action - the screen would dead-end"

# WARN, NEVER BLOCK.
grep -q "Prepare it anyway" "$BAR" || fail "preparing over gaps no longer offers to proceed"
grep -q "This plan still has information outstanding" "$BAR" \
  || fail "the approval dialog no longer shows outstanding content"

# The two headers must not be able to contradict each other.
grep -q "Construction Phase Plan — draft" "$PAGE" \
  && fail "the unconditional draft heading is back"

# Readiness must actually reach the guidance - document control and completion
# were built in separate phases and did not know about each other.
grep -q "readiness: liveDraft.readiness" services/sites/cppRevisionService.ts \
  || fail "readiness does not reach the revision state"
grep -q "riskTopicsUnconsidered: risks.unanswered" services/sites/cppService.ts \
  || fail "the draft no longer reports risk readiness"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
for s in cpp_workflow_verify cpp_approval_verify cpp_revisions_verify cpp_tier3a_verify \
         cpp_tier2_verify cpp_content_verify cpp_completion_verify site_rules_verify; do
  npx tsx "scripts/$s.ts" | tail -1 | grep -q ", 0 failed" || fail "$s has failures"
done
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cppworkflow_build.log 2>&1 || {
  tail -30 /tmp/cppworkflow_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Revision prepared" "No plan has been issued for this project yet" \
         "Prepare it anyway" "This plan still has information outstanding" \
         "Which sections changed?" "Nothing needs doing. Revise the plan when the project changes."; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "Create a revision from the current plan" $SHIPPED 2>/dev/null \
  && fail "the old technical wording is in the build"
grep -rqF "Construction Phase Plan — draft" $SHIPPED 2>/dev/null \
  && fail "the contradictory heading is in the build"
echo "  ok   guided workflow present, old wording absent"

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
