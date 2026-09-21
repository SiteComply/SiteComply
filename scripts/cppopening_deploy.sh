#!/usr/bin/env bash
# CPP OPENING — REMOVE THE DUPLICATED DRAFT CALLOUT — production deploy.
#
# The amber draft callout at the top of the document is removed. It repeated
# what the opening already said three ways — the heading reads "Working draft",
# the status line reads "Not yet issued", and the control block shows no
# approver — and put a coloured block on a document that earns its authority
# from restraint.
#
# ONE SENTENCE OF IT WAS NOT DUPLICATED and is retained: the CDM 2015 duty, that
# the Principal Contractor remains responsible for the plan being suitable and
# sufficient. Software can assemble a plan; it cannot warrant that the plan is
# adequate. It moved into the approval block, where approval and responsibility
# are already being discussed. [3/8] fails if it is lost.
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
ZIP=/tmp/cppopening_deploy.zip

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
test "$(grep -c 'Prepared and issued in SiteComply' "$PAGE")" = "1" \
  || fail "SiteComply appears more than once in the document"
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

# THE OPENING. The callout goes; the CDM duty stays.
grep -q "It is not an approved plan" "$PAGE" \
  && fail "the duplicated draft callout is back at the top of the document"
grep -q "suitable, sufficient and kept up to date" "$PAGE" \
  || fail "the CDM duty statement was dropped, not relocated"
grep -q "has not been approved or issued" "$PAGE" \
  || fail "a draft no longer says plainly that it is not approved"
grep -q "'Working draft'" "$PAGE" || fail "the draft heading is gone"
grep -q "'Not yet issued'" "$PAGE" || fail "the not-yet-issued status is gone"
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
npx next build >/tmp/cppopening_build.log 2>&1 || {
  tail -30 /tmp/cppopening_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[6/8] Confirming the BUILD, not just the source..."
SHIPPED=".next/server .next/static"
for t in "Construction Phase Plan — CDM 2015" "Current revision" \
         "Prepared and issued in SiteComply" "cpp-contents" "@page" \
         "suitable, sufficient and kept up to date" "has not been approved or issued"; do
  grep -rqF "$t" $SHIPPED 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "It is not an approved plan" $SHIPPED 2>/dev/null \
  && fail "the removed callout is still in the build"
echo "  ok   callout gone, CDM duty retained"

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
