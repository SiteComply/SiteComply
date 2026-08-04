#!/usr/bin/env bash
# SC-002 fix — production CODE deploy.
#
# "I've read this" recorded the acknowledgement and removed the card, but every
# other thing on the page describing that bulletin is server-rendered, so the
# "Already read" list and the unread badge stayed stale until a manual reload.
# The fix refreshes the server state after a successful acknowledgement.
#
# CODE ONLY: no migration, no schema change, no seed. Nothing in this deploy
# touches the acknowledgement endpoint, its session check, or the read record.
# Rollback is therefore a redeploy of the previous commit — see [2] for the
# invariants this asserts before it will ship anything.
#
# Same proven flow as scXXX_deploy.sh.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sc002fix_deploy.zip
BOARD=components/checkin/BulletinBoard.tsx
ACK='app/api/worker/bulletins/[id]/ack/route.ts'

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-002 BULLETIN ACK FIX — CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Confirming the fix is present AND that nothing else moved..."
# EVERY CHECK BELOW RUNS ON THE CODE WITH COMMENTS STRIPPED. The block comment
# above the component explains the fix and therefore contains the very tokens
# worth asserting on — a plain grep finds the prose, not the code, and passes for
# the wrong reason. That exact self-poisoning has bitten this repo twice before,
# and it did so again while this script was being written: deleting the
# router.refresh() CALL still left a passing grep, because the comment mentions
# it. Strip first, then assert.
node -e "
const raw=require('fs').readFileSync('$BOARD','utf8');
const s=raw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const need=[
  ['useRouter','BulletinBoard is not wired to the router'],
  ['router.refresh()','the acknowledgement no longer refreshes server state'],
  ['onRead();','the optimistic dismissal is gone — the tap would stop feeling instant'],
  ['bulletins.filter((b) => !acknowledged.includes(b.id))','the board is snapshotting props again'],
];
for(const [token,why] of need){
  if(!s.includes(token)){console.error('ERROR: '+why+' — aborting');process.exit(1);}
}
// A FAILED acknowledgement must leave the card alone: both calls have to sit
// after the error branch has returned.
const guard=s.indexOf('toast.error(data.error');
const read=s.indexOf('onRead();');
const refresh=s.indexOf('router.refresh()');
if(guard<0){console.error('ERROR: the acknowledge failure branch is gone — aborting');process.exit(1);}
if(!(guard<read&&read<refresh)){console.error('ERROR: dismissal/refresh no longer sit after the failure branch — aborting');process.exit(1);}
" || exit 1

# TRACKING AND PERMISSIONS ARE UNCHANGED. This is the half of the promise a
# screenshot cannot make: the endpoint still authenticates the worker, still
# resolves them from the session, and still writes through the one idempotent
# service call. If any of that moved, this is no longer the change that was
# tested and approved.
grep -q 'getWorkerSession()' "$ACK" \
  && grep -q 'getWorkerByMobile(session.mobile)' "$ACK" \
  && grep -q 'acknowledgeBulletin(params.id, worker.id)' "$ACK" \
  || { echo "ERROR: the acknowledgement endpoint has changed — aborting"; exit 1; }
git diff --quiet "$(git rev-parse HEAD)" -- "$ACK" services/bulletins/ 2>/dev/null \
  || { echo "ERROR: uncommitted changes to the ack route or bulletin service — aborting"; exit 1; }
echo "      confirmed: refresh + optimistic dismissal present, failure path intact,"
echo "                 endpoint / session check / read record untouched."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
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

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== SC-002 FIX DEPLOYED ==" || echo "== HEALTH NOT 200 — investigate =="
