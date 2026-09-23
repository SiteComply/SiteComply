#!/usr/bin/env bash
# INDUCTION VIDEOS, PHASE 1 — the script pipeline: rules engine, readiness,
# script generation, approval, versioning and audit.
#
# MIGRATION FIRST. This build names InductionVideo, InductionVideoScene,
# InductionVideoJob, InductionVideoEvent and AiUsageEvent; the pre-flight below
# refuses to deploy against a database that lacks them, and refuses equally when
# it cannot ask.
#
# THE FEATURE IS INERT UNTIL SOMEONE PRESSES GENERATE. No background work runs
# on its own: the scheduler only drains jobs that a manager has queued.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/inductionvideo_deploy.zip

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

echo "[3/8] Asserting the migration is in PRODUCTION, and the source..."
DB="$(az webapp config appsettings list -g rgSiteComply -n sitecomply-web -o tsv --query "[?name=='DATABASE_URL'].value" 2>/dev/null)"
[ -n "$DB" ] || fail "could not read DATABASE_URL"
SCHEMA_OK=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT to_regclass('\"InductionVideo\"') IS NOT NULL AND to_regclass('\"InductionVideoScene\"') IS NOT NULL AND to_regclass('\"InductionVideoJob\"') IS NOT NULL AND to_regclass('\"InductionVideoEvent\"') IS NOT NULL AND to_regclass('\"AiUsageEvent\"') IS NOT NULL" 2>/dev/null)
case "$SCHEMA_OK" in
  t) echo "  ok   production has all five induction-video tables" ;;
  f) fail "production has NOT been migrated - run ~/induction_videos_run.sh first" ;;
  *) fail "could not check the production schema (firewall rule?) - refusing to deploy blind" ;;
esac
grep -q "export function buildSceneManifest" services/inductionVideo/sceneRules.ts || fail "the rules engine is missing"
grep -q "canGenerate: missing.length === 0," services/inductionVideo/sceneRules.ts || fail "missing information no longer blocks generation"
grep -q "Never add a hazard, precaution, location, name, telephone number, procedure or statistic" services/inductionVideo/scriptService.ts || fail "the prompt no longer forbids invention"
grep -q "if (!manifest.canGenerate)" services/inductionVideo/scriptService.ts || fail "generation does not refuse a blocked manifest"
grep -q "APPROVE_ROLES: PlatformRoleValue\[\] = \['DIRECTOR', 'SITE_MANAGER'\]" services/inductionVideo/inductionVideoPermissions.ts || fail "the approval roles changed"
grep -q "runQueuedScriptJobs()" app/api/system/compliance/tick/route.ts || fail "jobs are not drained by the scheduler"
grep -q "documentCompanyWhere" services/workerDashboard/workerDashboardService.ts || fail "the RAMS company rule regressed"
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
npx next build >/tmp/inductionvideo_build.log 2>&1 || {
  tail -30 /tmp/inductionvideo_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
for t in "Induction videos" "cannot produce an induction video yet" "Generate script" "Approve script" "Only a Director or Site Manager may approve" "Companies on this project" "Access ended "; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "Approve script" .next/static 2>/dev/null || fail "the script editor is not in the client bundle"
test -f ".next/server/app/api/platform/sites/[id]/induction-video/route.js" || fail "the induction-video API did not build"
echo "  ok   the induction-video screens, API and earlier work are in the build"

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
