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
ZIP=/tmp/invitedialog_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== INVITE WORKER DIALOG DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
WK="app/platform/dashboard/sites/[id]/workers/page.tsx"
WM="components/platform/WorkerAccessManager.tsx"

# The dialog, with the things that make it a workflow rather than a form.
grep -q 'role="dialog"' "$WM" \
  && grep -q 'invite-dialog-title' "$WM" \
  && grep -q 'Invite a worker' "$WM" \
  && grep -q 'Send Invite' "$WM" \
  && grep -q 'inviteNameRef' "$WM" \
  && echo "      confirmed: titled dialog, focus ref, Send Invite." \
  || { echo "ERROR: invite dialog incomplete — aborting"; exit 1; }

for F in invite-full-name invite-company invite-mobile; do
  grep -q "htmlFor=\"$F\"" "$WM" \
    || { echo "ERROR: missing label for $F — aborting"; exit 1; }
done
echo "      confirmed: all three fields labelled."

# Success state must be IN the dialog, and the old in-section banner gone.
grep -q 'Invitation sent to' "$WM" \
  && ! grep -q 'Invitation code for' "$WM" \
  && echo "      confirmed: success state moved into the dialog." \
  || { echo "ERROR: success state not moved — aborting"; exit 1; }

# ONE implementation — counted, not assumed.
[ "$(grep -c "action: 'invite'" "$WM")" -eq 1 ] \
  && [ "$(grep -c 'async function invite' "$WM")" -eq 1 ] \
  && echo "      confirmed: single invite handler and call site." \
  || { echo "ERROR: invite logic duplicated — aborting"; exit 1; }

# No leftover scroll/expand machinery now the form has left the section.
if grep -q 'manage-access' "$WK"; then
  echo "ERROR: page still anchors/expands the access section — aborting"; exit 1
fi
grep -q 'autoOpenInvite' "$WK" && grep -q 'invite: .1.' "$WK" \
  && echo "      confirmed: ?invite=1 still opens the dialog; no anchor." \
  || { echo "ERROR: ?invite=1 wiring missing — aborting"; exit 1; }

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
for N in "Invite a worker" "Send Invite" "Invitation sent to" "invite-full-name"; do
  grep -rqF "$N" .next/server 2>/dev/null \
    || { echo "ERROR: '$N' not in bundle — aborting"; exit 1; }
done
if grep -rqF "Invitation code for" .next/server 2>/dev/null; then
  echo "ERROR: old in-section success banner still in bundle — aborting"; exit 1
fi
grep -rqF "Manage project access" .next/server 2>/dev/null \
  || { echo "ERROR: access section missing — guard not sensitive, aborting"; exit 1; }
echo "      confirmed: dialog in bundle; old banner gone; page intact."

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
[ "$CODE" = "200" ] && echo "== INVITE WORKER DIALOG COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
