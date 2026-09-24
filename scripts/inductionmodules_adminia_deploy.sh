#!/usr/bin/env bash
# THE INDUCTION VIDEOS AREA, MIRRORED IN THE ADMIN CENTRE.
#
# NO MIGRATION. A navigation change: company modules stop being an Admin Settings
# item and become part of an Induction Videos AREA that mirrors the Platform's,
# with the same areas, order, labels and wording.
#
# WHAT MUST BE TRUE AFTERWARDS is that the two tiers cannot drift. The areas are
# defined once in services/inductionVideo/inductionVideoAreas.ts and both tiers
# render from it, so the asserts below are mostly "this string exists in exactly
# one place" - a check that both tiers currently agree would pass just as happily
# on two hardcoded copies.
#
# NOTHING AN OPERATIVE SEES CHANGES, and no permission changes: the same roles
# reach the same content, through a different shape of navigation.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/inductionmodules_adminia_deploy.zip
# NO DATABASE ACCESS: this change carries no migration, so the script opens no
# firewall rule at all.

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

echo "[3/7] Asserting the schema is untouched, and the guards..."
git diff --quiet HEAD~1 -- prisma/schema.prisma \
  || fail "the schema moved - this change is supposed to carry no migration"
echo "  ok   schema untouched, no database access needed"

# --- the IA move: who reaches what must not have changed ------------------
MP="app/platform/dashboard/induction-videos/modules/page.tsx"
VP="app/platform/dashboard/induction-videos/page.tsx"
SVC=services/inductionModules/inductionModuleService.ts
test -f "$MP" || fail "the company modules page is not where it should be"
grep -q "canViewInductionModules(viewer.role)" "$MP" \
  || fail "the modules page does not gate on its own permission"
grep -q "canManageInductionVideos" "$MP" \
  && fail "the modules page inherited the AREA's gate - that admits a Principal Contractor"
grep -q "siteIds" "$MP" \
  && fail "the modules page copied the listing's site-scope guard - company content is not site-scoped"
grep -q "siteIds.length === 0) redirect" "$VP" \
  || fail "the videos listing lost its site-scope guard"
# The platform role sets moved to moduleRoles.ts when authority moved to the
# edge; the service itself must no longer contain a role list at all.
ROLES=services/inductionModules/moduleRoles.ts
grep -q "'DIRECTOR', 'PROJECT_MANAGER', 'SITE_MANAGER'\]" "$ROLES" \
  || fail "the module VIEW role set changed - a Project Manager must keep the read access they had"
grep -q "'DIRECTOR', 'SITE_MANAGER'\]" "$ROLES" \
  || fail "the module DRAFT role set changed"
test -f "app/api/platform/induction-modules/route.ts" \
  || fail "the moved API route is missing"
test -f "app/api/platform/settings/induction-modules/route.ts" \
  && fail "the old settings-shaped API path is still there"
grep -qF 'endpoint="/api/platform/induction-modules"' "$MP" \
  || fail "the Induction Videos page does not pass the platform endpoint"
grep -qF "redirect('/platform/dashboard/induction-videos/modules')" \
  app/platform/dashboard/settings/induction-modules/page.tsx \
  || fail "the old URL does not redirect - it shipped to production"
echo "  ok   IA asserts pass (10)"

# --- ONE SYSTEM, TWO FRONT DOORS -------------------------------------------
ACT=services/inductionModules/moduleActor.ts
ACTIONS=services/inductionModules/moduleActions.ts
AP="app/admin/(dashboard)/induction-videos/modules/page.tsx"
AR=app/api/admin/induction-modules/route.ts
SEC=components/platform/InductionModulesSection.tsx
test -f "$ACT"     || fail "the actor adapter is missing"
test -f "$ACTIONS" || fail "the shared action dispatcher is missing"
test -f "$AR"      || fail "the admin API route is missing"
test -f "$AP"      || fail "the admin page is missing"
# The service must read NO role string: that is what keeps one rule set.
grep -q "PlatformViewer" "$SVC" \
  && fail "the service still takes a PlatformViewer - authority must be resolved at the edge"
grep -q "viewer\.role" "$SVC" \
  && fail "the service reads a platform role string"
grep -qE "'OWNER'|'VIEWER'|AdminRole" "$SVC" \
  && fail "the service branches on an AdminRole - two rule sets is the failure mode"
# Neither route may implement an action.
for R in app/api/platform/induction-modules/route.ts "$AR"; do
  grep -q "handleModuleAction(" "$R" \
    || fail "$R does not use the shared dispatcher"
  grep -qE "startDraft\(|issueRevision\(|saveDraft\(" "$R" \
    && fail "$R implements an action itself - that is a duplicated workflow"
done
grep -q "requireAdminRole(ADMIN_WRITE_ROLES)" "$AR" \
  || fail "the admin route does not refuse a VIEWER at the door"
grep -q "endpoint: string" "$SEC" \
  || fail "the editor does not take its endpoint - one component must serve both doors"
grep -qE "fetch\('/api/" "$SEC" \
  && fail "the editor hard-codes an endpoint"
grep -q "moduleRowsForEditor" "$AP" \
  || fail "the admin page builds its own rows instead of using the shared builder"
grep -q "InductionModulesSection" "$AP" \
  || fail "the admin page does not render the shared editor"
# ATTRIBUTION: the realm must be recorded, and must never decide anything.
grep -q "actorRealm: actor.realm" "$SVC" \
  || fail "events no longer record which realm they came from"
grep -q "issuedByRealm: actor.realm" "$SVC" \
  || fail "an issued revision no longer records its realm"
grep -qE "(if|&&|\|\|)[^\n]*actor\.realm" "$SVC" \
  && fail "the realm is being used to decide something - it is a fact, not a permission"
grep -q "userId: null," "$ACT" \
  || fail "an admin actor may be writing an admin id into a platform user column"
echo "  ok   dual-realm asserts pass (17)"

# --- THE TWO TIERS MIRROR, AND CANNOT DRIFT --------------------------------
SHARED=services/inductionVideo/inductionVideoAreas.ts
PWS=components/platform/InductionVideoWorkspace.tsx
AWS=components/admin/AdminInductionVideoWorkspace.tsx
AV="app/admin/(dashboard)/induction-videos/page.tsx"
NAV=components/admin/AdminNav.tsx
ASI="app/admin/(dashboard)/settings/page.tsx"
test -f "$SHARED" || fail "the shared area definition is missing"
test -f "$AWS"     || fail "the Admin induction-video workspace is missing"
test -f "$AV"      || fail "the Admin videos listing is missing - the tab strip would lie"
# The labels must live in ONE file. This is the assert that prevents drift.
for L in "'Videos'" "'Company modules'"; do
  N=$(grep -lF "$L" "$SHARED" "$PWS" "$AWS" "$AP" "$AV" 2>/dev/null | wc -l)
  [ "$N" = "1" ] || fail "the label $L appears in $N files - it must be shared, not retyped"
done
grep -q "inductionVideoHref('PLATFORM'" "$PWS" \
  || fail "the Platform workspace does not build hrefs from the shared helper"
grep -q "inductionVideoHref('ADMIN'" "$AWS" \
  || fail "the Admin workspace does not build hrefs from the shared helper"
grep -qF "{ href: '/admin/induction-videos', label: 'Induction videos' }" "$NAV" \
  || fail "the Admin nav has no Induction videos area, or its wording differs from the Platform's"
grep -q "induction-modules" "$ASI" \
  && fail "induction modules is back under Admin Settings - that placement is what this fixes"
grep -qF "redirect('/admin/induction-videos/modules')" \
  "app/admin/(dashboard)/settings/induction-modules/page.tsx" \
  || fail "the old Admin settings URL does not redirect into the new area"
grep -qE "InductionModulesSection|<button|<form" "$AV" \
  && fail "the Admin videos listing offers actions - approving stays with the Platform user"
grep -q "platform/dashboard" "$AV" \
  && fail "the Admin videos listing links into Platform routes - dead ends for an admin"
echo "  ok   mirror asserts pass (12)"

# --- and the governance the move must NOT have altered ---------------------
RULES=services/inductionVideo/sceneRules.ts
SCRIPT=services/inductionVideo/scriptService.ts
VID=services/inductionVideo/inductionVideoService.ts
grep -q "if (!issued) continue; // a draft never reaches a site" "$SVC" \
  || fail "a DRAFT could reach a site"
grep -q "return role === 'DIRECTOR';" "$ROLES" \
  || fail "issuing is no longer a Director's alone in the PLATFORM realm"
grep -q "An issued revision cannot be edited" "$SVC" \
  || fail "an issued revision can be edited"
grep -q "status: InductionModuleRevisionStatus.SUPERSEDED" "$SVC" \
  || fail "issuing no longer supersedes the previous revision"
# Now expressed as a capability, so it holds in both realms: a platform Site
# Manager has canIssue false, and so does an Admin VIEWER.
grep -q "input.state === 'OVERRIDDEN' && !actor.canIssue" "$SVC" \
  || fail "overriding company wording no longer requires issue authority"
grep -q "input.state === 'EXCLUDED' && module.mandatory" "$SVC" \
  || fail "a MANDATORY module could be left out"
grep -q "input.reason.trim().length < 10" "$SVC" \
  || fail "a departure could be recorded without a real reason"
grep -q "update({ where: { id: existing.id }" "$SVC" \
  || fail "the decision write is not by id - the closed-project guard cannot resolve the site"
grep -q "siteInductionModule.upsert" "$SVC" \
  && fail "an upsert by compound key is back"
grep -q "COMPANY_BAND_AFTER: SceneType = 'RAMS'" "$RULES" \
  || fail "the company band moved out of its agreed place"
grep -q "m.replacesSceneType && emitted.has(m.replacesSceneType as SceneType)" "$RULES" \
  || fail "overlap suppression is gone"
grep -qF "s.facts, s.moduleRevisionId ?? '', s.narration ?? ''].join('|')" "$RULES" \
  || fail "the manifest hash ignores the module revision"
grep -qF "const siteScenes = manifest.scenes.filter((s) => s.source === 'SITE');" "$SCRIPT" \
  || fail "the model is handed company scenes"
test "$(grep -c 'if (scene.moduleRevisionId) {' "$VID")" -eq 2 \
  || fail "the edit and remove guards on company scenes are not both present"
echo "  ok   governance asserts pass (14)"

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
suite induction_modules_admin_ia_verify
suite induction_modules_realm_verify
suite induction_modules_ia_verify
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
npx next build >/tmp/inductionmodules_adminia_build.log 2>&1 || { tail -30 /tmp/inductionmodules_adminia_build.log; fail "build failed"; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/7] Confirming the BUILD, not just the source..."
# Phase C's panel, Phase B's badge, and Phase A's settings area.
for t in "Company induction content" "Leave it out of this project" \
         "Change the wording here" "Company induction modules" \
         "Create the six standard modules" "SITE INDUCTION RECORD" \
         "Company modules" "Induction video areas" "Now managed with Induction videos" \
         "the same modules managed in" "Induction modules"; do
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
test -f ".next/server/app/api/platform/induction-modules/route.js" \
  || fail "the moved module API did not build"
test -f ".next/server/app/platform/dashboard/induction-videos/modules/page.js" \
  || fail "the company modules page did not build in its new home"
test -f ".next/server/app/api/admin/induction-modules/route.js" \
  || fail "the admin module API did not build"
test -f ".next/server/app/admin/(dashboard)/induction-videos/page.js" \
  || fail "the Admin videos listing did not build"
test -f ".next/server/app/admin/(dashboard)/induction-videos/modules/page.js" \
  || fail "the Admin company-modules page did not build"
test -f ".next/server/app/admin/(dashboard)/settings/induction-modules/page.js" \
  || fail "the old Admin settings redirect did not build"
test ! -f ".next/server/app/api/platform/settings/induction-modules/route.js" \
  || fail "the OLD module API is still in the build"
test -f ".next/server/app/platform/dashboard/settings/induction-modules/page.js" \
  || fail "the backwards-compatible redirect did not build"
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
      -d '{"action":"seed"}' "${BASE}/api/platform/induction-modules" || echo 000)
echo "        POST /api/platform/induction-modules -> HTTP ${C}"
case "$C" in 401|403) ;; *) fail "the module API returned ${C}, expected 401/403" ;; esac

echo "      the ADMIN module API must be GATED, not broken:"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X POST -H 'content-type: application/json' \
      -d '{"action":"seed"}' "${BASE}/api/admin/induction-modules" || echo 000)
echo "        POST /api/admin/induction-modules -> HTTP ${C}"
case "$C" in 401|403) ;; *) fail "the admin module API returned ${C}, expected 401/403" ;; esac

echo "      route smoke test:"
SMOKE_FAIL=""
for path in / /check-in /worker/permits /platform/dashboard/sites \
            /platform/dashboard/settings/induction-modules \
            /platform/dashboard/induction-videos/modules \
            /admin/settings/induction-modules \
            /admin/induction-videos \
            /admin/induction-videos/modules ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
