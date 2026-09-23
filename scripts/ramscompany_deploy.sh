#!/usr/bin/env bash
# RAMS COMPANY OWNERSHIP — an operative sees their own company's documents and
# anything site-wide, never another contractor's.
#
# MIGRATION FIRST, ALREADY RUN. This build names SiteCompany and both
# siteCompanyId columns, so it must not reach a database without them; the
# pre-flight below refuses to deploy otherwise.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/ramscompany_deploy.zip

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
SCHEMA_OK=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT (to_regclass('\"SiteCompany\"') IS NOT NULL) AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='WorkerSiteAssignment' AND column_name='siteCompanyId') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Document' AND column_name='siteCompanyId')" 2>/dev/null)
# Three states, not two: t = migrated, f = not migrated, empty = could not ask.
# Deploying on an unanswered question is how a build meets a database it cannot read.
case "$SCHEMA_OK" in
  t) echo "  ok   production has SiteCompany and both columns" ;;
  f) fail "production has NOT been migrated - run ~/rams_company.sql first" ;;
  *) fail "could not check the production schema (firewall rule?) - refusing to deploy blind" ;;
esac
grep -q "export function documentCompanyWhere" services/documents/documentVisibility.ts || fail "the visibility rule is missing"
grep -q "...documentCompanyWhere(opts.siteCompanyId)," services/workerDashboard/workerDashboardService.ts || fail "worker documents are not filtered"
grep -q 'label="Applies to"' components/platform/DocumentForm.tsx || fail "the document form cannot set an owner"
grep -q "Companies on this project" components/platform/SiteCompaniesManager.tsx || fail "the companies panel is missing"
grep -q "startDate: null" services/workerAccess/workerAssignmentService.ts || fail "the access-window fix regressed"
grep -q "{ id: 'ECS', name: 'ECS (JIB)' }," services/cscs/schemes.ts || fail "the ECS schemes regressed"
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
suite ramscompany_visibility_verify "== [0-9]+ passed, 0 failed =="
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
npx next build >/tmp/ramscompany_build.log 2>&1 || {
  tail -30 /tmp/ramscompany_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
for t in "Companies on this project" "Applies to" "Everyone on this site" "apply to everyone on this site" "Decides which RAMS this operative is shown" "Access ended " "ECS (JIB)"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "Companies on this project" .next/static 2>/dev/null || fail "the companies panel is not in the client bundle"
echo "  ok   the company panel, the document owner field and the earlier work are in the build"

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
