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
ZIP=/tmp/invitedetails_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== INVITE WORKER DETAILS-NESTING FIX DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
WK="app/platform/dashboard/sites/[id]/workers/page.tsx"
ID="components/platform/InviteWorkerDialog.tsx"
WM="components/platform/WorkerAccessManager.tsx"

[ -f "$ID" ] || { echo "ERROR: InviteWorkerDialog missing — aborting"; exit 1; }

# THE BUG: a dialog nested in a collapsed <details> is hidden, whatever its
# position. Button + dialog must live together, outside that section.
grep -q '<InviteWorkerDialog siteId={params.id} />' "$WK" \
  && echo "      confirmed: button+dialog rendered from the toolbar." \
  || { echo "ERROR: InviteWorkerDialog not in the toolbar — aborting"; exit 1; }

grep -q 'createPortal' "$ID" && grep -q 'document.body' "$ID" \
  && echo "      confirmed: dialog portalled out of every ancestor." \
  || { echo "ERROR: dialog not portalled — a hidden ancestor can swallow it. Aborting"; exit 1; }

# No navigation dependency, no mount-only prop.
if grep -q 'autoOpenInvite' "$WK" || grep -q 'autoOpenInvite' "$WM"; then
  echo "ERROR: autoOpenInvite is back — mount-only prop, click will not work. Aborting"; exit 1
fi
if grep -q "invite: '1'" "$WK"; then
  echo "ERROR: ?invite=1 navigation plumbing is back — aborting"; exit 1
fi
grep -q 'onClick={() => setOpen(true)}' "$ID" \
  && echo "      confirmed: click sets state directly, no navigation." \
  || { echo "ERROR: button does not open the dialog directly — aborting"; exit 1; }

# Still exactly one implementation.
[ "$(grep -c "action: 'invite'" "$ID")" -eq 1 ] && [ "$(grep -c "action: 'invite'" "$WM")" -eq 0 ] \
  && [ "$(grep -c 'role="dialog"' "$WM")" -eq 0 ] \
  && echo "      confirmed: single invite implementation." \
  || { echo "ERROR: invite logic duplicated or left behind — aborting"; exit 1; }

grep -q 'canManageWorkerAccess(viewer.role) && access !== null' "$WK" \
  && echo "      confirmed: permission gating intact." \
  || { echo "ERROR: gating changed — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (built bundle)..."
CHUNK=$(grep -rl "Invite a worker" .next/static/chunks 2>/dev/null | head -1)
[ -n "$CHUNK" ] || { echo "ERROR: dialog not in any client chunk — aborting"; exit 1; }
grep -q 'document.body' "$CHUNK" 2>/dev/null \
  || { echo "ERROR: portal target absent from client chunk — aborting"; exit 1; }
grep -rqF "Send Invite" .next/server 2>/dev/null \
  || { echo "ERROR: dialog copy missing — aborting"; exit 1; }
grep -rqF "Manage project access" .next/server 2>/dev/null \
  || { echo "ERROR: access section missing — guard not sensitive, aborting"; exit 1; }
echo "      confirmed: portalled dialog in the client chunk; page intact."

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
[ "$CODE" = "200" ] && echo "== INVITE WORKER DETAILS-NESTING FIX COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
