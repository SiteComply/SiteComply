#!/usr/bin/env bash
# CPP DRAFT PRINT CONTROL — quieter, and plainly worded.
#
# "Print draft (browser)" was a full-width secondary button. Two problems: it
# had the visual weight of a primary action on a screen where the real document
# is a download, and it named the MECHANISM rather than what the user is doing.
# It is now a ghost-variant control reading "Print draft".
#
# BEHAVIOUR IS UNCHANGED - still window.print() on the working draft only.
#
# The other two callers of PrintButton (the close-out pack and the CLIENT-FACING
# share page) keep the original full-width secondary treatment: neither was part
# of this change, so the component's DEFAULTS are the old values and only the
# CPP passes the quieter props.
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
ZIP=/tmp/cppprint2_deploy.zip

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


# ── THE PDF PATH ──────────────────────────────────────────────────────────
PDFDOC=services/sites/cppPdf/CppPdfDocument.tsx
PDFROUTE="app/api/platform/sites/[id]/cpp-revisions/[revisionId]/pdf/route.ts"
test -f "$PDFDOC" || fail "the PDF document component is missing"
test -f "$PDFROUTE" || fail "the PDF route is missing"
test -f services/sites/cppPdf/renderCppPdf.ts || fail "the PDF renderer is missing"

for f in Chivo-400 Chivo-600 Chivo-700 CrimsonPro-400 CrimsonPro-600; do
  test -f "assets/fonts/$f.woff" || fail "assets/fonts/$f.woff is missing - the PDF will throw"
done
# WOFF2 reads fine under fontkit and then cannot be embedded by pdfkit, failing
# deep in EmbeddedFont.embed with a trace that never mentions woff2.
ls assets/fonts/*.woff2 >/dev/null 2>&1 && fail "a woff2 face is present - pdfkit cannot embed it"

python3 - "$PDFDOC" "$PDFROUTE" <<'PYPDF' || exit 1
import io, re, sys
doc = io.open(sys.argv[1], encoding='utf-8').read()
route = io.open(sys.argv[2], encoding='utf-8').read()
def die(m):
    print("  FAIL " + m); sys.exit(1)
def code(src):
    out = []
    for line in src.split('\n'):
        t = line.strip()
        if t.startswith(('*', '//', '/*')): continue
        out.append(line)
    return '\n'.join(out)

# THE lineHeight TRAP. Comments stripped: the block's own comment explains it
# and therefore contains the word being asserted absent.
m = re.search(r'page:\s*\{[\s\S]*?\n  \},', doc)
if not m: die("the PDF page style block could not be located")
if 'paddingHorizontal' not in m.group(0): die("the page style block looks wrong")
if re.search(r'lineHeight', code(m.group(0))):
    die("the PDF Page style sets lineHeight - every render prop will resolve to NOTHING")
if 'render` prop' not in m.group(0):
    die("the lineHeight warning was removed from the page style")

# The running foot and head carry render props and must stay free of it.
for name in ('runFootRight', 'runHeadText'):
    mm = re.search(name + r':\s*\{[^}]*\}', doc)
    if mm and 'lineHeight' in mm.group(0):
        die(name + " sets lineHeight - its render prop will resolve to nothing")

# TRUE page numbers must be wired, and on a DIRECT child of the fixed element.
if 'pageNumber' not in doc or 'totalPages' not in doc:
    die("the PDF has no page numbering")
if not re.search(r'<View style=\{s\.runFoot\} fixed>', doc):
    die("the running foot is not fixed - it will print once, not per page")

# The overlap bug: flex on a Text in a column container printed the detail over
# the label. Text assertions all passed while it was broken.
mm = re.search(r'itemLabel:[^\n]*', doc)
if mm and re.search(r'flex:\s*1', mm.group(0)):
    die("itemLabel sets flex:1 - the detail line will print on top of the label")

# Drafts must never render.
if "status !== 'ISSUED'" not in code(route):
    die("the route does not refuse a draft")
if 'getPlatformViewer' not in code(route) or 'getRevision(viewer' not in code(route):
    die("the route does not reuse the screen's authorisation")
if 'attachment; filename=' not in code(route):
    die("the PDF is not served as a named download")
# A slash in a site name reaching this header is a path separator, and an
# accented name sent only as ASCII arrives mangled.
if "filename*=UTF-8''" not in code(route):
    die("no RFC 5987 filename* - accented site names will arrive mangled")
if 'asciiFilename' not in code(route):
    die("no ASCII fallback filename for clients that need one")

# Determinism is the whole storage argument.
if 'creationDate={revision.issuedAt}' not in doc:
    die("the creation date is not pinned - renders will not be byte-identical")
print("  ok   PDF path: fonts, page numbers, no lineHeight trap, drafts refused")
PYPDF

# THE FILENAME. Short enough to scan in a folder or an attachment strip, and
# zero-padded so Rev 10 does not sort between Rev 1 and Rev 2.
python3 - services/sites/cppPdf/renderCppPdf.ts <<'PYNAME' || exit 1
import io, re, sys
src = io.open(sys.argv[1], encoding='utf-8').read()
def die(m):
    print("  FAIL " + m); sys.exit(1)
if "'CPP'" not in src: die("the filename no longer leads with CPP")
if "padStart(2, '0')" not in src: die("the revision is not zero-padded - Rev 10 will sort before Rev 2")
if re.search(r'getUTCFullYear', src): die("an issue date is back in the filename")
# Checked as WIRING, not as a token: a constant can be renamed or left unused
# while the name still appears in the file.
if not re.search(r'\.replace\(ILLEGAL,', src):
    die("illegal filename characters are no longer stripped - a slash would become a path separator")
if not re.search(r'const ILLEGAL = /\[[^\]]*\\\\/', src):
    die("the illegal-character class no longer covers the path separators")
if src.count('tidy(') < 3:
    die("the filename parts are not all tidied")
print("  ok   filename: CPP - <job> - <site> - Rev NN.pdf")
PYNAME

# The browser-print claim must be gone from the plan screen, and the draft
# control must stay quiet. The LABEL is deliberately not pinned - that assertion
# expired once already when the wording changed.
grep -q "Print / save as PDF" "$PAGE" && fail "the plan still offers browser print as its PDF"
grep -q "<PrintButton" "$PAGE" || fail "the draft print control is gone"
grep -q 'variant="ghost"' "$PAGE" || fail "the draft print control is no longer quiet"
grep -q 'fullWidth={false}' "$PAGE" || fail "the draft print control is full-width again"
grep -qE "PrintButton[^>]*\((browser|print)\)" "$PAGE" && fail "the label names the mechanism again"
# The other two callers must keep the original treatment.
PB=components/worker/PrintButton.tsx
grep -q "variant = 'secondary'" "$PB" || fail "PrintButton's default variant changed - the pack pages would change too"
grep -q "fullWidth = true" "$PB" || fail "PrintButton's default width changed - the pack pages would change too"
grep -q "variant=" "app/pack/[token]/page.tsx" && fail "the client share page was changed - it was not in scope"
grep -q "variant=" "app/platform/dashboard/sites/[id]/close-out/[packId]/page.tsx" && fail "the close-out pack was changed - it was not in scope"
echo "  ok   the draft print control is quiet, and the pack pages are untouched"

echo "[4/8] Running the verification suites..."
for s in cpp_document_verify cpp_workflow_verify cpp_approval_verify cpp_revisions_verify \
         cpp_tier3a_verify cpp_tier2_verify cpp_content_verify cpp_completion_verify \
         site_rules_verify; do
  npx tsx "scripts/$s.ts" | tail -1 | grep -q ", 0 failed" || fail "$s has failures"
done
# The PDF suite RENDERS A REAL DOCUMENT and reads it back with pdftotext, so it
# needs its own runner: tsx compiles to CJS and @react-pdf ships ESM only.
./scripts/cpp_pdf_verify.sh | tail -1 | grep -q ", 0 failed" || fail "cpp_pdf_verify has failures"
echo "  ok   suites green, PDF rendered and read back"

echo "[5/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/cppprint2_build.log 2>&1 || {
  tail -30 /tmp/cppprint2_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Construction Phase Plan — CDM 2015" "Current revision" \
         "Prepared and issued in SiteComply" "/sitecomply-logo.png" \
         "cpp-provenance" "cpp-contents" "@page" \
         "Duty holder approval"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "cpp-brandrule" $SHIPPED 2>/dev/null && fail "the head rule is in the build"

# THE PDF ROUTE, as SHIPPED. The filename is assembled from parts, so the
# literal "CPP - " never appears in the output — an earlier version of this
# assertion looked for it and failed a correct build. These match what the
# minified route actually contains.
PDFOUT=".next/server/app/api/platform/sites/[id]/cpp-revisions/[revisionId]/pdf/route.js"
test -f "$PDFOUT" || fail "the PDF route did not build"
grep -qF '["CPP"' "$PDFOUT" || fail "the shipped route does not build a CPP filename"
grep -qF 'Rev ${' "$PDFOUT" || fail "the shipped route does not label the revision"
grep -qF "UTF-8''" "$PDFOUT" || fail "the shipped route sends no RFC 5987 filename*"
grep -qF 'attachment; filename' "$PDFOUT" || fail "the shipped route does not send an attachment"
# The fonts are read from disk at render time, so they must be in the package.
for f in Chivo-400 Chivo-600 Chivo-700 CrimsonPro-400 CrimsonPro-600; do
  test -f "assets/fonts/$f.woff" || fail "assets/fonts/$f.woff vanished before packaging"
done
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
echo "  ok   the mark, the imprint, the contents and the PDF path are in the build"

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

echo "      the PDF route must be gated, not broken:"
PDFC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 \
  "${BASE}/api/platform/sites/x/cpp-revisions/y/pdf" || echo 000)
echo "        /api/platform/sites/x/cpp-revisions/y/pdf -> HTTP ${PDFC}"
case "$PDFC" in 401|404|3*) ;; *) fail "the PDF route returned ${PDFC}, expected 401/404" ;; esac

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
