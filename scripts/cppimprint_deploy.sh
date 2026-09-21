#!/usr/bin/env bash
# CPP BRANDING — GENUINE LOGO AS A PUBLISHER IMPRINT — production deploy.
#
# Two corrections and one placement.
#
#   - THE HEAD RULE IS REMOVED. A 2px gradient stopping at 62% read as a
#     rendering fault rather than a device.
#   - THE SUBSTITUTE MARK IS REMOVED. What was there was a drawn closed blue
#     ring with a dark blue tick. The real SiteComply logo is the lowercase
#     wordmark with an OPEN ring and a GREEN tick — wrong construction, wrong
#     colours. The document now uses public/sitecomply-logo.png, the same asset
#     the Logo component uses across the platform.
#   - The colophon becomes a PUBLISHER'S IMPRINT: reference left, mark above its
#     attribution right. That is the whole of the SiteComply identity here.
#
# ON THE MARK'S SIZE: the artwork carries 3.4% whitespace, so trimming gains
# nothing, and the mark stays at 26px with the attribution line beside it.
#
# CORRECTION, recorded here because this script asserted the original figure:
# the lettering band was reported as 29% of the artwork's height. It is 51%
# (y 93-287 of 382). The 26px imprint is unaffected — it has an attribution line
# doing the work either way — but the conclusion drawn from the wrong number,
# that a legible word needs a ~40px mark or the ring cropped away, was false.
# See scripts/cppprovenance_deploy.sh, which sizes the header mark on the real
# figure.
#
# No colour accent is added to the body. Document control keeps the tint and the
# dark blue it already had.
#
# NO MIGRATION.
#
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/cppimprint_deploy.zip

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

echo "[2/8] Asserting this change needs NO migration..."
git diff --quiet HEAD -- prisma/schema.prisma \
  || fail "prisma/schema.prisma is modified - this needs a migration and a different script"
echo "  ok   schema untouched"

echo "[3/8] Asserting the document, print control and contents..."
PAGE=app/platform/dashboard/sites/[id]/cpp/page.tsx
CSS=app/globals.css
grep -q "cpp-doc" "$CSS" || fail "the document stylesheet is missing"
grep -q -- "--cpp-accent: #003a54" "$CSS" || fail "the document accent changed"
grep -q "next/font/google" "$PAGE" || fail "the document fonts are not scoped to this route"
grep -q "next/font" app/layout.tsx && fail "fonts leaked into the root layout"
# (An inherited assertion counting 'Prepared and issued in SiteComply' lived
#  here. The colophon now reads "· prepared and issued in SiteComply" beside a
#  wordmark, so the count was both stale and the wrong question — the body scan
#  further down asks the right one: does SiteComply appear anywhere it should
#  not?)
grep -q "'Current revision'" "$PAGE" || fail "the issued state is not called a current revision"
# (The old assertion that REQUIRED this sentence lived here. It was carried
#  over when this script was copied and directly contradicted the new check
#  below, which requires the callout to be GONE. The draft caveat is still
#  asserted — as the relocated CDM duty and the not-approved line.)

# PRINT CONTROL — must not regress.
grep -q "@page" "$CSS" || fail "there is no @page rule - print output is unmanaged again"
grep -qE "\.cpp-section \{ break-inside: avoid" "$CSS" \
  || fail "a section can split across a page again"
grep -qE "\.cpp-approval \{ break-inside: avoid" "$CSS" \
  || fail "the approval block can be orphaned from its signature again"

# CONTENTS — present, and still with no invented page numbers.
grep -q 'className="cpp-contents"' "$PAGE" || fail "the contents page is missing"
grep -qE "Page [0-9]|pageNumber" "$PAGE" && fail "page numbers were invented in the document"

# THE OPENING. The callout stays gone; the CDM duty stays present.
grep -q "It is not an approved plan" "$PAGE" \
  && fail "the duplicated draft callout is back at the top of the document"
grep -q "suitable, sufficient and kept up to date" "$PAGE" \
  || fail "the CDM duty statement was dropped"

# BRANDING — the imprint, and its limits.
grep -q "cpp-brandrule" "$PAGE" && fail "the head rule is back"
grep -q -- "--cpp-brand:" "$CSS" && fail "brand-blue variables are back in the document"
grep -q '<circle cx="16" cy="16"' "$PAGE" && fail "the drawn substitute mark is back"
grep -q 'src="/sitecomply-logo.png"' "$PAGE" \
  || fail "the document is not using the genuine logo asset"
test -f public/sitecomply-logo.png || fail "the logo asset is missing from public/"
grep -q "Prepared and issued in SiteComply" "$PAGE" \
  || fail "the attribution line is gone"

python3 - "$CSS" <<'PYIMP' || fail "the imprint mark is not 26px - it must stay an imprint, not a logo at scale"
import io,re,sys
css = io.open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'\.cpp-doc \.cpp-foot \.imprint img \{[^}]*\}', css, re.S)
sys.exit(0 if m and 'height: 26px' in m.group(0) else 1)
PYIMP

python3 - "$CSS" <<'PYSTATUS' || fail "a coloured status banner was introduced"
import io,re,sys
css = io.open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'\.cpp-doc \.cpp-status \{[^}]*\}', css, re.S)
sys.exit(1 if m and 'background:' in m.group(0) else 0)
PYSTATUS

# SiteComply must not appear in the document BODY. Comments stripped: the
# colophon's own comment names it while explaining what lives there.
python3 - "$PAGE" <<'PYBODY' || fail "SiteComply appears in the document body, not just the colophon"
import io,re,sys
s = io.open(sys.argv[1], encoding='utf-8').read()
body = s[s.index('cpp-issuer'):s.index('cpp-foot')]
body = re.sub(r'\{/\*[\s\S]*?\*/\}', '', body)
body = re.sub(r'/\*[\s\S]*?\*/', '', body)
sys.exit(0 if 'SiteComply' not in body and 'sitecomply-logo' not in body else 1)
PYBODY
echo "  ok   source asserts pass"

echo "[4/8] Running the verification suites..."
for s in cpp_document_verify cpp_workflow_verify cpp_approval_verify cpp_revisions_verify \
         cpp_tier3a_verify cpp_tier2_verify cpp_content_verify cpp_completion_verify \
         site_rules_verify; do
  npx tsx "scripts/$s.ts" | tail -1 | grep -q ", 0 failed" || fail "$s has failures"
done
echo "  ok   suites green"

echo "[5/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cppimprint_build.log 2>&1 || {
  tail -30 /tmp/cppimprint_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Construction Phase Plan — CDM 2015" "Current revision" \
         "Prepared and issued in SiteComply" "/sitecomply-logo.png" \
         "cpp-contents" "@page"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "cpp-brandrule" $SHIPPED 2>/dev/null && fail "the head rule is in the build"
echo "  ok   genuine imprint present, head rule gone"

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
