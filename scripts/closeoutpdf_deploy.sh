#!/usr/bin/env bash
# THE CLOSE-OUT PACK AS A DOCUMENT — server-rendered PDF, all three ways in.
#
# NO MIGRATION. A new document, a shared PDF kit, two new routes, two screens.
#
# WHAT MUST NOT REGRESS: the pack went to CLIENTS as close-out-pack.html inside
# a ZIP - a web page for them to open and print themselves. The asserts below
# pin the replacement, the single renderer behind all three ways in, and the
# four engine traps the kit now closes for every document.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/closeoutpdf_deploy.zip

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
grep -q "name: 'close-out-pack.pdf'" services/closeOut/closeOutArchive.ts \
  || fail "the ZIP no longer carries the PDF"
grep -q "close-out-pack.html" services/closeOut/closeOutArchive.ts \
  && fail "the HTML pack is back - that is what clients were being sent"
grep -q "function packHtml" services/closeOut/closeOutArchive.ts \
  && fail "the dead HTML builder is back"
grep -q "PrintButton" "app/pack/[token]/page.tsx" \
  && fail "the client share page asks a client to print a web page again"
grep -q "PrintButton" "app/platform/dashboard/sites/[id]/close-out/[packId]/page.tsx" \
  && fail "the internal pack page prints the screen again"
for r in "app/api/pack/[token]/pdf/route.ts" "app/api/platform/sites/[id]/close-out/[packId]/pdf/route.ts"; do
  grep -q "renderCloseOutPackPdf" "$r" || fail "$r does not render the shared document"
  grep -q "renderPack(" "$r" || fail "$r serves a stored copy instead of re-reading live records"
done
grep -q "collectAppendixLabels" "app/api/pack/[token]/pdf/route.ts" \
  || fail "appendix numbering no longer comes from the archive's own collector"
# The kit closes these for EVERY document; losing one is silent in the output.
grep -q "marginTop: 'auto'" services/pdfKit/documentKit.tsx \
  || fail "the shared footer is positioned absolutely - it prints NOTHING on a full page"
grep -qE "footerRight: \{ width: [0-9]+" services/pdfKit/documentKit.tsx \
  || fail "the shared page-number Text lost its width - it collapses to nothing"
grep -qE "footerText: \{[^}]*lineHeight: *[0-9.]" services/pdfKit/documentKit.tsx \
  && fail "a lineHeight on the shared footer text kills every document's page numbers"
grep -q "\.woff2" services/pdfKit/documentKit.tsx \
  && fail "WOFF2 faces cannot be embedded"
grep -q "AI-GENERATED" services/closeOutPdf/CloseOutPackPdf.tsx \
  || fail "machine-written prose is no longer badged"
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
suite closeout_pdf_verify
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
npx next build >/tmp/closeoutpdf_build.log 2>&1 || { tail -30 /tmp/closeoutpdf_build.log; fail "build failed"; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/7] Confirming the BUILD, not just the source..."
for t in "PROJECT CLOSE-OUT PACK" "Download the pack (PDF)" "AI-GENERATED" "PERMIT TO WORK"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
for r in "app/api/pack/[token]/pdf/route.js" \
         "app/api/platform/sites/[id]/close-out/[packId]/pdf/route.js"; do
  test -f ".next/server/$r" || fail "route did not build: $r"
done
test -f assets/fonts/SourceSans3-400.woff || fail "the embedded faces are missing from the tree"
echo "  ok   the pack document, both routes and the faces are in the build"

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

echo "      the pack document routes must be GATED, not broken:"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "${BASE}/api/pack/not-a-real-token/pdf" || echo 000)
echo "        /api/pack/<bad token>/pdf -> HTTP ${C}"
case "$C" in 404) ;; *) fail "an invalid share token returned ${C}, expected 404" ;; esac
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "${BASE}/api/platform/sites/x/close-out/y/pdf" || echo 000)
echo "        /api/platform/sites/x/close-out/y/pdf -> HTTP ${C}"
case "$C" in 401|403|404|307) ;; *) fail "returned ${C}, expected 401/403/404/307" ;; esac

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
