#!/usr/bin/env bash
# CPP TIER 3A — MANAGEMENT ARRANGEMENTS — production deploy.
#
# Six L153 Appendix 3 Section 2 arrangements, written once at company level,
# inherited by every site, overridable per site, and LABELLED in the plan so a
# reviewer knows whether they are reading organisational policy or something
# written for this project.
#
# THE MIGRATION RUNS FIRST AND IS NOT PART OF THIS SCRIPT. ~/cpp_tier3a.sql is
# applied by hand before this runs, and [2/8] asks the LIVE DATABASE rather than
# a file — a schema.prisma mentioning the model proves only that someone edited
# it. Prisma lists every column explicitly, so a build that knows
# StandardArrangement throws against a database without it, and getCppDraft is on
# a live path.
#
# Postgres cannot remove an enum value: ArrangementKey is permanent. Additive
# only; rollback is a redeploy that leaves it inert (~/cpp_tier3a_rollback.sql,
# which is DESTRUCTIVE of authored policy text and prompts before dropping).
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cpptier3a_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}
# Comments stripped before every content grep. These files document the design
# decisions and name the very things being asserted; a raw grep matches its own
# documentation, which has caught this project four times now.
strip() { grep -v '^[[:space:]]*\*' "$1" | grep -v '^[[:space:]]*//' | grep -v '^[[:space:]]*///' | grep -v '^[[:space:]]*/\*'; }

echo "[1/8] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/8] Asserting the MIGRATION is already live..."
LIVE=$(~/pgprod -At -c "
  SELECT (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
            WHERE t.typname='ArrangementKey')
      || '/' ||
         (SELECT count(*) FROM information_schema.tables WHERE table_name='StandardArrangement')
      || '/' ||
         (SELECT count(*) FROM information_schema.tables WHERE table_name='SiteArrangement');
" 2>/dev/null | tr -d '[:space:]')
echo "      live: ArrangementKey values/StandardArrangement/SiteArrangement = ${LIVE:-<unreadable>}"
[ "$LIVE" = "6/1/1" ] || fail "migration not fully live (expected 6/1/1) - run ~/cpp_tier3a.sql first"
echo "  ok   migration confirmed in the live database"

echo "[3/8] Asserting the feature in the SOURCE..."
SVC_CODE=$(strip services/sites/arrangementService.ts)
CPP_CODE=$(strip services/sites/cppService.ts)
echo "$SVC_CODE" | grep -q "resolveArrangements" || fail "strip removed real code - checks would be vacuous"

# The inheritance rule, in one place.
echo "$SVC_CODE" | grep -qF 'const content = siteText ?? stdText;' \
  || fail "the inheritance rule is not site-then-standard"
echo "$SVC_CODE" | grep -q "usesDefault" \
  && fail "a usesDefault flag appeared - absent must mean inherit"
echo "$SVC_CODE" | grep -q "prisma.siteArrangement.deleteMany" \
  || fail "removing a site override is no longer a delete"

# Director-only company policy.
echo "$SVC_CODE" | grep -q "canEditSite(viewer.role)" \
  || fail "company arrangements are not Director-gated"

# The plan must label which text it is printing.
echo "$CPP_CODE" | grep -qF "label: arrangementSourceLabel(a.source)" \
  || fail "the CPP does not label company-standard vs site-specific"
echo "$CPP_CODE" | grep -qF "...arrangements.map((a) =>" \
  || fail "the arrangements are not rendered as CPP sections"

# Tier 3A must not move completion, as Tiers 1 and 2 did not.
REQ=$(sed -n '/const REQUIREMENTS/,/^export function requirementsFor/p' services/sites/siteSetupCompletion.ts)
echo "$REQ" | grep -q "of: 'siteRules'" || fail "REQUIREMENTS slice mis-located - next check vacuous"
echo "$REQ" | grep -qE "HS_FILE|WORKER_CONSULTATION|PUBLIC_PROTECTION|ArrangementKey" \
  && fail "an arrangement leaked into the completion requirements"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
for s in cpp_tier3a_verify cpp_tier2_verify cpp_content_verify cpp_completion_verify \
         site_rules_verify induction_grouping_verify; do
  npx tsx "scripts/$s.ts" | tail -1 | grep -q ", 0 failed" || fail "$s has failures"
done
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cpptier3a_build.log 2>&1 || {
  tail -30 /tmp/cpptier3a_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "The health and safety file" "Consultation and engagement with workers" \
         "Selection and management of contractors" "Public protection and site security" \
         "Accident and incident reporting" "Management structure and responsibilities" \
         "Site-specific" "Company standard"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
echo "  ok   all six arrangements and both source labels present"

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

echo "      route smoke test (3xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in /platform/dashboard/settings/arrangements /platform/dashboard/sites /check-in/site ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
