#!/usr/bin/env bash
# COMPANY INDUCTION MODULES, PHASES B + C — into the induction, and what a
# project decides about them.
#
# MIGRATION FIRST: ~/scene_module_run.sh. One nullable column on
# InductionVideoScene plus its index, both IF NOT EXISTS, no backfill.
#
# THIS ONE IS NOT INERT. Phase A shipped a model nothing read; this deploy makes
# issued company modules appear in every generated script, in narration, and in
# the rendered video. The asserts below are therefore about what a site may and
# may not do to company words, because that is what can now go wrong.
#
# THE SAFETY PROPERTY IS UNCHANGED: a module with no ISSUED revision still
# reaches nobody. Production currently has the six starter modules as DRAFTS,
# so no operative-facing content changes on this deploy either - the change
# becomes visible the first time a Director issues one.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/inductionmodulesbc_deploy.zip

# The schema check needs to reach the database, and prod Postgres is Azure-only.
# This script opens its own temporary firewall rule and removes it on the way
# out, whatever happens - rather than depending on a rule somebody left behind.
FW_RULE=devvm-modulesbc
FW_IP=144.6.132.237
FW_OPENED=""
# NEVER HANG: without this, psql against a blocked port sits in TCP retry for
# minutes and the deploy looks stuck rather than broken.
export PGCONNECT_TIMEOUT=10

cleanup() {
  if [ -n "$FW_OPENED" ]; then
    echo "      removing the temporary firewall rule..."
    az postgres flexible-server firewall-rule delete -g "$RG" -s sitecomply-pg \
      -n "$FW_RULE" --yes -o none 2>/dev/null && echo "      removed." \
      || echo "      WARNING: could not remove ${FW_RULE} - remove it by hand"
  fi
}
trap cleanup EXIT

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
echo "  ok   tree committed"

echo "[3/7] Asserting the migration landed, and the guards..."
DB="$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='DATABASE_URL'].value" 2>/dev/null)"
[ -n "$DB" ] || fail "could not read DATABASE_URL"
if ! psql "$DB" -q -c 'SELECT 1' >/dev/null 2>&1; then
  echo "      opening a temporary firewall rule for ${FW_IP}..."
  az postgres flexible-server firewall-rule create -g "$RG" -s sitecomply-pg \
    -n "$FW_RULE" --start-ip-address "$FW_IP" --end-ip-address "$FW_IP" -o none \
    || fail "could not open the firewall rule"
  FW_OPENED=yes
  for _ in $(seq 1 12); do
    psql "$DB" -q -c 'SELECT 1' >/dev/null 2>&1 && break
    sleep 5
  done
  psql "$DB" -q -c 'SELECT 1' >/dev/null 2>&1 \
    || fail "still cannot reach the database after opening the rule"
fi
COL=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='InductionVideoScene' AND column_name='moduleRevisionId')" 2>/dev/null)
[ -n "$COL" ] || fail "could not check the production schema (firewall rule?) - refusing to deploy blind"
[ "$COL" = "t" ] || fail "production has no InductionVideoScene.moduleRevisionId - run ~/scene_module_run.sh first"
# Phase A's tables must still be there; this build reads all four.
TABLES=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT (to_regclass('\"InductionModule\"') IS NOT NULL)::int + (to_regclass('\"InductionModuleRevision\"') IS NOT NULL)::int + (to_regclass('\"InductionModuleEvent\"') IS NOT NULL)::int + (to_regclass('\"SiteInductionModule\"') IS NOT NULL)::int" 2>/dev/null)
[ "$TABLES" = "4" ] || fail "production has $TABLES of the 4 module tables"
echo "  ok   production has the column and all four tables"
# Closed here rather than at exit: the schema check is the only thing that needs
# it, and the rest of the deploy takes a quarter of an hour.
if [ -n "$FW_OPENED" ]; then
  cleanup
  FW_OPENED=""
fi

SVC=services/inductionModules/inductionModuleService.ts
RULES=services/inductionVideo/sceneRules.ts
SCRIPT=services/inductionVideo/scriptService.ts
VID=services/inductionVideo/inductionVideoService.ts

# --- Phase A's properties, still true -------------------------------------
grep -q "if (!issued) continue; // a draft never reaches a site" "$SVC" \
  || fail "a DRAFT could reach a site - the property that makes the seeded wording safe"
grep -q "return role === 'DIRECTOR';" "$SVC" \
  || fail "issuing is no longer a Director's alone"
grep -q "An issued revision cannot be edited" "$SVC" \
  || fail "an issued revision can be edited - the history would stop being true"
grep -q "status: InductionModuleRevisionStatus.SUPERSEDED" "$SVC" \
  || fail "issuing no longer supersedes the previous revision"

# --- Phase B: modules reach the induction, in the right band --------------
# The seam: scriptService resolves the project's modules and hands them to the
# rules engine, which consumes them but does not decide WHICH apply.
grep -q "resolveModulesForSite } from '@/services/inductionModules/inductionModuleService'" "$SCRIPT" \
  || fail "script generation no longer resolves company modules - Phase B is the point of this deploy"
grep -q "resolveModulesForSite(site.id)" "$SCRIPT" \
  || fail "the resolver is imported but never called"
grep -q "for (const m of src.modules)" "$RULES" \
  || fail "the rules engine never emits a company module scene"
grep -q "COMPANY_BAND_AFTER: SceneType = 'RAMS'" "$RULES" \
  || fail "the company band has moved out of its agreed place (after RAMS, before SITE_RULES)"
grep -q "SCENE_ORDER.indexOf(COMPANY_BAND_AFTER) \* 1000 + 500 + moduleOrder" "$RULES" \
  || fail "the company band no longer sits between the site scenes"
grep -q "m.replacesSceneType && emitted.has(m.replacesSceneType as SceneType)" "$RULES" \
  || fail "overlap suppression is gone - an operative would hear the same subject twice"
grep -q "moduleRevisionId: m.revisionId" "$RULES" \
  || fail "a scene no longer records WHICH company revision its words are"
grep -qF "s.facts, s.moduleRevisionId ?? '', s.narration ?? ''].join('|')" "$RULES" \
  || fail "the manifest hash ignores the module revision or its words - a module update would not mark a video out of date"
grep -qF "const siteScenes = manifest.scenes.filter((s) => s.source === 'SITE');" "$SCRIPT" \
  || fail "the model is handed company scenes - their wording must be used verbatim, not rewritten"

# --- Phase B: a site cannot rewrite company words in the script editor ----
test "$(grep -c 'if (scene.moduleRevisionId) {' "$VID")" -eq 2 \
  || fail "the edit and remove guards on company scenes are not both present"

# --- Phase C: the departure rules live in the service, not the UI ---------
grep -q "input.state === 'OVERRIDDEN' && !canIssueInductionModule(viewer.role)" "$SVC" \
  || fail "a Site Manager could override company wording - the owner made that a Director's alone"
grep -q "input.state === 'EXCLUDED' && module.mandatory" "$SVC" \
  || fail "a MANDATORY module could be left out of a project"
grep -q "input.reason.trim().length < 10" "$SVC" \
  || fail "a departure could be recorded without a real reason"
grep -q "prisma.siteInductionModule.findFirst" "$SVC" \
  || fail "the decision write no longer reads the row first - it would update by compound key"
grep -q "update({ where: { id: existing.id }" "$SVC" \
  || fail "the decision write is not by id - the closed-project guard cannot resolve the site"
grep -q "siteInductionModule.upsert" "$SVC" \
  && fail "an upsert by compound key is back - it hides the site from the closed-project guard"
test "$(grep -c 'export async function setSiteModuleDecision' "$SVC")" -eq 1 \
  || fail "the decision rule is no longer in exactly one place"
echo "  ok   source asserts pass (21)"

echo "[4/7] Running the verification suites..."
# ONE totals pattern for every suite: they do not agree on how they print their
# totals, and a per-suite pattern is a per-suite chance to read a pass as a
# fail. "(^| )0 failed" also cannot match "10 failed".
suite() {
  local out
  if [ -x "scripts/$1.sh" ]; then out=$("./scripts/$1.sh" 2>&1); else out=$(npx tsx "scripts/$1.ts" 2>&1); fi
  echo "$out" | grep -qE "(^| )0 failed" || { echo "$out" | tail -15; fail "$1 has failures"; }
  echo "  ok   $1: $(echo "$out" | grep -oE '([0-9]+ passed, )?[0-9]+ failed' | tail -1)"
}
# This change's own three suites first.
suite induction_modules_verify
suite induction_modules_phaseb_verify
suite induction_modules_phasec_verify
suite inductionvideo_verify
suite inductionvideo_speech_verify
# The render e2e shells out to the vendored ffmpeg and silently skips without it.
export FFMPEG_PATH="$PWD/vendor/ffmpeg/ffmpeg"
[ -x "$FFMPEG_PATH" ] || fail "the vendored ffmpeg is missing or not executable"
suite inductionvideo_render_verify
suite inductionvideo_e2e_verify
suite induction_briefing_verify
suite induction_grouping_verify
suite pdfkit_verify
suite permit_record_verify
suite closeout_pdf_verify
suite cpp_pdf_verify
suite cscs_remediation_verify
suite cscs_access_gate_verify
suite worker_name_verify
suite inviteflow_verify
echo "  ok   suites green"

echo "[5/7] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/inductionmodulesbc_build.log 2>&1 || { tail -30 /tmp/inductionmodulesbc_build.log; fail "build failed"; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/7] Confirming the BUILD, not just the source..."
# Phase C's panel, Phase B's badge, and Phase A's settings area.
for t in "Company induction content" "Leave it out of this project" \
         "Change the wording here" "Company induction modules" \
         "Create the six standard modules" "SITE INDUCTION RECORD"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
# The two client bundles that carry the new interactions.
grep -rqF "Back to the company standard" .next/static 2>/dev/null \
  || fail "the site decision panel is not in the client bundle"
grep -rqF "Issue revision" .next/static 2>/dev/null \
  || fail "the module editor is not in the client bundle"
grep -rqF "Company standard" .next/static 2>/dev/null \
  || fail "the script editor's company-scene badge is not in the client bundle"
test -f ".next/server/app/api/platform/sites/[id]/induction-modules/route.js" \
  || fail "the per-site decision API did not build"
test -f ".next/server/app/api/platform/settings/induction-modules/route.js" \
  || fail "the module API did not build"
test -f ".next/server/app/platform/dashboard/settings/induction-modules/page.js" \
  || fail "the settings page did not build"
echo "  ok   both new APIs, the panel, the editor and the earlier work are in the build"

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

echo "      both module APIs must be GATED, not broken:"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X POST -H 'content-type: application/json' \
      -d '{"moduleId":"x","state":"EXCLUDED","reason":"a reason long enough"}' \
      "${BASE}/api/platform/sites/x/induction-modules" || echo 000)
echo "        POST /api/platform/sites/x/induction-modules -> HTTP ${C}"
case "$C" in 401|403) ;; *) fail "the per-site decision API returned ${C}, expected 401/403" ;; esac
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X POST -H 'content-type: application/json' \
      -d '{"action":"seed"}' "${BASE}/api/platform/settings/induction-modules" || echo 000)
echo "        POST /api/platform/settings/induction-modules -> HTTP ${C}"
case "$C" in 401|403) ;; *) fail "the module API returned ${C}, expected 401/403" ;; esac

echo "      route smoke test:"
SMOKE_FAIL=""
for path in / /check-in /worker/permits /platform/dashboard/sites \
            /platform/dashboard/settings/induction-modules ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
