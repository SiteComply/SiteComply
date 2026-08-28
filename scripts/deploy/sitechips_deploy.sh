#!/usr/bin/env bash
# Deploy: compact, always-visible site chips in the shared report filter bar.
# One shared component -> all 10 report screens. Filtering, permissions and the
# GET submission must be unchanged.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sitechips_deploy.zip
CHIP=components/platform/SiteChipMultiSelect.tsx
BAR=components/platform/ReportView.tsx

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== REPORT SITE CHIPS DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards (comments stripped before matching)..."
# Strips // line comments AND multi-line /* … */ and {/* … */} blocks.
#
# The earlier shell version only dropped lines that START with // or *, so a
# WRAPPED JSX comment line beginning with prose survived — and this very script
# aborted on its own explanatory comment mentioning "<details>". That is the
# third deploy guard in this repository to false-positive on a comment, so it is
# now done properly rather than with another regex.
code() {
  python3 - "$1" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)   # {/* jsx */}
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)             # /* block */
s = re.sub(r'(?m)^\s*//.*$', '', s)                     # // line
sys.stdout.write(s)
PY
}

# The collapse must be gone from the report filter bar. Matched on the CLOSING
# tag: prose can mention "<details>", but "</details>" only ever appears when
# the element is genuinely rendered.
if code "$BAR" | grep -q '</details>'; then
  echo "ERROR: <details> is back in the report filter bar — aborting"; exit 1
fi
code "$BAR" | grep -q 'SiteChipMultiSelect' \
  && echo "      confirmed: filter bar renders the chip selector, no <details>." \
  || { echo "ERROR: chip selector not wired into the filter bar — aborting"; exit 1; }

# Submission contract: still a real checkbox named "sites".
code "$CHIP" | grep -q 'type="checkbox"' \
  && code "$CHIP" | grep -q 'name="sites"' \
  && code "$CHIP" | grep -q 'defaultChecked' \
  && echo "      confirmed: real checkboxes, name=\"sites\", uncontrolled." \
  || { echo "ERROR: submission contract changed — aborting"; exit 1; }

# Uncontrolled is what keeps it working without JS. A `checked=` prop would
# break that silently, so fail on it.
if code "$CHIP" | grep -qE '[^t]checked=\{'; then
  echo "ERROR: inputs look controlled (checked={...}) — that breaks the no-JS path. Aborting"; exit 1
fi
echo "      confirmed: inputs are uncontrolled."

# Accessibility contract.
for t in '<fieldset' '<legend' 'aria-live' 'sr-only' 'peer-focus-visible'; do
  code "$CHIP" | grep -qF "$t" || { echo "ERROR: accessibility marker '$t' missing — aborting"; exit 1; }
done
code "$CHIP" | grep -q 'type="button"' \
  || { echo "ERROR: All/None are not type=button — they would submit the form. Aborting"; exit 1; }
echo "      confirmed: fieldset/legend, aria-live, sr-only, focus ring, type=button."

# Compact sizing — the approved geometry, and the heavy one must not return.
code "$CHIP" | grep -q 'px-2.5 py-1' && code "$CHIP" | grep -q 'rounded-md' \
  && code "$CHIP" | grep -q 'text-xs' \
  && echo "      confirmed: compact geometry (px-2.5 py-1, rounded-md, text-xs)." \
  || { echo "ERROR: compact geometry missing — aborting"; exit 1; }
if code "$CHIP" | grep -qE 'min-h-\[44px\]|rounded-full|text-sm|px-3\.5'; then
  echo "ERROR: the heavy chip geometry is back — aborting"; exit 1
fi
echo "      confirmed: no heavy geometry."

# The +/tick glyph must be a ::before on the sibling, not a nested span —
# peer-checked: is a general-sibling selector and cannot reach a descendant.
code "$CHIP" | grep -q "peer-checked:before:content-\['✓'\]" \
  && echo "      confirmed: glyph is a ::before on the peer's sibling." \
  || { echo "ERROR: glyph is not sibling-scoped — it would never toggle. Aborting"; exit 1; }

# Nothing outside the shared component may render its own site input.
STRAY=$(grep -rl 'name="sites"' app/ components/ 2>/dev/null | grep -v "$CHIP" | grep -v "$BAR" || true)
[ -z "$STRAY" ] \
  && echo "      confirmed: the shared component is the only site input." \
  || { echo "ERROR: report-specific site input found in: $STRAY — aborting"; exit 1; }

# Report data/permissions must be untouched.
for f in services/reports/reportFilters.ts services/platformUsers/platformPermissions.ts; do
  git diff --quiet HEAD~1 HEAD -- "$f" || { echo "ERROR: $f changed — aborting"; exit 1; }
done
echo "      confirmed: report filters and permissions unchanged."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
CSS=$(find .next/static/css -name '*.css' | head -1)
[ -n "$CSS" ] || { echo "ERROR: no stylesheet built — aborting"; exit 1; }
# Matched against the utility rules Tailwind actually emits. An earlier version
# of this guard asserted a `padding:.25rem .625rem` shorthand, which Tailwind
# never generates — it emits separate px-/py- rules — so it aborted a correct
# build. Written from the compiled output rather than from the intended values.
grep -qF '.rounded-md{border-radius:.375rem}' "$CSS" \
  && grep -qF '.px-2\.5{padding-left:.625rem;padding-right:.625rem}' "$CSS" \
  && grep -qF '.py-1{padding-top:.25rem;padding-bottom:.25rem}' "$CSS" \
  && echo "      confirmed: compact geometry compiled into the CSS." \
  || { echo "ERROR: compact geometry not in the stylesheet — aborting"; exit 1; }
grep -q 'min-height:44px' "$CSS" \
  && { echo "ERROR: 44px chip height compiled in — aborting"; exit 1; } \
  || echo "      confirmed: 44px height absent."
grep -qF '.peer:checked~' "$CSS" \
  && echo "      confirmed: peer-checked sibling rules compiled." \
  || { echo "ERROR: peer-checked rules missing — chips would not toggle. Aborting"; exit 1; }

# Every report route must have compiled.
MISSING=""
for r in attendance compliance-activities compliance cscs knowledge-checks \
         occupancy org-overview permits scorecard workforce; do
  [ -f ".next/server/app/platform/dashboard/reports/$r/page.js" ] || MISSING="$MISSING $r"
done
[ -z "$MISSING" ] \
  && echo "      confirmed: all 10 report routes compiled." \
  || { echo "ERROR: report routes missing:$MISSING — aborting"; exit 1; }

echo "[5/8] Packaging zip..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Deploying to App Service..."
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/8] Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
LANDED=""
for i in $(seq 1 40); do
  sleep 15
  CURB=$(kudu_buildid)
  echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  if [ "$CURB" = "$NEW_BUILD" ]; then LANDED=yes; break; fi
done
[ -n "$LANDED" ] || { echo "WARNING: new build id not confirmed. NOT cutting over."; exit 2; }
echo "      new build landed on disk."

echo "[8/8] Cutting over and health-checking..."
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 20); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== SITE CHIPS DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
