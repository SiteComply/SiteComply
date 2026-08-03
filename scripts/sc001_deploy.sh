#!/usr/bin/env bash
# SC-001 production CODE deploy — builds and ships the SC-001-ONLY artifact
# (commit c5aacb3: SC-001 code + migration, NO SC-002). Prod DB already has the
# SC-001 migration applied. Restores the working branch on exit.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sc001_deploy.zip
DEPLOY_COMMIT=c5aacb3

CUR=$(git rev-parse --abbrev-ref HEAD)
restore() {
  git checkout "$CUR" >/dev/null 2>&1 || true
  npx prisma generate >/dev/null 2>&1 || true
  echo "[cleanup] restored branch '$CUR' and regenerated client."
}
trap restore EXIT

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-001 CODE DEPLOY =="

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Checking out SC-001-only commit ${DEPLOY_COMMIT}..."
git checkout "$DEPLOY_COMMIT" >/dev/null 2>&1 || { echo "ERROR: checkout failed"; exit 1; }
grep -rq "siteBulletin\|SiteBulletin" app services components 2>/dev/null \
  && { echo "ERROR: SC-002 code present in artifact — aborting"; exit 1; } \
  || echo "      confirmed: no SC-002 code in this artifact."

echo "[3/8] Generating Prisma client (SC-001 schema)..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building (this takes a few minutes)..."
rm -rf .next
npm run build 2>&1 | tail -5
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[5/8] Packaging zip (incl. .next + node_modules; excl. .git/.env/cache)..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Deploying to App Service (may report a timeout but continue)..."
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/8] Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
LANDED=""
for i in $(seq 1 40); do   # up to ~10 min (40 x 15s)
  sleep 15
  CURB=$(kudu_buildid)
  echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  if [ "$CURB" = "$NEW_BUILD" ]; then LANDED=yes; break; fi
done
if [ -z "$LANDED" ]; then
  echo "WARNING: new build id not confirmed on disk yet. NOT cutting over."
  echo "         Re-run this script or check the deployment before stop/start."
  exit 2
fi
echo "      new build landed on disk."

echo "[8/8] Cutting over (stop/start) and health-checking..."
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 20); do   # up to ~5 min
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== SC-001 CODE DEPLOY COMPLETE ==" || echo "== HEALTH NOT 200 — investigate =="
