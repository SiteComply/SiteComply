#!/usr/bin/env bash
# CPP HEADER PROVENANCE MARK — production deploy.
#
# The document carried no SiteComply identity above the footer, which read as
# too sparse. A single mark now sits in the top-right corner, ABOVE the
# contractor's rule and outside the masthead proper.
#
#   - PLACE. Above the contractor, never level with or ahead of them: a CPP is
#     the Principal Contractor's statutory document, and a mark in their line
#     reads as the issuer.
#   - SIZE. 30px on screen, 22px in print. Both are asserted, because the print
#     block rescales the title from 42px to 24pt — a mark pinned to one height
#     would climb from 71% of the title's height to 94% of it on paper.
#   - RESTRAINT. An image and the space around it. No rule, banner, tint,
#     border or second mark, and no text beside it; the footer imprint keeps
#     the wording and stays at 26px.
#
# CORRECTS A MEASUREMENT carried in the previous script's header: the wordmark's
# lettering was reported there as 29% of the artwork's height. It is 51%
# (y 93-287 of 382). The earlier figure understated legibility badly and the
# conclusion drawn from it — that a readable word would need the ring cropped
# away — was answering a problem that does not exist.
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
ZIP=/tmp/cppprovenance_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/8] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/8] Asserting this change needs NO migration..."
git diff --quiet HEAD -- prisma/schema.prisma \
  || fail "prisma/schema.prisma is modified - this needs a migration and a different script"
echo "  ok   schema untouched"

echo "[3/8] Asserting the document, the mark and its limits..."
PAGE=app/platform/dashboard/sites/[id]/cpp/page.tsx
CSS=app/globals.css
grep -q "cpp-doc" "$CSS" || fail "the document stylesheet is missing"
grep -q -- "--cpp-accent: #003a54" "$CSS" || fail "the document accent changed"
grep -q "next/font/google" "$PAGE" || fail "the document fonts are not scoped to this route"
grep -q "next/font" app/layout.tsx && fail "fonts leaked into the root layout"
grep -q "'Current revision'" "$PAGE" || fail "the issued state is not called a current revision"

# PRINT CONTROL — must not regress.
grep -q "@page" "$CSS" || fail "there is no @page rule - print output is unmanaged again"
grep -qE "\.cpp-section \{ break-inside: avoid" "$CSS" \
  || fail "a section can split across a page again"
grep -qE "\.cpp-approval \{ break-inside: avoid" "$CSS" \
  || fail "the approval block can be orphaned from its signature again"

# CONTENTS — present, still with no invented page numbers.
grep -q 'className="cpp-contents"' "$PAGE" || fail "the contents page is missing"
grep -qE "Page [0-9]|pageNumber" "$PAGE" && fail "page numbers were invented in the document"

# THE OPENING. The callout stays gone; the CDM duty stays present.
grep -q "It is not an approved plan" "$PAGE" \
  && fail "the duplicated draft callout is back at the top of the document"
grep -q "suitable, sufficient and kept up to date" "$PAGE" \
  || fail "the CDM duty statement was dropped"

# WHAT STAYS GONE.
grep -q "cpp-brandrule" "$PAGE" && fail "the head rule is back"
grep -q -- "--cpp-brand:" "$CSS" && fail "brand-blue variables are back in the document"
grep -q '<circle cx="16" cy="16"' "$PAGE" && fail "the drawn substitute mark is back"

# THE ASSET AND THE FOOTER IMPRINT.
test -f public/sitecomply-logo.png || fail "the logo asset is missing from public/"
grep -q 'src="/sitecomply-logo.png"' "$PAGE" \
  || fail "the document is not using the genuine logo asset"
grep -q "Prepared and issued in SiteComply" "$PAGE" \
  || fail "the footer attribution line is gone"

# THE PROVENANCE MARK. Place, size on both media, and restraint.
python3 - "$PAGE" "$CSS" <<'PYPROV' || exit 1
import io, re, sys
page = io.open(sys.argv[1], encoding='utf-8').read()
css  = io.open(sys.argv[2], encoding='utf-8').read()
def die(m):
    print("  FAIL " + m); sys.exit(1)

# --- PLACE ---
if 'cpp-provenance' not in page: die("the provenance mark is missing from the document")
if not page.index('cpp-provenance') < page.index('cpp-issuer'):
    die("the mark is not above the contractor - it would read as the issuer")
if not page.index('cpp-issuer') < page.index('cpp-doctype'):
    die("the contractor no longer leads the masthead")

# --- THE MARK STANDS ALONE ---
i = page.index('<div className="cpp-provenance">')
div = re.sub(r'\{/\*[\s\S]*?\*/\}', '', page[i:page.index('</div>', i)])
if 'sitecomply-logo.png' not in div: die("the wrapper does not contain the genuine artwork")
if re.search(r'<span|<p\b|>[A-Za-z]', div):
    die("text was added beside the mark - the footer imprint carries the wording")

# One mark above the colophon. Comments stripped: the colophon's own comment
# names the asset path while explaining what lives there.
above = re.sub(r'\{/\*[\s\S]*?\*/\}', '', page[:page.index('cpp-foot')])
n = len(re.findall(r'sitecomply-logo\.png', above))
if n != 1: die("expected exactly one mark above the colophon, found %d" % n)

# --- SIZE, on both media ---
screen = css[:css.index('@media print {')]
printed = css[css.index('@media print {'):]
m = re.search(r'\.cpp-doc \.cpp-provenance img \{[^}]*\}', screen, re.S)
if not m or 'height: 30px' not in m.group(0):
    die("the screen mark is not 30px")
if not re.search(r'\.cpp-doc \.cpp-provenance img \{[^}]*height: 22px', printed, re.S):
    die("the mark has no print size - it would grow against the 24pt print title")
if 'font-size: 24pt' not in printed:
    die("the print title is no longer 24pt, so 22px is no longer the right ratio")
if not re.search(r'h1\.cpp-title \{[\s\S]{0,200}?font-size: 42px', screen):
    die("the screen title is no longer 42px, so 30px is no longer subordinate to it")

# --- RESTRAINT ---
w = re.search(r'\.cpp-doc \.cpp-provenance \{[^}]*\}', css, re.S)
if not w: die("the wrapper rule is missing")
if re.search(r'background|border|box-shadow|linear-gradient', w.group(0)):
    die("the wrapper draws a rule, background or border - it must only position the mark")

# --- THE FOOTER IMPRINT IS UNTOUCHED ---
f = re.search(r'\.cpp-doc \.cpp-foot \.imprint img \{[^}]*\}', css, re.S)
if not f or 'height: 26px' not in f.group(0):
    die("the footer imprint is no longer 26px")
print("  ok   mark above the contractor, 30px screen / 22px print, nothing drawn around it")
PYPROV

# SiteComply must not appear in the document BODY — between the masthead and the
# colophon. The mark sits ABOVE cpp-issuer, so it is outside this slice by
# design. Comments stripped: they name the thing being asserted.
python3 - "$PAGE" <<'PYBODY' || fail "SiteComply appears in the document body, not just the mark and the colophon"
import io,re,sys
s = io.open(sys.argv[1], encoding='utf-8').read()
body = s[s.index('cpp-issuer'):s.index('cpp-foot')]
body = re.sub(r'\{/\*[\s\S]*?\*/\}', '', body)
body = re.sub(r'/\*[\s\S]*?\*/', '', body)
sys.exit(0 if 'SiteComply' not in body and 'sitecomply-logo' not in body else 1)
PYBODY

python3 - "$CSS" <<'PYSTATUS' || fail "a coloured status banner was introduced"
import io,re,sys
css = io.open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'\.cpp-doc \.cpp-status \{[^}]*\}', css, re.S)
sys.exit(1 if m and 'background:' in m.group(0) else 0)
PYSTATUS
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
npx next build >/tmp/cppprovenance_build.log 2>&1 || {
  tail -30 /tmp/cppprovenance_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Construction Phase Plan — CDM 2015" "Current revision" \
         "Prepared and issued in SiteComply" "/sitecomply-logo.png" \
         "cpp-provenance" "cpp-contents" "@page"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "cpp-brandrule" $SHIPPED 2>/dev/null && fail "the head rule is in the build"
# The compiled stylesheet is minified, so whitespace is normalised before the
# height is read. Asserting the SOURCE is 30px proves nothing about what ships.
python3 - <<'PYBUILT' || fail "the built stylesheet does not carry a 30px provenance mark"
import glob, io, re, sys
for f in glob.glob('.next/static/css/*.css'):
    css = re.sub(r'\s+', '', io.open(f, encoding='utf-8').read())
    if '.cpp-provenanceimg' in css:
        m = re.search(r'\.cpp-provenanceimg\{[^}]*\}', css)
        if m and 'height:30px' in m.group(0):
            print("  ok   built css: 30px mark, minified"); sys.exit(0)
        print("  built css has the rule but not 30px: %s" % (m.group(0) if m else '?'))
        sys.exit(1)
sys.exit(1)
PYBUILT
echo "  ok   the mark, the imprint and the contents are all in the build"

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

echo "      the asset the mark points at must actually serve:"
LOGO=$(curl -s -o /dev/null -w "%{http_code}:%{size_download}" --max-time 25 "${BASE}/sitecomply-logo.png" || echo "000:0")
echo "        /sitecomply-logo.png -> ${LOGO}"
case "$LOGO" in 200:*) ;; *) fail "the logo asset does not serve - the mark would render as alt text" ;; esac

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
