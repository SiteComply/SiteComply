#!/usr/bin/env bash
# COMPANY INDUCTION MODULES, PHASE A — the model and its management.
#
# MIGRATION FIRST (~/induction_modules_run.sh or the SQL directly). Four new
# tables, three new enums, all additive.
#
# THIS SHIPS INERT. The video generator does not read the new tables at all
# until Phase B, and a module only reaches a site once a Director has ISSUED a
# revision. Nothing an operative sees changes on this deploy - which is exactly
# why the starter wording can ship as drafts.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/inductionmodules_deploy.zip

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
git diff --quiet HEAD~1 -- prisma/schema.prisma || fail "this change carries no migration; the schema moved"
echo "  ok   tree committed, schema untouched"

echo "[3/7] Asserting the model and its guards..."
DB="$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='DATABASE_URL'].value" 2>/dev/null)"
[ -n "$DB" ] || fail "could not read DATABASE_URL"
TABLES=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT (to_regclass('\"InductionModule\"') IS NOT NULL)::int + (to_regclass('\"InductionModuleRevision\"') IS NOT NULL)::int + (to_regclass('\"InductionModuleEvent\"') IS NOT NULL)::int + (to_regclass('\"SiteInductionModule\"') IS NOT NULL)::int" 2>/dev/null)
[ -n "$TABLES" ] || fail "could not check the production schema (firewall rule?) - refusing to deploy blind"
[ "$TABLES" = "4" ] || fail "production has $TABLES of the 4 module tables - run the migration first"
echo "  ok   production has all four tables"

SVC=services/inductionModules/inductionModuleService.ts
grep -q "if (!issued) continue; // a draft never reaches a site" "$SVC" \
  || fail "a DRAFT could reach a site - the property that makes seeded wording safe"
grep -q "SiteInductionModuleState.EXCLUDED && !m.mandatory" "$SVC" \
  || fail "a MANDATORY module could be excluded by a site"
grep -q "return role === 'DIRECTOR';" "$SVC" \
  || fail "issuing is no longer a Director's alone"
grep -q "An issued revision cannot be edited" "$SVC" \
  || fail "an issued revision can be edited - the history would stop being true"
grep -q "status: InductionModuleRevisionStatus.SUPERSEDED" "$SVC" \
  || fail "issuing no longer supersedes the previous revision"
test $(grep -c "export async function resolveModulesForSite" "$SVC") -eq 1 \
  || fail "the resolution rule is no longer in exactly one place"
# The generator must NOT read modules yet: Phase A is inert by design.
grep -rq "inductionModules" services/inductionVideo/ \
  && fail "the video generator reads modules already - that is Phase B, not this deploy"
echo "  ok   source asserts pass"

echo "[4/7] Running the verification suites..."
# ONE totals pattern for every suite: they do not agree on how they print their
# totals, and a per-suite pattern is a per-suite chance to read a pass as a fail.
# "(^| )0 failed" also cannot match "10 failed".
suite() {
  local out
  if [ -x "scripts/$1.sh" ]; then out=$("./scripts/$1.sh" 2>&1); else out=$(npx tsx "scripts/$1.ts" 2>&1); fi
  echo "$out" | grep -qE "(^| )0 failed" || { echo "$out" | tail -15; fail "$1 has failures"; }
  echo "  ok   $1: $(echo "$out" | grep -oE '([0-9]+ passed, )?[0-9]+ failed' | tail -1)"
}
# This change's own suite first. The PDF suites run through their .sh wrappers
# because @react-pdf is ESM-only and dies under tsx.
suite induction_modules_verify
suite pdfkit_verify
suite permit_record_verify
suite closeout_pdf_verify
suite cpp_pdf_verify
suite cscs_remediation_verify
suite cscs_access_gate_verify
suite worker_name_verify
suite inviteflow_verify
suite induction_briefing_verify
suite induction_grouping_verify
suite inductionvideo_render_verify
suite inductionvideo_speech_verify
suite inductionvideo_verify
echo "  ok   suites green"

echo "[5/7] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/inductionmodules_build.log 2>&1 || { tail -30 /tmp/inductionmodules_build.log; fail "build failed"; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/7] Confirming the BUILD, not just the source..."
for t in "Company induction modules" "Create the six standard modules" \
         "Induction modules" "Not issued" "SITE INDUCTION RECORD"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "Issue revision" .next/static 2>/dev/null || fail "the module editor is not in the client bundle"
test -f ".next/server/app/platform/dashboard/settings/induction-modules/page.js" \
  || fail "the settings page did not build"
test -f ".next/server/app/api/platform/settings/induction-modules/route.js" \
  || fail "the module API did not build"
echo "  ok   the settings area, its API and the earlier work are in the build"

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

echo "      the module API must be GATED, not broken:"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X POST -H 'content-type: application/json' \
      -d '{"action":"seed"}' "${BASE}/api/platform/settings/induction-modules" || echo 000)
echo "        POST /api/platform/settings/induction-modules -> HTTP ${C}"
case "$C" in 401|403) ;; *) fail "the module API returned ${C}, expected 401/403" ;; esac
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "${BASE}/platform/dashboard/settings/induction-modules" || echo 000)
echo "        /platform/dashboard/settings/induction-modules -> HTTP ${C}"
case "$C" in 307|308|401|403) ;; *) fail "the settings page returned ${C}" ;; esac

echo "      route smoke test:"
SMOKE_FAIL=""
for path in / /check-in /worker/permits /platform/dashboard/sites ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
