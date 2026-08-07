#!/usr/bin/env bash
#
# WORKSPACE REFACTOR — ROLLBACK to the pre-refactor production state
# (tag `pre-workspace-refactor` -> 1bc0fd2).
#
# WHY THIS IS ITS OWN SCRIPT rather than re-running workspace_deploy.sh:
# every scXXX/workspace deploy script builds and zips the CURRENT WORKING TREE.
# Running one from a post-refactor checkout would package the very files you are
# trying to remove — the "rollback" would ship the refactor. So this script never
# builds in place. It checks the tag out into a SEPARATE git worktree and builds
# there, so what gets deployed is exactly the tagged source and nothing else.
#
# The workspace refactor introduces NO database migration, by design — it touches
# only app/ and components/. That is what makes this a COMPLETE restore: there is
# no data state to reverse, so putting the tagged code back puts the platform
# back. Asserted in [6/8], not assumed.
#
# Usage:
#   scripts/workspace_rollback.sh --drill     # build + verify only. Touches NOTHING in Azure.
#   scripts/workspace_rollback.sh --confirm   # really roll production back
#
# --drill proves the rollback path executes before anyone needs it. A rollback
# nobody has run is a hope, not a plan.
#
# TIMING: the App Service plan is Linux B1 — no deployment slots, so a rollback
# is a redeploy: roughly 10–12 minutes end to end. Run it backgrounded and poll
# the log; a foreground run can exceed a command timeout and be killed mid-cutover.
#
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

REPO=/home/cc-dev-1/sitecomply
TAG=pre-workspace-refactor
# A dedicated worktree path: $HOME/.sitecomply-rollback-wt belongs to the REV-1
# rollback and must not be clobbered by this one.
WT="${ROLLBACK_WT:-$HOME/.sitecomply-workspace-rollback-wt}"

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/workspace_rollback.zip

# The release candidate this rolls BACK FROM, and the prod build that was live
# when the tag was cut. Recorded to PROVE a cutover happened: prod's build id
# must move OFF the refactor build. It will NOT return to PRETAG_BUILD —
# `npm run build` mints a random BUILD_ID every run, so byte-identity is neither
# the test nor claimed.
RC_COMMIT=c47adbb
PRETAG_BUILD=L4iJu6KJDkE-OGaqcoW-0

MODE="${1:-}"
case "$MODE" in
  --drill|--confirm) ;;
  *) echo "Usage: $0 --drill | --confirm"; exit 64 ;;
esac

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== WORKSPACE REFACTOR ROLLBACK (${MODE#--}) =="
cd "$REPO" || { echo "ERROR: repo not found at $REPO"; exit 1; }

echo "[1/8] Verifying the rollback tag exists and points where it should..."
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null \
  || { echo "ERROR: tag ${TAG} does not exist — there is NO rollback point. Aborting."; exit 1; }
TAG_COMMIT=$(git rev-list -n1 "$TAG")
echo "      ${TAG} -> ${TAG_COMMIT}"
git ls-remote --tags origin 2>/dev/null | grep -q "refs/tags/${TAG}\$" \
  && echo "      confirmed: tag is present on origin (survives loss of this machine)." \
  || echo "      WARNING: tag not found on origin — push it: git push origin ${TAG}"

echo "[2/8] Preparing a clean worktree at ${TAG}..."
if [ -d "$WT" ]; then
  git worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
fi
git worktree add --detach "$WT" "$TAG" >/dev/null 2>&1 \
  || { echo "ERROR: could not create worktree at $WT"; exit 1; }
cd "$WT" || exit 1
DIRTY=$(git status --porcelain | head -5)
[ -z "$DIRTY" ] || { echo "ERROR: fresh worktree is not clean:"; echo "$DIRTY"; exit 1; }
[ "$(git rev-parse HEAD)" = "$TAG_COMMIT" ] \
  || { echo "ERROR: worktree HEAD is not the tag commit"; exit 1; }
echo "      clean worktree at ${TAG_COMMIT} -> ${WT}"

echo "[3/8] Installing dependencies in the worktree..."
# npm ci rather than hard-linking the main repo's node_modules: `prisma generate`
# writes into node_modules/.prisma, and a shared copy would let an emergency
# rollback mutate the tree you are rolling back FROM.
npm ci >/dev/null 2>&1 || { echo "ERROR: npm ci failed in the worktree"; exit 1; }
echo "      dependencies installed."

echo "[4/8] Generating Prisma client + building the pre-refactor baseline..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
rm -rf .next
npm run build 2>&1 | tail -5
[ -f .next/BUILD_ID ] || { echo "ERROR: baseline build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID)
echo "      baseline build OK -> BUILD_ID=${NEW_BUILD}"

echo "[5/8] Sanity-checking the built baseline — the REFACTOR must be ABSENT..."
# A rollback that still contains the refactor is not a rollback. Asserted on
# source with comments stripped: these files explain themselves at length and
# name the very things being checked, so a plain grep matches the prose and
# passes while the code is still there.
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const fail=(m)=>{console.error('ERROR: '+m);process.exit(1);};

const al=strip('app/platform/dashboard/actions/page.tsx');
const pl=strip('app/platform/dashboard/permits/page.tsx');
const pd=strip('app/platform/dashboard/permits/[id]/page.tsx');
const rv=strip('components/platform/PermitReviewControls.tsx');

// The refactor's fingerprints must all be gone.
if(/<SegmentedNav/.test(pl))
  fail('the permits register still has the segmented status strip — this is NOT the pre-refactor tree');
if(/PRIORITY_DOT/.test(al))
  fail('the actions register still has the priority dot — this is NOT the pre-refactor tree');
if(/<Panel title=\"Review\"/.test(rv))
  fail('PermitReviewControls still uses Panel — this is NOT the pre-refactor tree');
// Pre-refactor, the decision sits in the MAIN column, above Summary.
const rev=pd.indexOf('<PermitReviewControls'), sum=pd.indexOf('<Panel title=\"Summary\">');
if(rev<0) fail('permit review controls are missing entirely from the baseline');
if(sum>=0 && sum<rev)
  fail('the permit decision is still in the rail — this is NOT the pre-refactor tree');

// And the platform it is being restored to must still be intact.
console.log('      confirmed: refactor absent from the baseline tree.');
" || exit 1
# REV-1 load-bearing code must still be present — a baseline missing it would be
# worse than no rollback.
[ -f services/projectClosure/closureService.ts ] \
  && [ -f services/closeOut/closeOutArchive.ts ] \
  && [ -f components/platform/AuditScoringConfig.tsx ] \
  && grep -q 'completed-project-read-only' lib/prisma.ts \
  || { echo "ERROR: baseline tree is missing REV-1 code — aborting"; exit 1; }
echo "      confirmed: SC-025 read-only guard, SC-024 archive and SC-014 scoring present."

echo "[6/8] Proving there is no data state to reverse..."
# THE CLAIM THAT MAKES THIS A COMPLETE RESTORE, checked rather than asserted.
cd "$REPO"
MIGR=$(git diff --name-only "${TAG_COMMIT}".."${RC_COMMIT}" -- prisma/ | wc -l)
SVC=$(git diff --name-only "${TAG_COMMIT}".."${RC_COMMIT}" -- services/ lib/ | wc -l)
ROOTS=$(git diff --name-only "${TAG_COMMIT}".."${RC_COMMIT}" | sed 's|/.*||' | sort -u | tr '\n' ' ')
cd "$WT"
if [ "$MIGR" -ne 0 ] || [ "$SVC" -ne 0 ]; then
  echo "ERROR: the release being rolled back is NOT presentation-only."
  echo "       prisma/ files changed: ${MIGR}, services+lib files changed: ${SVC}"
  echo "       A code-only rollback is NOT sufficient — stop and assess data impact."
  exit 1
fi
echo "      confirmed: 0 migrations, 0 service/lib changes; changed roots: ${ROOTS}"
echo "      => rollback is code-only. No migration, seed, backfill or data repair."

if [ "$MODE" = "--drill" ]; then
  echo
  echo "== DRILL COMPLETE — NOTHING WAS DEPLOYED =="
  echo "   tag             : ${TAG} -> ${TAG_COMMIT}"
  echo "   rolls back from : ${RC_COMMIT}"
  echo "   worktree        : ${WT}"
  echo "   baseline built  : ${NEW_BUILD}"
  echo "   prod at tagging : ${PRETAG_BUILD}"
  echo
  echo "   The rollback path is executable. To really roll back:"
  echo "     scripts/workspace_rollback.sh --confirm"
  exit 0
fi

echo "[7/8] Packaging and deploying the baseline..."
OLD_BUILD=$(kudu_buildid); echo "      prod build BEFORE rollback: ${OLD_BUILD:-<unknown>}"
rm -f "$ZIP"
# Identical packaging to every successful deploy — same exclusions.
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[8/8] Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
LANDED=""
for i in $(seq 1 40); do
  sleep 15
  CURB=$(kudu_buildid)
  echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  if [ "$CURB" = "$NEW_BUILD" ]; then LANDED=yes; break; fi
done
if [ -z "$LANDED" ]; then
  echo "WARNING: baseline build id not confirmed on disk. NOT cutting over."
  echo "         Production is still serving ${OLD_BUILD:-<unknown>} and is unharmed."
  exit 2
fi

echo "      cutting over (stop/start)..."
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 20); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done

echo "      route smoke test (3xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in /platform/dashboard/actions /platform/dashboard/permits /platform/dashboard/audits ; do
  RC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${RC}"
  # 000* not 000: curl prints "000" via -w AND the `|| echo 000` fires, so an
  # unreachable route reports "000000" — which never matched the bare "000"
  # pattern. SC-031 printed "routes: all reachable" while every route was
  # unreachable. A smoke test that cannot fail is not a smoke test.
  case "$RC" in 5*|000*) SMOKE_FAIL=yes ;; esac
done

echo
echo "== ROLLBACK SUMMARY =="
echo "   rolled back FROM build: ${OLD_BUILD:-<unknown>}  (refactor ${RC_COMMIT})"
echo "   now serving build     : ${NEW_BUILD}  (rebuilt from ${TAG} -> ${TAG_COMMIT})"
echo "   health                : HTTP ${CODE}"
echo "   routes                : ${SMOKE_FAIL:+ONE OR MORE FAILED}${SMOKE_FAIL:-all reachable}"
echo "   database              : untouched — no migration, seed or backfill was run"
echo
echo "   Verify the cutover:"
echo "     curl -s ${BASE}/ | grep -c '${NEW_BUILD}'   # expect >=1"
echo "     curl -s ${BASE}/ | grep -c '${OLD_BUILD}'   # expect 0"
echo "   Then run the walkthrough in docs/WORKSPACE-REFACTOR-ROLLBACK.md"
if [ "$CODE" = "200" ] && [ -z "$SMOKE_FAIL" ]; then
  echo "== ROLLBACK COMPLETE =="
else
  echo "== HEALTH NOT 200 — investigate =="
fi
