#!/usr/bin/env bash
# CPP BRANDING — APPROVED SUBTLE TREATMENT — production deploy.
#
# Three branding touches, chosen from a three-way comparison and nothing beyond
# them:
#
#   - a 2px head rule, dark blue into logo blue, ABOVE the contractor's own rule;
#   - a tinted document-control block, which separates what the document IS from
#     what it SAYS — the piece actually doing legibility work;
#   - a two-tone mark and a set wordmark in the colophon, so it is clear where
#     the document originated.
#
# SiteComply is a SUPPORTING identity. The Principal Contractor's name leads the
# document and appears nowhere below it in the plan's own body — [3/8] fails if
# any SiteComply reference appears between the head rule and the colophon.
#
# No large logo, no marketing language, no coloured status banner. The wordmark
# carries by WEIGHT, not scale — same size as the surrounding footer type.
#
# PRINT: the head rule and the tint are backgrounds, which browsers drop unless
# the reader enables background graphics. Deliberately not forced. The control
# block's left rule is a BORDER so it survives, and the colophon's SVG mark
# prints — on paper the contractor's rule and the colophon carry identity, which
# is the right emphasis for a document the contractor issues.
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
ZIP=/tmp/cppbrand_deploy.zip

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

# BRANDING — the approved treatment, and its limits.
grep -q "cpp-brandrule" "$PAGE" || fail "the head rule is missing"
grep -q -- "--cpp-brand: #00aeef" "$CSS" || fail "the brand tone is not SiteComply's logo blue"
# CSS rules here span several lines, and grep is line-based — the first version
# of these two could never match and failed correct code. Python reads the file
# whole, as the JS suites do.
python3 - "$CSS" <<'PYCSS' || fail "the control block lost its tint or its print-surviving border"
import io,re,sys
css = io.open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'\.cpp-doc \.cpp-control \{[^}]*\}', css, re.S)
sys.exit(0 if m and 'background: var(--cpp-tint)' in m.group(0)
             and 'border-left: 2px solid var(--cpp-accent)' in m.group(0) else 1)
PYCSS
grep -q 'className="wordmark"' "$PAGE" || fail "the colophon wordmark is missing"
python3 - "$CSS" <<'PYWM' || fail "the wordmark is being scaled - it must carry by weight"
import io,re,sys
css = io.open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'\.cpp-doc \.cpp-foot \.wordmark \{[^}]*\}', css, re.S)
sys.exit(1 if m and 'font-size' in m.group(0) else 0)
PYWM
python3 - "$CSS" <<'PYSTATUS' || fail "a coloured status banner was introduced"
import io,re,sys
css = io.open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'\.cpp-doc \.cpp-status \{[^}]*\}', css, re.S)
sys.exit(1 if m and 'background:' in m.group(0) else 0)
PYSTATUS

# SiteComply must not appear in the plan's own body.
python3 - "$PAGE" <<'PYCHK' || fail "SiteComply appears in the document body, not just the colophon"
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
body=s[s.index('cpp-brandrule'):s.index('cpp-foot')]
sys.exit(0 if 'SiteComply' not in body else 1)
PYCHK
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
npx next build >/tmp/cppbrand_build.log 2>&1 || {
  tail -30 /tmp/cppbrand_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Construction Phase Plan — CDM 2015" "Current revision" \
         "prepared and issued in SiteComply" "cpp-brandrule" "cpp-contents" \
         "#00aeef" "@page"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "It is not an approved plan" $SHIPPED 2>/dev/null \
  && fail "the removed callout is still in the build"
echo "  ok   branding present, limits respected"

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
