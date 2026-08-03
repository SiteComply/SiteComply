#!/usr/bin/env bash
#
# Platform UX Refresh — ROLLBACK to the REV-1 baseline (tag `rev1-complete`).
#
# WHY THIS SCRIPT EXISTS AS ITS OWN THING, rather than re-running a scXXX
# deploy script: every scXXX_deploy.sh builds and zips the CURRENT WORKING TREE.
# Running one from a UX-refresh checkout would package the very files you are
# trying to remove — the "rollback" would ship the refresh. So this script never
# builds in place. It checks the tag out into a SEPARATE git worktree and builds
# there, so what gets deployed is exactly the tagged source and nothing else.
#
# The UX Refresh introduces NO database migration, by design. That is what makes
# this a complete restore: there is no data state to reverse, so putting the
# tagged code back puts the platform back.
#
# Usage:
#   scripts/uxrefresh_rollback.sh --drill     # build + verify only. Touches NOTHING in Azure.
#   scripts/uxrefresh_rollback.sh --confirm   # really roll production back
#
# --drill is the Phase 0 verification: it proves the rollback path executes
# before anyone needs it. A rollback nobody has run is a hope, not a plan.
#
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

REPO=/home/cc-dev-1/sitecomply
TAG=rev1-complete
WT="${ROLLBACK_WT:-$HOME/.sitecomply-rollback-wt}"

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/uxrefresh_rollback.zip

# The production build that was live when the tag was cut. Recorded so a
# rollback can be PROVEN to have cut over: prod's build id must move OFF the
# refresh build. It will NOT return to this value — `npm run build` mints a
# random BUILD_ID every run, so byte-identity is not the test and is not claimed.
BASELINE_BUILD=Oz4SPgNN-L-ZD8yrfQNk7

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

echo "== UX REFRESH ROLLBACK (${MODE#--}) =="
cd "$REPO" || { echo "ERROR: repo not found at $REPO"; exit 1; }

echo "[1/7] Verifying the rollback tag exists and points where it should..."
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null \
  || { echo "ERROR: tag ${TAG} does not exist — there is NO rollback point. Aborting."; exit 1; }
TAG_COMMIT=$(git rev-list -n1 "$TAG")
echo "      ${TAG} -> ${TAG_COMMIT}"
# The tag must also exist on the remote, or the rollback point only exists on
# this machine — which is not a rollback point.
git ls-remote --tags origin 2>/dev/null | grep -q "refs/tags/${TAG}\$" \
  && echo "      confirmed: tag is present on origin (survives loss of this machine)." \
  || echo "      WARNING: tag not found on origin — push it: git push origin ${TAG}"

echo "[2/7] Preparing a clean worktree at ${TAG}..."
# Never reuse a stale worktree: it may carry a half-finished previous attempt.
if [ -d "$WT" ]; then
  git worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
fi
git worktree add --detach "$WT" "$TAG" >/dev/null 2>&1 \
  || { echo "ERROR: could not create worktree at $WT"; exit 1; }
cd "$WT" || exit 1

# The whole point of the worktree is that what we build is EXACTLY the tag.
# Prove it rather than assume it.
DIRTY=$(git status --porcelain | head -5)
[ -z "$DIRTY" ] || { echo "ERROR: fresh worktree is not clean:"; echo "$DIRTY"; exit 1; }
[ "$(git rev-parse HEAD)" = "$TAG_COMMIT" ] \
  || { echo "ERROR: worktree HEAD is not the tag commit"; exit 1; }
echo "      clean worktree at ${TAG_COMMIT} -> ${WT}"

echo "[3/7] Installing dependencies in the worktree..."
# node_modules is gitignored, so a fresh worktree has none. `npm ci` is used
# rather than hard-linking the main repo's copy: `prisma generate` writes into
# node_modules/.prisma, and a hard-linked copy would mutate the working repo's
# modules from inside a rollback. An emergency path must not have side effects
# on the tree you are rolling back FROM.
npm ci >/dev/null 2>&1 || { echo "ERROR: npm ci failed in the worktree"; exit 1; }
echo "      dependencies installed."

echo "[4/7] Generating Prisma client + building the baseline..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
rm -rf .next
npm run build 2>&1 | tail -5
[ -f .next/BUILD_ID ] || { echo "ERROR: baseline build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID)
echo "      baseline build OK -> BUILD_ID=${NEW_BUILD}"

echo "[5/7] Sanity-checking the built baseline..."
# A rollback that ships a tree missing REV-1 code would be worse than no
# rollback. Spot-check load-bearing REV-1 artifacts from the final phases.
[ -f services/projectClosure/closureService.ts ] \
  && [ -f services/closeOut/closeOutArchive.ts ] \
  && [ -f components/platform/AuditScoringConfig.tsx ] \
  && grep -q 'completed-project-read-only' lib/prisma.ts \
  && echo "      confirmed: SC-025 read-only guard, SC-024 archive and SC-014 scoring all present." \
  || { echo "ERROR: baseline tree is missing REV-1 code — aborting"; exit 1; }

if [ "$MODE" = "--drill" ]; then
  echo
  echo "== DRILL COMPLETE — NOTHING WAS DEPLOYED =="
  echo "   tag           : ${TAG} -> ${TAG_COMMIT}"
  echo "   worktree      : ${WT}"
  echo "   baseline built: ${NEW_BUILD}"
  echo "   prod at tagging: ${BASELINE_BUILD}"
  echo
  echo "   The rollback path is executable. To really roll back:"
  echo "     scripts/uxrefresh_rollback.sh --confirm"
  exit 0
fi

echo "[6/7] Packaging and deploying the baseline..."
OLD_BUILD=$(kudu_buildid); echo "      prod build BEFORE rollback: ${OLD_BUILD:-<unknown>}"
rm -f "$ZIP"
# Identical packaging to every successful REV-1 deploy — same exclusions.
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/7] Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
LANDED=""
for i in $(seq 1 40); do
  sleep 15
  CURB=$(kudu_buildid)
  echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  if [ "$CURB" = "$NEW_BUILD" ]; then LANDED=yes; break; fi
done
if [ -z "$LANDED" ]; then
  echo "WARNING: baseline build id not confirmed on disk. NOT cutting over."
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

echo
echo "== ROLLBACK SUMMARY =="
echo "   rolled back FROM build: ${OLD_BUILD:-<unknown>}"
echo "   now serving build     : ${NEW_BUILD}  (rebuilt from ${TAG})"
echo "   health                : HTTP ${CODE}"
echo
echo "   Verify the cutover:"
echo "     curl -s https://${APP}.azurewebsites.net/ | grep -c '${NEW_BUILD}'   # expect >=1"
echo "     curl -s https://${APP}.azurewebsites.net/ | grep -c '${OLD_BUILD}'   # expect 0"
[ "$CODE" = "200" ] && echo "== ROLLBACK COMPLETE ==" || echo "== HEALTH NOT 200 — investigate =="
