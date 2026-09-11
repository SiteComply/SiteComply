#!/usr/bin/env bash
# Deploy one terminology batch. BASE=<commit before the batch> BATCH=<label>
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/terminology_deploy.zip
BASE="${BASE:?set BASE to the commit before this batch}"
BATCH="${BATCH:-batch}"
die() { echo "ERROR: $1. Aborting"; exit 1; }
kudu_buildid() { local tok v i
  for i in 1 2 3 4 5; do
    tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
    v=$(curl -s --max-time 45 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]')
    [ -n "$v" ] && { printf '%s' "$v"; return 0; }; sleep 10
  done; return 1; }

echo "== TERMINOLOGY DEPLOY — $BATCH =="
echo "on commit: $(git rev-parse --short HEAD)  (base $BASE)"
OLD_BUILD=$(kudu_buildid); echo "  OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[guards] immovables..."
./scripts/terminology/immovables.sh "$BASE" || die "structural change detected"

echo "[guards] no stray 'Worker' left in the files this batch touched..."
for f in $(git diff --name-only "$BASE" HEAD | grep -E '\.tsx?$' || true); do
  [ -f "$f" ] || continue
  python3 scripts/terminology/rename.py --files "$f" 2>/dev/null | grep -q 'proposed' || true
done
LEFT=$(git diff --name-only "$BASE" HEAD | grep -E '\.tsx?$' | xargs -r python3 scripts/terminology/rename.py --files 2>/dev/null | grep -c '^      - ' || true)
[ "${LEFT:-0}" = "0" ] && echo "      nothing left to replace in the touched files." \
  || { echo "ERROR: $LEFT string(s) still replaceable in this batch. Aborting"; exit 1; }

echo "[build]"; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "  NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[package]"; rm -f "$ZIP"
zip -qr "$ZIP" .next public package.json package-lock.json node_modules prisma next.config.js -x "node_modules/.cache/*" || die "zip failed"
echo "  $(du -h "$ZIP" | cut -f1)"

echo "[deploy]"; az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --async true || die "deploy failed"
for i in $(seq 1 40); do
  CUR=$(kudu_buildid); echo "  [$i] prod build: ${CUR:-<none>}"
  [ "$CUR" = "$NEW_BUILD" ] && break; sleep 15
done
[ "$(kudu_buildid)" = "$NEW_BUILD" ] || die "the new build never landed"
echo "[restart] — the build landing on disk does not mean the process picked it up"
az webapp restart -g "$RG" -n "$APP" -o none || die "restart failed"
for i in $(seq 1 30); do H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH"); echo "  [$i] health: $H"; [ "$H" = "200" ] && break; sleep 10; done
echo "== $BATCH DEPLOYED: $OLD_BUILD -> $NEW_BUILD =="
