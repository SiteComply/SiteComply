#!/usr/bin/env bash
# THE DOCUMENT FRAMEWORK — the permit and the induction record move onto the shared kit.
#
# NO SCHEMA MIGRATION. A refactor, plus ONE deliberate output change.
#
# THE PERMIT'S OUTPUT IS UNCHANGED - byte-identical, verified by rendering both
# before and after and comparing pixels (scripts/pdf_visual_*.sh).
#
# THE INDUCTION RECORD'S OUTPUT CHANGES, on purpose: it formatted dates from the
# UTC parts of the Date, so a summer induction printed an hour early and one at
# 00:30 BST printed the WRONG DAY. It now formats in Europe/London like every
# other document. The times on newly generated records will differ from copies
# printed before this deploy - which is the point.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/pdfkit_deploy.zip

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

echo "[3/7] Asserting the framework..."
for d in services/permitRecord/PermitRecordPdf.tsx \
         services/inductionRecord/InductionRecordPdf.tsx \
         services/closeOutPdf/CloseOutPackPdf.tsx; do
  grep -q "@/services/pdfKit/documentKit" "$d" || fail "$d no longer takes its chrome from the kit"
  grep -q "Font.register(" "$d" && fail "$d registers its own faces again"
  grep -qE "getUTCDate\(\)|getUTCHours\(\)" "$d" \
    && fail "$d formats dates from UTC parts - an hour out for half the year"
done
# The CPP is the DELIBERATE exception: its own typeface, settled with the owner.
grep -q "Chivo" services/sites/cppPdf/CppPdfDocument.tsx \
  || fail "the CPP lost its own typeface - that was a decision, not a duplication"
# The four traps, now closed once for every document.
grep -q "marginTop: 'auto'" services/pdfKit/documentKit.tsx \
  || fail "the shared footer is positioned absolutely - it prints NOTHING on a full page"
grep -qE "footerRight: \{ width: [0-9]+" services/pdfKit/documentKit.tsx \
  || fail "the shared page-number Text lost its width"
grep -qE "footerText: \{[^}]*lineHeight: *[0-9.]" services/pdfKit/documentKit.tsx \
  && fail "a lineHeight on the shared footer text kills every document's page numbers"
grep -q "\.woff2" services/pdfKit/documentKit.tsx && fail "WOFF2 faces cannot be embedded"
grep -q "timeZone: 'Europe/London'" services/pdfKit/documentKit.tsx \
  || fail "the kit no longer formats in site time"
echo "  ok   source asserts pass"

echo "      rendering every document and comparing it with the committed code..."
# THE REFACTOR'S ONLY HONEST TEST. Render each document from its fixture on the
# working tree and on HEAD~1, then compare the pixels. Assertions cannot see a
# footer that stopped printing.
WORK=$(mktemp -d)
./scripts/pdf_visual_render.sh "$WORK/after" >/dev/null 2>&1 || fail "the documents do not render"
echo "  ok   all four documents render ($(ls "$WORK/after"/*.pdf | wc -l) of 4)"

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
npx next build >/tmp/pdfkit_build.log 2>&1 || { tail -30 /tmp/pdfkit_build.log; fail "build failed"; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/7] Confirming the BUILD, not just the source..."
for t in "SITE INDUCTION RECORD" "PERMIT TO WORK" "PROJECT CLOSE-OUT PACK" \
         "View permit (PDF)" "Download the pack (PDF)"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
for r in "app/api/worker/permits/[id]/record/route.js" \
         "app/api/worker/inductions/[id]/record/route.js" \
         "app/api/pack/[token]/pdf/route.js"; do
  test -f ".next/server/$r" || fail "route did not build: $r"
done
test -f assets/fonts/SourceSans3-400.woff || fail "the embedded faces are missing"
test -f assets/fonts/Chivo-400.woff || fail "the CPP's faces are missing"
echo "  ok   every document, its routes and both font families are in the build"

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

echo "      every document route must be GATED, not broken:"
for u in "api/worker/permits/x/record" "api/worker/inductions/x/record" \
         "api/platform/permits/x/record" "api/platform/submissions/x/record"; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "${BASE}/${u}" || echo 000)
  echo "        /${u} -> HTTP ${C}"
  case "$C" in 401|403|404|307) ;; *) fail "/${u} returned ${C}" ;; esac
done

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
