#!/usr/bin/env bash
# ACCESS WINDOWS — a re-invitation clears a stale window (as a transfer does),
# and an ACTIVE assignment outside its window is visible to managers instead of
# reading "Active" while the gate refuses the operative.
#
# NO MIGRATION. No data is changed by this deploy: existing stale windows stay
# until a manager sets new dates, and are now shown on the roster.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/accesswindow_deploy.zip

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

echo "[3/8] Asserting the window fixes and the earlier CSCS work..."
SVC=services/workerAccess/workerAssignmentService.ts
python3 - "$SVC" <<'PY' || exit 1
import io, sys
src = io.open(sys.argv[1], encoding='utf-8').read()
i = src.index('prisma.workerSiteAssignment.upsert(', src.index('export async function inviteWorker'))
block = src[src.index('    update: {', i):][:1500]
if 'startDate: null' not in block or 'endDate: null' not in block:
    print('  FAIL re-inviting does not clear the access window'); sys.exit(1)
print('  ok   re-invitation clears the stale window')
PY
grep -q "windowState === 'expired' && a.endDate" services/workerAccess/assignmentLabels.ts || fail "the label hides an expired window"
grep -q "'access-ended': 'Access ended'" "app/platform/dashboard/sites/[id]/workers/page.tsx" || fail "the roster has no expired state"
grep -q "cannot check in: their access period has ended" "app/platform/dashboard/sites/[id]/workers/page.tsx" || fail "the roster does not name them"
grep -q "{ id: 'ECS', name: 'ECS (JIB)' }," services/cscs/schemes.ts || fail "the ECS schemes regressed"
grep -q "export const SCHEME_NOT_LISTED" services/cscs/schemes.ts || fail "the not-listed answer regressed"
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
suite accesswindow_visibility_verify "== [0-9]+ passed, 0 failed =="
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
npx next build >/tmp/accesswindow_build.log 2>&1 || {
  tail -30 /tmp/accesswindow_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
for t in "Access ended " "Access starts " "Access not started" "cannot check in: their access period has ended" "ended, they cannot check in" "ECS (JIB)" "My scheme is not listed"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
echo "  ok   the window labels, the roster warning and the CSCS work are in the build"

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
