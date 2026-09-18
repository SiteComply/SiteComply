#!/usr/bin/env bash
# CPP DOCUMENT CONTROL PHASE B — APPROVAL & SIGNATURE — production deploy.
#
# Phase A could version and freeze a plan but not say who approved it. Approving
# and issuing are ONE act here, so this adds the evidence of that act — the
# approver's role at the time, the declaration they accepted, and their
# signature — and makes a signature MANDATORY to issue at all.
#
# Issuing widens from Director-only to Director or Principal Contractor: the duty
# holder CDM 2015 actually names. A Site Manager still cannot approve the plan
# they wrote.
#
# THE MIGRATION RUNS FIRST — ~/cpp_approval.sql. All five columns are NULLABLE so
# revisions issued under Phase A stay valid; they have no signature because
# signatures did not exist, and back-filling one would invent evidence nobody
# gave. [2/8] asks the LIVE DATABASE.
#
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cppapproval_deploy.zip

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
  SELECT count(*) FROM information_schema.columns
  WHERE table_name='CppRevision'
    AND column_name IN ('approverRole','declarationText','signedName','signatureType','signatureBlobPath');
" 2>/dev/null | tr -d '[:space:]')
NULLABLE=$(~/pgprod -At -c "
  SELECT count(*) FROM information_schema.columns
  WHERE table_name='CppRevision'
    AND column_name IN ('approverRole','declarationText','signedName','signatureType','signatureBlobPath')
    AND is_nullable='YES';
" 2>/dev/null | tr -d '[:space:]')
echo "      live: approval columns = ${LIVE:-<unreadable>}, nullable = ${NULLABLE:-<unreadable>}"
[ "$LIVE" = "5" ] || fail "migration not live (expected 5 columns) - run ~/cpp_approval.sql first"
# NOT NULL would break every Phase A revision on the first read.
[ "$NULLABLE" = "5" ] || fail "an approval column is NOT NULL - Phase A revisions would break"
echo "  ok   migration confirmed in the live database"

echo "[3/8] Asserting the feature in the SOURCE..."
SVC_CODE=$(strip services/sites/cppRevisionService.ts)
PAGE=app/platform/dashboard/sites/[id]/cpp/page.tsx
BAR=components/platform/CppRevisionBar.tsx
echo "$SVC_CODE" | grep -q "issueRevision" || fail "strip removed real code - checks would be vacuous"

# There must be NO unsigned route to issuing.
echo "$SVC_CODE" | grep -q "A signature is required to approve and issue the plan" \
  || fail "a plan can be issued without a signature"
echo "$SVC_CODE" | grep -q "parseSignatureInput" \
  || fail "signature validation is no longer shared with the induction"

# Duty-holder roles only, enforced in the service.
echo "$SVC_CODE" | grep -q "canIssueCpp(viewer.role)" \
  || fail "issuing is not gated on the duty-holder roles"
grep -q "'DIRECTOR'," services/platformUsers/platformPermissions.ts \
  || fail "the issue role list is missing"
grep -q "'PRINCIPAL_CONTRACTOR'," services/platformUsers/platformPermissions.ts \
  || fail "the Principal Contractor cannot issue"

# The approval record is snapshotted, not read back later.
echo "$SVC_CODE" | grep -q "approverRole: viewer.role" \
  || fail "the approver role is not snapshotted"
echo "$SVC_CODE" | grep -q "declarationText: CPP_APPROVAL_DECLARATION" \
  || fail "the declaration is not snapshotted"

# The printed block must show the real record, and stay blank on a draft.
grep -q "Approved by: " "$PAGE" || fail "the approval block does not print the approver"
grep -q "This is a working draft. Approval is recorded when a revision is" "$PAGE" \
  || fail "a working draft no longer shows unsigned lines"
grep -q "issued before approval records were captured" "$PAGE" \
  || fail "a Phase A revision with no signature is not handled honestly"

# The dialog must require both.
grep -q 'disabled={busy || !accepted || !signature}' "$BAR" \
  || fail "the approval dialog can submit without a declaration or signature"
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
for s in cpp_approval_verify cpp_revisions_verify cpp_tier3a_verify cpp_tier2_verify \
         cpp_content_verify cpp_completion_verify site_rules_verify induction_grouping_verify; do
  npx tsx "scripts/$s.ts" | tail -1 | grep -q ", 0 failed" || fail "$s has failures"
done
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cppapproval_build.log 2>&1 || {
  tail -30 /tmp/cppapproval_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Approve and issue Revision" "in my judgement it is suitable and sufficient" \
         "Approved by: " "This is a working draft. Approval is recorded when a revision is" \
         "issued before approval records were captured" \
         "Only a Director or Principal Contractor can approve and issue"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
echo "  ok   approval flow, declaration and honest gaps present"

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
