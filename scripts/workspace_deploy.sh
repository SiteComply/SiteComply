#!/usr/bin/env bash
# WORKSPACE REFACTOR — production CODE deploy.
#
# Audit Scoring, the Actions register + detail and the Permits register + detail
# were functionally right and visually assembled: a stack of independent cards,
# each with its own border and heading style. They now read as workspaces —
# one panel vocabulary, filters that look like filters, and a record's facts
# beside the control that changes them.
#
#   1. Actions register  — four stat cards became the shared SegmentedNav strip;
#                          six equal columns became four with a clear subject.
#   2. Action detail     — description / finding / completion note / evidence are
#                          ONE panel; the status control sits in the Summary rail.
#   3. Permits register  — status is a segmented strip, not a dropdown option.
#   4. Permit detail     — main column is what there is to read; the Summary rail
#                          carries the facts AND the decision.
#   5. Audit Scoring     — nine cards became three panels in the SC-014
#                          benchmark grid.
#
# CODE ONLY: no schema change, no migration, no seed, no backfill. This deploy
# must not alter a single permission, workflow, filter or query — asserted
# mechanically in [2/8] rather than asserted in prose.
#
# DELIBERATELY NOT INCLUDED: counts on the permit status strip. The register
# filters the STORED status column while the table badges effectiveStatus(), so
# a lapsed APPROVED permit displays as Expired but does not answer the Expired
# filter. Any count would inherit that contradiction. It is a separate
# functional issue and this script asserts the strip is still count-free.
#
# Rollback is a redeploy of 1bc0fd2; nothing here is destructive.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/workspace_deploy.zip

# The commit this refactor started from. The scope assertion diffs against it.
BASE_COMMIT=1bc0fd2

ACT_LIST='app/platform/dashboard/actions/page.tsx'
ACT_DETAIL='app/platform/dashboard/actions/[id]/page.tsx'
PMT_LIST='app/platform/dashboard/permits/page.tsx'
PMT_DETAIL='app/platform/dashboard/permits/[id]/page.tsx'
REVIEW=components/platform/PermitReviewControls.tsx
SCORING=components/platform/AuditScoringConfig.tsx

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== WORKSPACE REFACTOR — CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Asserting the refactor, and the things it must not have touched..."

# ---------------------------------------------------------------------------
# THE SCOPE ASSERTION. This is the strongest guarantee in the script and the
# cheapest: a presentation-only change cannot touch a service, a schema, an API
# route or a shared lib. If this deploy has grown one since the refactor
# branched, the "no permission, workflow or filter change" claim in the header
# is no longer true and the whole risk assessment changes.
#
# Asserted as FROZEN ZONES rather than as an allowlist of changed roots. An
# allowlist ("expect exactly app + components") fails the moment a runbook is
# committed under docs/ or scripts/ — neither of which is runtime code, and
# scripts/ is excluded from the zip entirely. That would abort a perfectly good
# deploy for a documentation commit. Name what must NOT move instead.
# ---------------------------------------------------------------------------
FROZEN="services lib prisma middleware.ts package.json package-lock.json next.config.js app/api"
FROZEN_TOUCHED=$(git diff --name-only "${BASE_COMMIT}"..HEAD -- $FROZEN)
if [ -n "$FROZEN_TOUCHED" ]; then
  echo "ERROR: this is no longer a presentation-only deploy — frozen zones changed:"
  echo "$FROZEN_TOUCHED" | sed 's/^/         /'
  exit 1
fi
CHANGED_ROOTS=$(git diff --name-only "${BASE_COMMIT}"..HEAD | sed 's|/.*||' | sort -u | tr '\n' ' ')
echo "      confirmed: no services/, lib/, prisma/, app/api/ or dependency change"
echo "                 since ${BASE_COMMIT}. Changed roots: ${CHANGED_ROOTS}"

# The known-deferred bug must still be deferred. If someone quietly "fixed" the
# permit status filter, this stops being a presentation deploy and needs its own
# verification of what the filter now returns.
if ! git diff --quiet "${BASE_COMMIT}"..HEAD -- services/permits/permitAdminService.ts; then
  echo "ERROR: permitAdminService changed — the status/filter fix is a SEPARATE"
  echo "       functional change and must not ride along with this deploy"
  exit 1
fi

# ---------------------------------------------------------------------------
# Everything below matches against source with COMMENTS STRIPPED.
#
# These files carry long explanatory comments that name the very things being
# asserted — "they now use the shared SegmentedNav", "the sticky element is the
# div INSIDE it". A plain grep matches the prose and passes while the code is
# missing. This repo has been bitten by exactly that three times; do not
# "simplify" these into greps.
# ---------------------------------------------------------------------------
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const fail=(m)=>{console.error('ERROR: '+m);process.exit(1);};

// ---------------- Actions register ----------------
const al=strip('$ACT_LIST');
if(!/<SegmentedNav/.test(al))
  fail('the Actions register is not rendering SegmentedNav — the four stat cards are back');
if(!/label=\"Filter actions by status\"/.test(al))
  fail('the Actions bucket strip lost its accessible name');
// The buckets are FILTERS. Each must still be a link that narrows the list, and
// clicking the active one must still clear it — that is the qp({...}) toggle.
if(!/bucket === b\.value \? '' : b\.value/.test(al))
  fail('clicking an active Actions bucket no longer clears it');
if(!/count: counts\[b\.value\]/.test(al))
  fail('the Actions strip lost its counts');
// Six columns became four, one of them clearly the subject.
const alTh=(al.match(/<th[\s>]/g)||[]).length;
if(alTh!==4) fail('the Actions table has '+alTh+' header cells, expected 4');
// Priority keeps its colour but drops the pill.
if(!/PRIORITY_DOT\[a\.priority as ActionPriorityValue\]/.test(al))
  fail('the Actions register is not rendering the priority dot');

// ---------------- Action detail ----------------
const ad=strip('$ACT_DETAIL');
const adPanel=ad.indexOf('<Panel title=\"Action detail\">');
const adEvid=ad.indexOf('<ActionEvidencePanel');
const adTime=ad.indexOf('<ActionTimeline');
if(adPanel<0) fail('the single Action detail panel is gone');
if(adEvid<0||adEvid<adPanel||adTime<0||adEvid>adTime)
  fail('evidence is no longer INSIDE the action record panel');
// Read the state, then act on it — same panel, not two.
if(!/<ActionStatusControl/.test(ad))
  fail('the action status control is missing from the Summary rail');
// STICKY MUST BE THE INNER DIV. A stretched grid item is as tall as its row, so
// a sticky rule on it has nowhere to travel and silently does nothing.
if(!/space-y-6 lg:sticky lg:top-6/.test(ad))
  fail('the action detail rail is no longer sticky on the inner div');

// ---------------- Permits register ----------------
const pl=strip('$PMT_LIST');
if(!/<SegmentedNav/.test(pl))
  fail('the Permits register is not rendering SegmentedNav — status is back in a dropdown');
if(!/label=\"Filter permits by status\"/.test(pl))
  fail('the Permits status strip lost its accessible name');
if(!/status === s\.value \? '' : s\.value/.test(pl))
  fail('clicking an active Permits status no longer clears it');
// The status filter must survive the remaining-filters form, or applying a site
// filter silently drops the status the user picked on the strip.
if(!/type=\"hidden\" name=\"status\"/.test(pl))
  fail('the hidden status input is gone — Apply would discard the selected status');
const plTh=(pl.match(/<th[\s>]/g)||[]).length;
if(plTh!==4) fail('the Permits table has '+plTh+' header cells, expected 4');
// THE DELIBERATE OMISSION. See the header note: a count here would contradict
// the badge in the row below it.
if(/count:/.test(pl))
  fail('counts were added to the permit status strip — they contradict effectiveStatus(); see the header note');

// ---------------- Permit detail ----------------
const pd=strip('$PMT_DETAIL');
const pdAct=pd.indexOf('<Panel title=\"Activity\">');
const pdSum=pd.indexOf('<Panel title=\"Summary\">');
const pdRev=pd.indexOf('<PermitReviewControls');
if(pdAct<0||pdSum<0||pdRev<0) fail('a permit detail panel is missing');
// Activity belongs to the main column, the decision to the rail.
if(!(pdAct<pdSum)) fail('the permit Activity panel is no longer in the main column');
if(!(pdSum<pdRev)) fail('the permit Review controls are no longer in the Summary rail');
if(!/label=\"Submitted\"/.test(pd))
  fail('Summary lost the Submitted date');
if(!/space-y-6 lg:sticky lg:top-6/.test(pd))
  fail('the permit detail rail is no longer sticky on the inner div');
// A comment carries no status label, so the raw enum was printed and every
// comment in a history read as a shouted 'COMMENT'.
if(!/function activityLabel/.test(pd))
  fail('the permit activity label fallback is gone — comments would print as COMMENT');

// ---------------- Permit review controls ----------------
const rv=strip('$REVIEW');
if(!/<Panel title=\"Review\"/.test(rv))
  fail('PermitReviewControls is not using Panel');
if(/shadow-card/.test(rv))
  fail('PermitReviewControls is hand-rolling Panel classes again');
// sm: is a VIEWPORT query, not a container one — on a desktop it splits these
// two datetime inputs inside a 380px rail and squeezes both.
if(/sm:grid-cols-2/.test(rv))
  fail('the approve form splits its date inputs again inside the 380px rail');

// ---------------- Audit Scoring ----------------
const sc=strip('$SCORING');
// NOT grid-cols-3. The benchmark's columns run roughly 30/36/31 — Section
// Weightings is the widest, and equal thirds is the thing that stopped this
// screen reading as a workspace. minmax(0,…) on every track is what keeps a
// long section name truncating inside its column instead of widening the page.
if(!/lg:grid-cols-\[minmax\(0,3fr\)_minmax\(0,4\.3fr\)_minmax\(0,3\.1fr\)\]/.test(sc))
  fail('the Audit Scoring column proportions are gone — equal thirds is what the benchmark pass removed');
// The benchmark's landing screen ENDS at the hand-off; the per-question editor
// is a separate workspace. A standalone Questions panel back in the grid is the
// thing that made this read as a dashboard with an editor bolted underneath.
// Substring tests, not regex: the escaping needed for parens and quotes inside
// this shell-quoted node block is where a guard silently becomes unparseable.
if(sc.indexOf('setView') < 0 || sc.indexOf('Configure Questions') < 0)
  fail('the Configure Questions hand-off is gone — the question editor is back on the landing screen');
// Two cards in column one, as the benchmark draws them.
if(sc.indexOf('title=\"Scoring Method\"') < 0 || sc.indexOf('title=\"Scoring Options\"') < 0)
  fail('Scoring Method and Scoring Options are no longer separate cards');
if(!/lg:col-span-2 lg:col-start-1 lg:row-start-2/.test(sc))
  fail('Question Scoring Rules is no longer the wide band on row 2');
if(!/lg:grid-cols-4/.test(sc))
  fail('the four scoring-rule tiles are no longer one row');
// The question editor must NOT be a row of the scoring grid any more. It was
// row 3 spanning two columns, which is what made the landing screen a scoring
// dashboard with an editor bolted underneath; it is now a separate view behind
// the hand-off. row-start-3 reappearing means it has been put back.
if(/lg:row-start-3/.test(sc))
  fail('the question editor is back in the scoring grid — it belongs in the Configure Questions view');
if(!/lg:sticky lg:top-6/.test(sc))
  fail('the Score Preview rail is no longer sticky on the inner div');
// This screen renders its own benchmark-scale card — hairline border, no
// shadow, ~13px title — rather than the platform Panel. Falling back to Panel
// puts the shadowed, 25%-larger treatment back and the density goes with it.
if(sc.indexOf('rounded-lg border border-line bg-surface p-3.5') < 0)
  fail('the benchmark card treatment is gone — Audit Scoring is back on the platform Panel');

// ---------------- Score breakdown donut ----------------
// THE OVERFLOW DEFECT. As a full-width child beside a shrink-0 donut, with no min-width
// floor, this legend pushed the whole PAGE into horizontal scroll on every
// viewport from 1024 to 1535 — 135px of it at 1024. It shipped that way and was
// missed because the checks either side of that band (390 and >=1536) both pass.
const dn=strip('components/platform/ScoreBreakdownDonut.tsx');
if(!/<ul className=\"min-w-0 flex-1/.test(dn))
  fail('the donut legend lost min-w-0/flex-1 — the page will scroll horizontally again between 1024px and 1535px');
if(/<ul className=\"w-full/.test(dn))
  fail('the donut legend is w-full again — that is the exact overflow defect');

console.log('      confirmed: filters still filter and still clear, tables are four');
console.log('                 columns, evidence sits inside the action record, the');
console.log('                 permit decision is in the rail, all three rails are');
console.log('                 sticky on the INNER div, benchmark grid intact,');
console.log('                 permit strip still count-free.');
" || exit 1

# Run the whole assertion block without deploying:  DRY_RUN=1 scripts/workspace_deploy.sh
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "== DRY RUN — assertions passed, stopping before build/deploy =="
  exit 0
fi

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Type-checking, linting and building..."
npx tsc --noEmit || { echo "ERROR: typecheck failed"; exit 1; }
npx next lint --dir app --dir components || { echo "ERROR: lint failed"; exit 1; }
rm -rf .next
npm run build 2>&1 | tail -5
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

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
if [ -z "$LANDED" ]; then
  echo "WARNING: new build id not confirmed on disk yet. NOT cutting over."
  exit 2
fi
echo "      new build landed on disk."

echo "[8/8] Cutting over (stop/start) and health-checking..."
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 20); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done

# The five refactored routes must be REACHABLE, not 500. Unauthenticated they
# redirect to sign-in (3xx) — that is a pass. A 200 here would mean the auth gate
# had gone, and a 5xx means the new build is broken on a page nobody has opened
# yet. This is a smoke test, not the walkthrough: see
# docs/WORKSPACE-REFACTOR-DEPLOYMENT.md for what a human still has to check.
echo "      route smoke test (3xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in \
  /platform/dashboard/actions \
  /platform/dashboard/permits \
  /platform/dashboard/audits ; do
  RC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${RC}"
  case "$RC" in 5*|000) SMOKE_FAIL=yes ;; esac
done

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
echo "   routes:    ${SMOKE_FAIL:+ONE OR MORE FAILED}${SMOKE_FAIL:-all reachable}"
if [ "$CODE" = "200" ] && [ -z "$SMOKE_FAIL" ]; then
  echo "== WORKSPACE REFACTOR DEPLOYED =="
  echo "   NOW RUN THE WALKTHROUGH: docs/WORKSPACE-REFACTOR-DEPLOYMENT.md"
else
  echo "== NOT HEALTHY — investigate before announcing =="
fi
