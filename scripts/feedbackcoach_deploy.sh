#!/usr/bin/env bash
# FEEDBACK COACH MARK REMOVAL — production deploy.
#
# The one-time dark "Spotted a problem?" panel under the Feedback button is
# removed. It was NOT a submission confirmation — that is an in-dialog success
# screen ("Thanks — report sent" + reference) and is untouched. The coach mark
# fired on first visit per portal per device, to tell every user what a control
# they had not asked about does.
#
# NO SCHEMA CHANGE, no API change, no route change. One component and one test.
#
# Rollback is a redeploy of the previous build. Nothing is destructive; the
# localStorage keys `sc.report.coach.*` already written to people's devices are
# simply never read again.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/feedbackcoach_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }

served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/7] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/7] Asserting this change needs NO migration..."
git diff --quiet HEAD -- prisma/schema.prisma \
  || fail "prisma/schema.prisma is modified - this needs a migration and a different script"
echo "  ok   schema untouched"

echo "[3/7] Asserting the removal in the SOURCE..."
BTN=components/ui/ReportIssueButton.tsx
# The popup and everything that drove it.
#
# The copy check STRIPS COMMENTS first. The component's header deliberately
# records what was removed and quotes "Spotted a problem?" while doing so, which
# is worth keeping — but it means a plain content grep reports the popup as still
# present on a correctly stripped file. Same trap as the siteRuleRows import
# guard; documenting a removal must not trip the check that proves it.
CODE_ONLY=$(grep -v '^[[:space:]]*\*' "$BTN" | grep -v '^[[:space:]]*//')
echo "$CODE_ONLY" | grep -q "Spotted a problem" && fail "the coach mark copy is still rendered"
# ...and prove that strip did not simply delete everything.
echo "$CODE_ONLY" | grep -q "ReportIssueDialog" \
  || fail "the comment strip removed real code - the copy check above is vacuous"
grep -q 'role="note"' "$BTN"       && fail "the coach mark element is still present"
grep -q "COACH_PREFIX\|sc.report.coach" "$BTN" && fail "the coach mark storage key is still present"
grep -q "useEffect" "$BTN"         && fail "the coach mark effect is still present"
# ...and the things that must SURVIVE it. Paired with the absences above so a
# mistyped path cannot pass this step by finding nothing either way.
grep -q 'aria-label="Report an issue or give feedback"' "$BTN" \
  || fail "the Feedback button is gone - this was a popup removal, not a feature removal"
grep -q "<ReportIssueDialog" "$BTN" \
  || fail "the report dialog is no longer mounted"
grep -q "Thanks — report sent" components/ui/ReportIssueDialog.tsx \
  || fail "the submission confirmation is gone - it was never the popup being removed"
# The test must assert the ABSENCE now, or nothing stops the popup returning.
grep -q "no coach mark on first visit" scripts/issuereport_verify.js \
  || fail "issuereport_verify no longer guards against the coach mark returning"
echo "  ok   source asserts pass"

echo "[4/7] Type-checking and building..."
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/feedbackcoach_build.log 2>&1 || {
  tail -30 /tmp/feedbackcoach_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one - nothing would change"

echo "[5/7] Confirming the BUILD, not just the source..."
#
# SCOPED TO WHAT SHIPS: .next/server and .next/static, never .next wholesale.
#
# `.next/cache` is 350MB+ of webpack packs, it is EXCLUDED from the zip below,
# and Next writes it ASYNCHRONOUSLY after the build reports success — so a pack
# built from the previous source can still be on disk when this step runs, and
# be gone minutes later. Grepping all of .next made this check non-deterministic
# and failed a build that was correct: observed here, on the first run.
SHIPPED=".next/server .next/static"
grep -rq "Spotted a problem" $SHIPPED 2>/dev/null \
  && fail "the coach mark is still in the build that would ship"
grep -rq "Thanks — report sent" .next/server 2>/dev/null \
  || fail "the confirmation screen is missing from the build"
grep -rq "Report an issue or give feedback" $SHIPPED 2>/dev/null \
  || fail "the Feedback button is missing from the build"
echo "  ok   popup absent, feedback workflow present"

echo "[6/7] Packaging and deploying..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/7] Cutting over (stop/start) and verifying..."
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
for path in /worker/dashboard /platform/dashboard /check-in/site ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
