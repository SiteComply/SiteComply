#!/usr/bin/env bash
# THE PERMIT AS A CONTROLLED DOCUMENT — server-rendered PDF, both sides.
#
# NO MIGRATION. New service, two new routes, two screens changed.
#
# WHAT MUST NOT REGRESS: the permit was a window.print() of the worker's screen,
# which stamps the reader's own browser header and footer onto a document that
# authorises work. The asserts below pin the replacement AND the four engine
# traps that each produced a plausible document with something silently missing.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/permitpdf_deploy.zip

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

echo "[3/7] Asserting the document..."
grep -rq "window.print" components/permits/ \
  && fail "the permit still prints the browser's page"
grep -q "api/worker/permits/\${permitId}/record" components/permits/PermitActions.tsx \
  || fail "the worker no longer gets the document"
grep -q "api/platform/permits/\${permit.id}/record" "app/platform/dashboard/permits/[id]/page.tsx" \
  || fail "the manager's copy is gone"
grep -q "effectiveStatus({" services/permitRecord/permitRecordData.ts \
  || fail "the state is no longer derived - an expired permit could read as approved"
grep -q "Status shown as at" services/permitRecord/PermitRecordPdf.tsx \
  || fail "the document no longer says when it was produced"
# The four traps, each of which renders a plausible document with something gone.
grep -q "marginTop: 'auto'" services/permitRecord/PermitRecordPdf.tsx \
  || fail "the footer is positioned absolutely again - it prints NOTHING on a full page"
grep -qE "footerRight: \{ width: [0-9]+" services/permitRecord/PermitRecordPdf.tsx \
  || fail "the page-number Text lost its width - it collapses to nothing"
grep -qE "footerText: \{[^}]*lineHeight: *[0-9.]" services/permitRecord/PermitRecordPdf.tsx \
  && fail "a lineHeight on the footer text kills the page numbers silently"
grep -q "\.woff2" services/permitRecord/PermitRecordPdf.tsx \
  && fail "WOFF2 faces read fine and cannot be embedded"
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
# This change's own suite first. It runs through its .sh wrapper because
# @react-pdf is ESM-only and dies under tsx — see scripts/permit_record_verify.sh.
suite permit_record_verify
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
npx next build >/tmp/permitpdf_build.log 2>&1 || { tail -30 /tmp/permitpdf_build.log; fail "build failed"; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/7] Confirming the BUILD, not just the source..."
for t in "PERMIT TO WORK" "View permit (PDF)" "CONDITIONS CONFIRMED BEFORE THE WORK" "Status shown as at"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "View permit (PDF)" .next/static 2>/dev/null || fail "the worker's button is not in the client bundle"
for r in "app/api/worker/permits/[id]/record/route.js" "app/api/platform/permits/[id]/record/route.js"; do
  test -f ".next/server/$r" || fail "route did not build: $r"
done
# The fonts must travel with the deployment or the document cannot be embedded.
test -f assets/fonts/SourceSans3-400.woff || fail "the embedded faces are missing from the tree"
echo "  ok   the document, both routes and the faces are in the build"

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

echo "      the permit document routes must be GATED, not broken:"
for p in "worker" "platform"; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "${BASE}/api/${p}/permits/x/record" || echo 000)
  echo "        /api/${p}/permits/x/record -> HTTP ${C}"
  case "$C" in 401|403|404|307) ;; *) fail "returned ${C}, expected 401/403/404/307" ;; esac
done

echo "      route smoke test:"
SMOKE_FAIL=""
for path in / /check-in /worker/permits /platform/dashboard/permits ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
