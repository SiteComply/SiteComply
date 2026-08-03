#!/usr/bin/env bash
# SC-024 Phase 3 production CODE deploy (AI narrative + secure sharing). The
# additive migration 20260809090000_add_close_out_sharing must already be
# applied — run scripts/sc024p3_migrate.sh first.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sc024p3_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-024 PHASE 3 CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Confirming SC-024 Phase 3 code IS present in this artifact..."
[ -f services/closeOut/closeOutNarrative.ts ] \
  && [ -f services/closeOut/closeOutAi.ts ] \
  && [ -f services/closeOut/closeOutSharing.ts ] \
  && [ -f services/platformUsers/viewerBuilder.ts ] \
  && [ -f services/platformUsers/platformViewerTypes.ts ] \
  && [ -f components/platform/AiNarrativeBlock.tsx ] \
  && [ -f components/platform/CloseOutPackDocument.tsx ] \
  && [ -f components/platform/CloseOutShareManager.tsx ] \
  && [ -f components/platform/CloseOutNarrativeControls.tsx ] \
  && [ -f 'app/pack/[token]/page.tsx' ] \
  && [ -f 'app/api/pack/[token]/zip/route.ts' ] \
  && [ -f 'app/api/platform/sites/[id]/close-out/[packId]/narrative/route.ts' ] \
  && [ -f 'app/api/platform/sites/[id]/close-out/[packId]/shares/route.ts' ] \
  && [ -f 'app/api/platform/sites/[id]/close-out/[packId]/shares/[shareId]/route.ts' ] \
  && grep -q 'CLOSE_OUT_PACK' prisma/schema.prisma \
  && grep -q 'model CloseOutPackShare' prisma/schema.prisma \
  && grep -q 'model CloseOutPackShareView' prisma/schema.prisma \
  && echo "      confirmed: narrative + sharing services, routes and UI present." \
  || { echo "ERROR: SC-024 Phase 3 code missing — aborting"; exit 1; }

# BEHAVIOUR, not file presence. These are the properties that make the feature
# safe; if any regressed, the deploy must not go out.
grep -q 'findConclusionLanguage' services/closeOut/closeOutNarrative.ts \
  && grep -q 'CONCLUSION_PATTERNS' services/closeOut/closeOutNarrative.ts \
  && grep -q 'findConclusionLanguage' services/closeOut/closeOutNarrative.ts \
  || { echo "ERROR: the conclusion-language guard is missing — aborting"; exit 1; }
echo "      confirmed: AI output guard present."

# The token must be hashed, never stored raw.
grep -q "createHash('sha256')" services/closeOut/closeOutSharing.ts \
  && grep -q 'tokenHash' services/closeOut/closeOutSharing.ts \
  || { echo "ERROR: share tokens are not hashed — aborting"; exit 1; }
echo "      confirmed: share tokens stored as hashes."

# A share must resolve the sharer's LIVE permissions, not a snapshot.
grep -q 'buildViewerForUser' services/closeOut/closeOutSharing.ts \
  && grep -q 'sharer_lost_access' services/closeOut/closeOutSharing.ts \
  || { echo "ERROR: share links do not re-resolve the sharer's access — aborting"; exit 1; }
echo "      confirmed: shares re-resolve the sharer's live permissions."

# The public pack page must refuse indexing.
grep -q 'robots' 'app/pack/[token]/page.tsx' \
  || { echo "ERROR: shared pack page is missing robots metadata — aborting"; exit 1; }
echo "      confirmed: shared pack page is noindex."

# AI prose must be labelled wherever it renders, including the archived copy.
grep -q 'AI-generated' components/platform/AiNarrativeBlock.tsx \
  && grep -q 'AI-generated' services/closeOut/closeOutArchive.ts \
  || { echo "ERROR: AI content is not labelled everywhere — aborting"; exit 1; }
echo "      confirmed: AI content labelled on screen and in the archive."

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
[ "$CODE" = "200" ] && echo "== SC-024 PHASE 3 CODE DEPLOY COMPLETE ==" || echo "== HEALTH NOT 200 — investigate =="
