#!/usr/bin/env bash
# "CHECK MY CARD DETAILS" — the failed-card prompt now reaches the card form.
#
# NO MIGRATION. Three files and a new rule module; nothing touches the database,
# so this can go out on its own and roll back by redeploying the previous build.
#
# WHAT IT MUST NOT REGRESS: the button bounced every operative back to the page
# they pressed it on, because the prompt is only shown to checked-in workers and
# the target redirects checked-in workers away. The asserts below pin the rule
# that fixed it, in the one file that now owns both halves.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cardfix_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/7] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/7] Asserting a committed tree..."
git diff --quiet HEAD -- prisma/schema.prisma app components services lib scripts \
  || fail "there are uncommitted changes - the zip is the working tree"
git diff --quiet HEAD -- prisma/schema.prisma || fail "the schema is modified; this deploy carries no migration"
echo "  ok   tree committed, schema untouched"

echo "[3/7] Asserting the fix..."
grep -q "export function shouldLeaveCheckInDetails" services/cscs/cardFixFlow.ts \
  || fail "the shared rule is gone"
grep -q "return hasOpenCheckIn && !fixingCard;" services/cscs/cardFixFlow.ts \
  || fail "the rule no longer exempts a worker who came to fix a card - THE ORIGINAL BUG"
grep -q "CARD_FIX_HREF" components/worker/CscsRemediationBanner.tsx \
  || fail "the banner hard-codes its link again; it can drift from the page"
grep -q "shouldLeaveCheckInDetails(Boolean(await getWorkerContext()), fixingCard)" app/check-in/details/page.tsx \
  || fail "the details page redirects blindly again - every operative would be bounced"
grep -q "fixingCard ? CARD_FIX_RETURN : '/check-in/site'" components/checkin/IdentityForm.tsx \
  || fail "saving no longer returns a card-fixer to their dashboard"
grep -q "fixingCard || Boolean(initial.cscsCardNumber" components/checkin/IdentityForm.tsx \
  || fail "the card section is collapsed again for someone sent to open it"
grep -q "Back without changes" components/checkin/IdentityForm.tsx \
  || fail "the way out without saving is gone"
echo "  ok   source asserts pass"

echo "[4/7] Running the verification suites..."
# Output captured, then checked: `grep -q` closes the pipe and pipefail turns the
# resulting SIGPIPE into a false failure.
# ONE PATTERN FOR EVERY SUITE. The suites do not agree on how they print their
# totals - some wrap it in "==", some do not - and a per-suite pattern is a
# per-suite chance to mistake a passing run for a failing one, which is exactly
# what happened on the first attempt at this deploy. "(^| )0 failed" also cannot
# match "10 failed", which a bare "0 failed" would.
suite() {
  local out; out=$(npx tsx "scripts/$1.ts" 2>&1)
  echo "$out" | grep -qE "(^| )0 failed" || { echo "$out" | tail -15; fail "$1 has failures"; }
  echo "  ok   $1: $(echo "$out" | grep -oE '([0-9]+ passed, )?[0-9]+ failed' | tail -1)"
}
# This change's own suite first.
suite cscs_remediation_verify
suite cscs_access_gate_verify
suite cscs_scheme_notlisted_verify
suite cscs_exempt_verify
suite smartcheck_mapping_verify
suite worker_name_verify
suite inviteflow_verify
suite induction_grouping_verify
suite induction_briefing_verify
suite inductionvideo_render_verify
suite inductionvideo_speech_verify
suite inductionvideo_verify
# The induction-video END-TO-END suites are deliberately not in this gate: they
# spend money on a real speech service and render a video, and nothing in this
# change touches that code. They ran on the deploy that shipped it.
echo "  ok   suites green"
echo "      (scripts/cardfix_walk.js walks this journey in a browser; it needs a"
echo "       local dev server and a worker with an open check-in, so it is not a gate.)"

echo "[5/7] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cardfix_build.log 2>&1 || { tail -30 /tmp/cardfix_build.log; fail "build failed"; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/7] Confirming the BUILD, not just the source..."
for t in "Your card details" "Check the card details below" "Back without changes" \
         "Save & check my card again" "Check my card details"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "Back without changes" .next/static 2>/dev/null \
  || fail "the card-fix form is not in the client bundle"
echo "  ok   the new journey is in the build"

echo "[7/7] Packaging, deploying, cutting over..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

sleep 60
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 30); do
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

echo "      the card-fix route must be SESSION-GATED, not broken:"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "${BASE}/check-in/details?fix=cscs" || echo 000)
echo "        /check-in/details?fix=cscs -> HTTP ${C}"
case "$C" in 200|307|308) ;; *) fail "returned ${C}" ;; esac

echo "      route smoke test:"
SMOKE_FAIL=""
for path in / /check-in /worker/dashboard /platform/dashboard/sites ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
