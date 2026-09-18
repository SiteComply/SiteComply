#!/usr/bin/env bash
# CPP DOCUMENT CONTROL PHASE A — REVISIONS — production deploy.
#
# The CPP was a live view with no version, no issue date and no history. This
# adds FROZEN REVISIONS alongside that view, with a content hash connecting the
# two so the system can report when the plan in force no longer matches the site.
#
# THE MIGRATION RUNS FIRST — ~/cpp_revisions.sql — and [2/8] asks the LIVE
# DATABASE. Prisma lists every column explicitly and getCppDraft is on a live
# path, so a build that knows CppRevision throws against a database without it.
#
# Postgres cannot remove an enum value, so CppRevisionStatus is permanent; values
# CAN be added, which is how Phase B introduces approval states. The rollback
# DESTROYS the historic record of what the plan said and cannot be regenerated —
# it prints the counts and prompts first.
#
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cpprevisions_deploy.zip

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
            WHERE t.typname='CppRevisionStatus')
      || '/' ||
         (SELECT count(*) FROM information_schema.tables WHERE table_name='CppRevision')
      || '/' ||
         (SELECT count(*) FROM information_schema.tables WHERE table_name='CppRevisionEvent');
" 2>/dev/null | tr -d '[:space:]')
echo "      live: status values/CppRevision/CppRevisionEvent = ${LIVE:-<unreadable>}"
[ "$LIVE" = "3/1/1" ] || fail "migration not fully live (expected 3/1/1) - run ~/cpp_revisions.sql first"
echo "  ok   migration confirmed in the live database"

echo "[3/8] Asserting the feature in the SOURCE..."
SVC_CODE=$(strip services/sites/cppRevisionService.ts)
PAGE=app/platform/dashboard/sites/[id]/cpp/page.tsx
echo "$SVC_CODE" | grep -q "createRevision" || fail "strip removed real code - checks would be vacuous"

# The snapshot must be immutable: written at creation and never updated.
echo "$SVC_CODE" | grep -c "snapshot: snapshotOf(" | grep -q '^1$' \
  || fail "the snapshot is written somewhere other than creation"
echo "$SVC_CODE" | grep -q "cppRevisionEvent.update\|cppRevisionEvent.delete" \
  && fail "the audit trail is no longer append-only"

# One in force, and superseding happens with issuing or not at all.
echo "$SVC_CODE" | grep -q '\$transaction' \
  || fail "issuing no longer supersedes in one transaction"
echo "$SVC_CODE" | grep -q "is already open as a draft" \
  || fail "a second open draft is no longer refused"

# Issuing is the duty-holder act.
echo "$SVC_CODE" | grep -q "canEditSite(viewer.role)" \
  || fail "issuing is not Director-gated"

# The live draft must survive document control.
grep -q "const cpp = await getCppDraft(viewer, params.id);" "$PAGE" \
  || fail "the page no longer assembles the live draft"
grep -q "getRevisionState(viewer, params.id, cpp)" "$PAGE" \
  || fail "drift is not computed against the live draft"

# The document must not lie about its own standing.
grep -q "Draft — for duty holder review and approval" "$PAGE" \
  && fail "the unconditional Draft banner is back"
grep -q "Working draft — for duty holder review and approval" "$PAGE" \
  || fail "the working-draft banner is missing"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
for s in cpp_revisions_verify cpp_tier3a_verify cpp_tier2_verify cpp_content_verify \
         cpp_completion_verify site_rules_verify induction_grouping_verify; do
  npx tsx "scripts/$s.ts" | tail -1 | grep -q ", 0 failed" || fail "$s has failures"
done
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cpprevisions_build.log 2>&1 || {
  tail -30 /tmp/cpprevisions_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "is the version in force" "Working draft" "Revision history" \
         "The issued revision is unchanged and remains the version in force" \
         "Site information has changed since Revision"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "Draft — for duty holder review and approval" $SHIPPED 2>/dev/null \
  && fail "the unconditional Draft banner is in the build"
echo "  ok   revision bar, drift notice and history present"

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
for path in /platform/dashboard/sites /check-in/site /worker/dashboard ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
