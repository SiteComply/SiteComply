#!/usr/bin/env bash
# Deploy: Admin Centre reports EFFECTIVE AI provider configuration (env fallback).
# Presentation-only. Same proven flow as prior deploys.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/aibadge_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== AI PROVIDER STATUS (EFFECTIVE CONFIG) DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
grep -q 'PROVIDER_FIELD_ENV' services/ai/aiConfigService.ts \
  && grep -q 'providerConfiguredStatus' services/ai/aiConfigService.ts \
  && grep -q 'providerConfiguredSource' services/ai/aiConfigService.ts \
  && grep -q 'AZURE_OPENAI_DEPLOYMENT' services/ai/aiConfigService.ts \
  && echo "      confirmed: effective-config status logic present." \
  || { echo "ERROR: status logic missing — aborting"; exit 1; }

# PRESENTATION-ONLY: the runtime resolution path must be byte-identical to the
# rollback commit. If any of these changed, this is no longer a display fix.
for f in services/ai/index.ts services/ai/azureOpenAiProvider.ts \
         services/ai/mockProvider.ts services/ai/summaryService.ts; do
  if ! git diff --quiet HEAD~1 HEAD -- "$f"; then
    echo "ERROR: $f changed — this deploy must be presentation-only. Aborting."; exit 1
  fi
done
echo "      confirmed: provider + generation code identical to rollback point."

# The env fallback the badge now mirrors must still exist in the provider.
grep -q "requireEnv('AZURE_OPENAI_ENDPOINT')" services/ai/azureOpenAiProvider.ts \
  && grep -q "requireEnv('AZURE_OPENAI_DEPLOYMENT')" services/ai/azureOpenAiProvider.ts \
  && echo "      confirmed: provider env fallback intact (badge mirrors reality)." \
  || { echo "ERROR: provider env fallback missing — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
grep -rqF "Configured (environment)" .next/server .next/static 2>/dev/null \
  || { echo "ERROR: new status label not in bundle — aborting"; exit 1; }
# Sensitivity: the negative state must still exist, so the fix cannot have simply
# hard-coded every provider to "Configured".
grep -rqF "Not configured" .next/server .next/static 2>/dev/null \
  || { echo "ERROR: 'Not configured' state absent — guard not sensitive, aborting"; exit 1; }
# No environment VALUE may be baked into the bundle at build time.
for LEAK in "sitecomplyopenaiuk.openai.azure.com" "gpt-5-mini-summaries"; do
  if grep -rqF "$LEAK" .next/static 2>/dev/null; then
    echo "ERROR: env value '$LEAK' leaked into client bundle — aborting"; exit 1
  fi
done
echo "      confirmed: both states present; no env values in client bundle."

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
[ -n "$LANDED" ] || { echo "WARNING: new build id not confirmed on disk. NOT cutting over."; exit 2; }
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
[ "$CODE" = "200" ] && echo "== AI STATUS DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
