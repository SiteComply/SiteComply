#!/usr/bin/env bash
# SITE RULES — POST-INDUCTION REVIEW — production deploy.
#
# Operatives could not find the rules they acknowledged. Site information showed
# a "Site rules" card rendering the unrelated free-text field, and rendered
# nothing when that field was blank; the acknowledged rules existed afterwards
# only inside the induction record PDF.
#
# This ships: one Site rules section on Site information (library rules first,
# free text beneath as supplementary notes), always visible regardless of the
# SITE_INFORMATION panel, plus the editor renames that caused the confusion.
#
# NO SCHEMA CHANGE. SITE_RULE was added to the enum on 2026-09-17 and is already
# live; nothing here adds a column, an enum value or a migration. [2/8] proves
# that claim against the repo rather than asserting it in a comment, so this
# script cannot be reused for a change that DOES need a migration without the
# assertion failing first.
#
# Rollback is a redeploy of the previous build. Nothing here is destructive and
# no data is written.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/siterulesreview_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }

served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/8] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/8] Asserting this change needs NO migration..."
# The guard that lets this script skip the live-database check the Site Rules
# Library deploy required. If the schema moved, that assumption is void.
git diff --quiet HEAD -- prisma/schema.prisma \
  || fail "prisma/schema.prisma is modified - this needs a migration and a different script"
[ -z "$(git status --porcelain prisma/migrations 2>/dev/null)" ] \
  || fail "prisma/migrations changed - this needs a migration and a different script"
echo "  ok   schema and migrations untouched"

echo "[3/8] Asserting the feature is in the SOURCE..."
PAGE=app/worker/site-information/page.tsx
grep -q "getSiteRulesForWorker(site.id, worker.id)" "$PAGE" \
  || fail "Site information does not fetch the worker's rule view"
grep -q "const rulesOnly = !panels.SITE_INFORMATION;" "$PAGE" \
  || fail "the page still hides rules when the panel is off"
grep -q "if (rulesOnly && siteRules.rules.length === 0) redirect('/worker/dashboard');" "$PAGE" \
  || fail "panel-off-and-no-rules no longer falls back to the dashboard"
[ "$(grep -c 'title="Site rules"' "$PAGE")" = "1" ] \
  || fail "expected exactly ONE Site rules card on Site information"
grep -q "alsoWhenSiteRules: true" components/worker/WorkerNav.tsx \
  || fail "the nav cannot show Site information when the panel is off"
grep -q "await siteHasSiteRules(activeSiteId)" components/worker/WorkerShell.tsx \
  || fail "the shell does not resolve site-rules visibility"
# The renames. A regression here re-creates the exact confusion being fixed.
EXP="app/platform/dashboard/sites/[id]/experience/page.tsx"
grep -q "label: 'Site rules'," "$EXP" \
  || fail "the Site rules tab label is missing"
grep -q "Site rules (induction)" "$EXP" \
  && fail "the '(induction)' suffix is back - it was removed deliberately"
grep -q "The numbered rules operatives agree to at induction" "$EXP" \
  || fail "the tab description no longer names the induction"
grep -q 'label="Additional site information"' components/platform/SiteInformationConfig.tsx \
  || fail "the free-text field is still labelled Site rules"
grep -q "label: 'Additional site information'" components/platform/SiteSetupWizard.tsx \
  || fail "the setup wizard still labels the free-text field as Site rules"
grep -q "label: 'Additional site information'" services/sites/siteInformationConstants.ts \
  || fail "the completeness indicator still reports Site rules missing"
grep -q "title: 'Additional site information'" services/sites/siteSetupConstants.ts \
  || fail "the setup step still claims to be the induction rules"
# The client/server split that fixed the browser build must hold.
#
# Matched on IMPORT STATEMENTS only, anchored to the start of a line. This file
# EXPLAINS the boundary in its header comment and names adminChecklistService and
# @prisma/client while doing so, so a plain content grep reports a violation on a
# perfectly correct file - which is exactly what it did the first time this ran.
# The Site Rules Library deploy script warns about this and strips comments; the
# anchor achieves the same thing for the one line that matters here.
grep -qE "^import .*(from '@/lib/prisma'|adminChecklistService|from '@prisma/client')" \
  services/checklists/siteRuleRows.ts \
  && fail "siteRuleRows imports server-only code - the client bundle will break"
# ...and prove that check can actually fire, rather than passing because the
# pattern never matches anything.
grep -qE "^import .*(from '@/lib/prisma'|adminChecklistService|from '@prisma/client')" \
  services/checklists/siteRulesService.ts \
  || fail "the server-only import pattern matches nothing - the guard above is vacuous"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
npx tsx scripts/site_rules_verify.ts | tail -1 | grep -q ", 0 failed" \
  || fail "site_rules_verify has failures"
npx tsx scripts/induction_grouping_verify.ts | tail -1 | grep -q ", 0 failed" \
  || fail "induction_grouping_verify has failures"
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/siterulesreview_build.log 2>&1 || {
  tail -30 /tmp/siterulesreview_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one - nothing would change"

echo "      confirming the feature is in the BUILD, not just the source..."
npx tsx scripts/site_rules_artifact_guard.ts | tail -1 | grep -q ", 0 failed" \
  || fail "the feature is not in the build that would ship"
echo "  ok   artifact guard green"

echo "[6/8] Packaging zip..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[7/8] Deploying to App Service..."
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[8/8] Cutting over (stop/start) and verifying..."
# A zip deploy on this app has reported success while the OLD process kept
# serving. The restart is what makes the new build the one actually running, so
# it is unconditional and the SERVED build id is the only accepted evidence.
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
[ "$SERVED" = "$NEW_BUILD" ] \
  || fail "prod is serving ${SERVED:-<unreadable>}, not ${NEW_BUILD}"

echo "      route smoke test (3xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in /worker/site-information /check-in/site /platform/dashboard/sites ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
