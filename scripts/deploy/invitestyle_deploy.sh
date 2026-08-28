#!/usr/bin/env bash
# Deploy: promote Invite Worker to the Workers tab toolbar.
# UI placement only — one invite path, permissions unchanged.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/invitestyle_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== INVITE WORKER STYLING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
WK="app/platform/dashboard/sites/[id]/workers/page.tsx"

# Listing-action weight: brand outline at px-3 py-1.5, and NOT a solid primary.
grep -q 'border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700' "$WK" \
  && echo "      confirmed: brand-outline listing-action styling." \
  || { echo "ERROR: expected listing-action styling not found — aborting"; exit 1; }

if grep -qE 'bg-safe-500|<Button' "$WK"; then
  echo "ERROR: page-level primary styling still present — aborting"; exit 1
fi
echo "      confirmed: no solid primary on this page."

# Placement + single invite path must be untouched by a styling change.
grep -q 'Invite Worker' "$WK" && grep -q 'autoOpenInvite' "$WK" \
  && grep -q 'id="manage-access"' "$WK" \
  && grep -q 'canManageWorkerAccess(viewer.role) && access !== null' "$WK" \
  && echo "      confirmed: placement, auto-expand and gating unchanged." \
  || { echo "ERROR: placement/behaviour changed — aborting"; exit 1; }

if grep -q "Invite a worker" components/platform/WorkerAccessManager.tsx; then
  echo "ERROR: a second invite trigger reappeared — aborting"; exit 1
fi
if ! git diff --quiet HEAD~1 HEAD -- components/platform/WorkerAccessManager.tsx; then
  echo "ERROR: WorkerAccessManager changed — styling-only deploy. Aborting"; exit 1
fi
echo "      confirmed: single invite path, invite form untouched."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
grep -rqF "Invite Worker" .next/server 2>/dev/null \
  || { echo "ERROR: Invite Worker not in bundle — aborting"; exit 1; }
if grep -rqF "Invite a worker" .next/server 2>/dev/null; then
  echo "ERROR: old invite trigger back in bundle — aborting"; exit 1
fi
grep -rqF "border-brand-500 px-3 py-1.5" .next/server 2>/dev/null \
  || { echo "ERROR: restyled button not in bundle — aborting"; exit 1; }
# Sensitivity: the roster + access section must still ship.
grep -rqF "Manage project access" .next/server 2>/dev/null \
  || { echo "ERROR: access section missing — guard not sensitive, aborting"; exit 1; }
echo "      confirmed: restyled single trigger in bundle; page intact."

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
[ "$CODE" = "200" ] && echo "== INVITE WORKER STYLING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
