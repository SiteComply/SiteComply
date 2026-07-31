#!/usr/bin/env bash
# SC-021 production CODE deploy (Mandatory Action Assignment). The additive
# migration 20260729120000_add_audit_templates + template seed must already be
# applied (run scripts/sc020_migrate.sh first). Same proven flow as SC-005..012.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sc020_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-021 CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Confirming SC-021 code IS present in this artifact..."
[ -f services/compliance/occurrenceGenerator.ts ] \
  && [ -f services/siteServices/siteServiceAvailability.ts ] \
  && [ -f services/siteServices/siteServiceCatalog.ts ] \
  && [ -f components/platform/SiteServicesConfig.tsx ] \
  && [ -f 'app/api/platform/sites/[id]/services/route.ts' ] \
  && grep -q 'SitePermitTypeSetting' prisma/schema.prisma \
  && grep -q 'SiteActivityTypeSetting' prisma/schema.prisma \
  && grep -q 'Temporary Works Inspection' services/audits/auditTemplateSeed.ts \
  && grep -q 'Environmental Inspection' services/audits/auditTemplateSeed.ts \
  && grep -q 'isPermitTypeAvailable' services/permits/permitService.ts \
  && grep -q 'isActivityTypeAvailable' services/audits/auditService.ts \
  && grep -q 'isActivityTypeAvailable' services/compliance/scheduleService.ts \
  && echo "      confirmed: availability service + config UI + API + seeds + all three enforcement points present." \
  || { echo "ERROR: SC-021 code missing — aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== SC-021 CODE DEPLOY COMPLETE ==" || echo "== HEALTH NOT 200 — investigate =="
