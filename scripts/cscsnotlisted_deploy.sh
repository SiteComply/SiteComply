#!/usr/bin/env bash
# CARD SCHEME NOT LISTED — an operative whose scheme is not among the 17 (ECS
# among them) can say so: the card is recorded, no lookup is attempted, and the
# gate points them at their site manager instead of an unanswerable field.
#
# Ships WITH the two ECS scheme identifiers from the Supported Schemes
# documentation: ECS (JIB) = ECS, ECS (SJIB) = CFW.
#
# NO MIGRATION. The answer is stored in the existing cscsSchemeId column as the
# sentinel NOT_LISTED; no schema change and no backfill.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cscsnotlisted_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/8] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/8] Asserting NO migration and a committed tree..."
git diff --quiet HEAD -- prisma/schema.prisma || fail "prisma/schema.prisma is modified"
git diff --quiet HEAD -- app components services lib \
  || fail "app/components/services/lib have uncommitted changes - the zip is the working tree"
grep -qE '^\s*firstName\s+String\?' prisma/schema.prisma || fail "Worker.firstName is not in the schema"
echo "  ok   schema untouched, tree committed"

echo "[3/8] Asserting the not-listed answer and the earlier fixes..."
grep -q "export const SCHEME_NOT_LISTED = 'NOT_LISTED';" services/cscs/schemes.ts || fail "the sentinel is missing"
grep -q "{ id: 'ECS', name: 'ECS (JIB)' }," services/cscs/schemes.ts || fail "ECS (JIB) is missing"
grep -q "{ id: 'CFW', name: 'ECS (SJIB)' }," services/cscs/schemes.ts || fail "ECS (SJIB) is missing"
grep -q "!isKnownScheme(fields.cscsSchemeId) && !schemeNotListed" "app/api/worker/profile/route.ts" || fail "the save path refuses the answer"
grep -q "schemeId: isKnownScheme(schemeId) ? schemeId : null," "app/api/worker/profile/route.ts" || fail "the sentinel could reach Smart Check"
grep -q "isKnownScheme(worker.cscsSchemeId) ? null : 'card scheme'" "app/api/platform/workers/[id]/cscs-check/route.ts" || fail "check-now could look up the sentinel"
grep -q "if (input.schemeNotListed) {" services/cscs/cscsVerificationService.ts || fail "the lookup is not skipped"
grep -q "leave this blank" components/checkin/IdentityForm.tsx && fail "the stale instruction is back"
grep -q "const current = cards.filter" services/cscs/smartCheckMapper.ts || fail "the multi-card rule regressed"
grep -q "username: settings.username," services/cscs/index.ts || fail "the credential fix regressed"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
# Output is CAPTURED before it is checked. Piping straight into `grep -q` closes
# the pipe at the first match, and a suite still logging its cleanup then dies of
# EPIPE - which read as a failing suite on the first run of this script.
suite() {  # suite <script> <pattern>
  local out; out=$(npx tsx "scripts/$1.ts" 2>&1)
  echo "$out" | grep -qE "$2" || { echo "$out" | tail -15; fail "$1 has failures"; }
  echo "  ok   $1: $(echo "$out" | grep -oE '[0-9]+ passed, 0 failed' | tail -1)"
}
suite cscs_scheme_notlisted_verify "== [0-9]+ passed, 0 failed =="
suite cscs_remediation_verify   ", 0 failed"
suite cscs_access_gate_verify   ", 0 failed"
suite cscs_exempt_verify        ", 0 failed"
suite cscs_resolved_credentials_verify "== [0-9]+ passed, 0 failed =="
suite cscs_checknow_access_verify "== [0-9]+ passed, 0 failed =="
suite smartcheck_auth_verify    "== [0-9]+ passed, 0 failed =="
suite smartcheck_mapping_verify ", 0 failed"
suite worker_name_verify        ", 0 failed"
suite inviteflow_verify         "== [0-9]+ passed, 0 failed =="
suite cscs_golive_verify        ", 0 failed"
suite smartcheck_capture_verify ", 0 failed"
suite cscs_phase1_verify        "passed, 0 failed"
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cscsnotlisted_build.log 2>&1 || {
  tail -30 /tmp/cscsnotlisted_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
for t in "My scheme is not listed" "not one we can check automatically" "scheme not listed - no lookup attempted" "confirm the physical card instead" "ECS (JIB)" "ECS (SJIB)"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "My scheme is not listed" .next/static 2>/dev/null || fail "the option is not in the client bundle"
grep -rqF 'ECS (JIB)' .next/static 2>/dev/null || fail "ECS is not in the client bundle - the picker would not offer it"
grep -rqF "cards returned: " .next/server 2>/dev/null || fail "the multi-card rule is missing from the build"
echo "  ok   the not-listed answer and the earlier CSCS fixes are in the build"

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

echo "      the invite API must be gated, not broken:"
IC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X PATCH -H 'content-type: application/json' \
  -d '{"action":"invite"}' "${BASE}/api/platform/sites/x/worker-access" || echo 000)
echo "        PATCH /api/platform/sites/x/worker-access -> HTTP ${IC}"
case "$IC" in 401|403|404) ;; *) fail "the invite API returned ${IC}, expected 401/403/404" ;; esac

echo "      route smoke test (3xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in / /check-in /check-in/details /platform/dashboard/sites /worker/dashboard ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
