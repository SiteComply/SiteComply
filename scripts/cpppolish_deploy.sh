#!/usr/bin/env bash
# CPP WORKFLOW POLISH — production deploy.
#
# Wording, hierarchy and styling of the workflow controls. Functionality is
# unchanged.
#
#   - "Issued (Rev 1)" named the EVENT; a reader needs to know which document is
#     in force, so the switcher now reads "Revision 1 (Current)".
#   - The primary action repeated the revision number the headline above already
#     gave, making it long as well as prominent: now "Approve and issue".
#   - "Discard this revision" was bare underlined text and read as a caption
#     rather than a control.
#
# The cause of the last two: these controls were hand-rolled class strings while
# every other platform editor uses the shared Button component. They use it now,
# which is what makes them match the rest of the product.
#
# NO MIGRATION. The guidance is derived, nothing is stored.
#
# WARN, NEVER BLOCK still holds: an incomplete plan can be prepared and issued,
# because CDM expects the plan to exist before work starts and develop after. The
# guards below fail if that ever becomes a refusal.
#
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cpppolish_deploy.zip

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

echo "[3/8] Asserting the workflow and its controls in the SOURCE..."
WF=services/sites/cppWorkflow.ts
BAR=components/platform/CppRevisionBar.tsx
PAGE=app/platform/dashboard/sites/[id]/cpp/page.tsx
WF_CODE=$(strip "$WF")
echo "$WF_CODE" | grep -q "recommendNextAction" || fail "strip removed real code - checks vacuous"

grep -q "recommendNextAction({" "$BAR" || fail "the bar no longer computes a recommended action"
grep -q "CPP_STAGES.map" "$BAR" || fail "the stage indicator is missing"
grep -q "Create a revision from the current plan" "$BAR" && fail "old technical wording is back"

echo "$WF_CODE" | grep -q "kind: 'PREPARE_REVISION', label: \`Prepare Revision \${input.issued.version + 1}\`" \
  || fail "a current plan offers no secondary action - the screen would dead-end"

grep -q "Prepare it anyway" "$BAR" || fail "preparing over gaps no longer offers to proceed"
grep -q "This plan still has information outstanding" "$BAR" \
  || fail "the approval dialog no longer shows outstanding content"

# POLISH — the controls must use the platform component, not hand-rolled classes.
grep -q "bg-brand-600 px-4 py-2" "$BAR" && fail "hand-rolled button classes are back"
grep -q "<Button" "$BAR" || fail "the shared Button component is not used"
grep -q 'variant="secondary"' "$BAR" || fail "the secondary action is not an outlined button"
grep -q "text-ink-subtle hover:underline" "$BAR" \
  && fail "a bare-text action is back - it reads as a caption, not a control"
grep -q "Issued (Rev " "$BAR" && fail "the switcher names the event again, not the document in force"
grep -q "Revision {issued.version} (Current)" "$BAR" \
  || fail "the switcher does not say which revision is current"

grep -q "Construction Phase Plan — draft" "$PAGE" && fail "the unconditional draft heading is back"
grep -q "readiness: liveDraft.readiness" services/sites/cppRevisionService.ts \
  || fail "readiness does not reach the revision state"
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
npx next build >/tmp/cpppolish_build.log 2>&1 || {
  tail -30 /tmp/cpppolish_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Revision prepared" "No plan has been issued for this project yet" \
         "Prepare it anyway" "This plan still has information outstanding" \
         "Approve and issue" "Discard revision" "(Current)"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
for t in "Create a revision from the current plan" "Construction Phase Plan — draft" "Issued (Rev "; do
  grep -rqF "$t" $SHIPPED 2>/dev/null && fail "old wording is in the build: $t"
done
echo "  ok   polished controls present, old wording absent"

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
