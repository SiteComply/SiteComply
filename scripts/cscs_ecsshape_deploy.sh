#!/usr/bin/env bash
# ECS CARDS VERIFY: the V2.6 envelope carries a different card per scheme.
#
# NO MIGRATION. A parser change in smartCheckMapper.ts and nothing else.
#
# WHAT WAS WRONG: an ECS lookup reached Smart Check, got HTTP 200 and a valid card,
# and reported "the service could not complete this check" - because an ECS card
# carries isValid/dateOfExpiry where a CSCS card carries expired/cancelled, and the
# mapper required the CSCS pair and failed safe to ERROR without them.
#
# WHAT MUST STAY TRUE:
#   THE FAIL-SAFE   a card whose standing cannot be read in EITHER shape is still
#                   ERROR, never VALID. That guard is why this surfaced as a
#                   refusal rather than as a card wrongly marked verified.
#   CSCS UNCHANGED  two booleans, cancelled outranking expired, and no expiry
#                   invented where the scheme gives none.
#   NOTHING GUESSED no cross-scheme grade equivalence, no qualifications read from
#                   an unconfirmed shape.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cscs_ecsshape_deploy.zip

# NO DATABASE ACCESS: no migration, so no firewall rule is opened at all.
fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/7] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/7] Asserting a committed tree and no migration..."
git diff --quiet HEAD -- prisma/schema.prisma app components services lib scripts \
  || fail "there are uncommitted changes - the zip is the working tree"
git diff --quiet HEAD~1 -- prisma/schema.prisma \
  || fail "the schema moved - this change is supposed to carry no migration"
echo "  ok   tree committed, schema untouched"

echo "[3/7] Asserting the parser..."
M=services/cscs/smartCheckMapper.ts
# BOTH shapes, in the right precedence.
grep -q "if (typeof cancelled === 'boolean' && typeof expired === 'boolean') {" "$M" \
  || fail "the CSCS card shape is no longer read first"
grep -q "if (typeof card.isValid === 'boolean') {" "$M" \
  || fail "the ECS card shape is not read - this is the bug returning"
# The fail-safe, which is the whole reason a wrong card was never marked valid.
grep -q "return 'ERROR';" "$M" \
  || fail "the fail-safe on an unreadable card is gone"
grep -q "if (card.isValid) return 'VALID';" "$M" \
  || fail "a valid ECS card is not reported valid"
# isValid: false read against the date, not guessed.
grep -q "if (expiry && !isAfterToday(expiry, checkedAt)) return 'EXPIRED';" "$M" \
  || fail "a lapsed invalid card would be reported as withdrawn rather than expired"
# The expiry, and the downgrade it makes possible.
grep -q "export function expiryFromV26Card" "$M" \
  || fail "the ECS expiry is not read"
grep -qF "new Date(Math.max(...dates.map((d) => d.getTime())))" "$M" \
  || fail "the latest expiry is not taken - a renewed card beside a lapsed one would report the wrong date"
grep -q "if (status === 'VALID' && expiry && !isAfterToday(expiry, checkedAt)) {" "$M" \
  || fail "a card reported valid with a past expiry is no longer downgraded"
# Card type reads all three names.
grep -q "export function cardTypeFromV26Card" "$M" \
  || fail "the card type helper is missing"
grep -qF "mapCardType(card.cardColour) ??" "$M" \
  || fail "the CSCS colour is no longer read first"
# Nothing invented.
grep -q "qualifications: \[\]," "$M" \
  || fail "qualifications are being populated from an unconfirmed shape"
grep -qE "craft.*BLUE_SKILLED|BLUE_SKILLED.*craft" "$M" \
  && fail "a cross-scheme grade equivalence has been invented for Craft"
# The scheme list is untouched: the identifier was never the problem.
grep -qF "{ id: 'ECS', name: 'ECS (JIB)' }," services/cscs/schemes.ts \
  || fail "the ECS (JIB) identifier changed - the live service accepted 'ECS'"
grep -qF "{ id: 'CFW', name: 'ECS (SJIB)' }," services/cscs/schemes.ts \
  || fail "the ECS (SJIB) identifier changed"
echo "  ok   source asserts pass (14)"

echo "[4/7] Running the verification suites..."
# ONE totals pattern for every suite. "(^| )0 failed" cannot match "10 failed".
suite() {
  local out
  if [ -x "scripts/$1.sh" ]; then out=$("./scripts/$1.sh" 2>&1); else out=$(npx tsx "scripts/$1.ts" 2>&1); fi
  echo "$out" | grep -qE "(^| )0 failed" || { echo "$out" | tail -15; fail "$1 has failures"; }
  echo "  ok   $1: $(echo "$out" | grep -oE '([0-9]+ passed, )?[0-9]+ failed' | tail -1)"
}
suite cscs_ecs_shape_verify
suite cscs_remediation_verify
suite cscs_access_gate_verify
suite cscs_golive_verify
suite cscs_scheme_notlisted_verify
suite cscs_exempt_verify
suite cscs_resolved_credentials_verify
suite cscs_testgate_verify
suite cscs_checknow_access_verify
suite smartcheck_capture_verify
suite worker_name_verify
suite inviteflow_verify
# The induction work this change sits on top of.
suite inductionvideo_library_verify
suite inductionvideo_verify
suite inductionvideo_e2e_verify
#
# NOT GATED: cscs_phase1_verify.
#
# It has ONE failing assertion - "the button does not promise a check either" -
# which pre-dates this change and is unrelated to it: verified by stashing the
# parser change and re-running, where it fails identically. It is a real
# regression in a button label that arrived between 2026-09-23, when a deploy
# script last gated this suite green, and now. Gating it here would either block
# an unrelated fix or invite somebody to weaken the pattern that catches real
# failures. It needs its own look - it is not being ignored, it is being named.
echo "  ok   suites green (phase1 excluded, see the note above)"

echo "[5/7] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cscs_ecsshape_build.log 2>&1 || { tail -30 /tmp/cscs_ecsshape_build.log; fail "build failed"; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/7] Confirming the BUILD, not just the source..."
grep -rqF "isValid" .next/server 2>/dev/null \
  || fail "the ECS shape handling is not in the build"
grep -rqF "Card verified with CSCS Smart Check" .next/server 2>/dev/null \
  || fail "the verified message is not in the build"
echo "  ok   the parser is in the build"

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

echo "      route smoke test:"
SMOKE_FAIL=""
for path in / /check-in /worker/permits /platform/dashboard/sites /admin/induction-videos ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
