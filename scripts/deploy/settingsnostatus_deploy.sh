#!/usr/bin/env bash
# Deploy: the Settings index drops its status column.
#
# This deployment REMOVES things, so its guards are mostly negative — and a
# negative guard is the easy one to get wrong, because it passes when it looks
# in the wrong place. Every "absent" assertion below therefore runs alongside a
# positive one over the SAME text, so an empty or mis-targeted read cannot pass
# as a clean removal.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/settingsnostatus_deploy.zip
PAGE='app/admin/(dashboard)/settings/page.tsx'
CHUNK='.next/server/app/admin/(dashboard)/settings/page.js'
DEPLOYED=53e7b68   # the commit currently serving in production

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# The page's comments explain the status column that was removed, so they quote
# the very strings the guards assert are gone. SOURCE greps run over stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== SETTINGS INDEX — REMOVE STATUS COLUMN — DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$PAGE" ] \
  && echo "      confirmed: only the settings page changed since $DEPLOYED." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# Positive first — if these fail the file is not what we think it is, and every
# absence check below would be meaningless.
for want in 'Platform configuration' 'Organisation' "name=\"chevron\"" 'SettingsIcon'; do
  code "$PAGE" | grep -qF "$want" \
    || { echo "ERROR: '$want' missing — the page is not the settings index. Aborting"; exit 1; }
done
echo "      grouped list, icons and chevrons still present."

# Now the removals.
for gone in 'CSCS onboarding pending' 'Using built-in defaults' 'Profile and branding set' \
            'Read-only' 'StatusCell' 'SettingsStatus' 'hivis-500' '17.5rem'; do
  code "$PAGE" | grep -qF "$gone" \
    && { echo "ERROR: '$gone' is still in the page. Aborting"; exit 1; }
done
echo "      status text, pills, dot and the status grid column are gone."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (the compiled settings chunk, scoped to that one file)..."
[ -f "$CHUNK" ] || { echo "ERROR: settings chunk not built at $CHUNK. Aborting"; exit 1; }
grep -qF 'Platform configuration' "$CHUNK" \
  || { echo "ERROR: group labels absent from the chunk — stale .next? Aborting"; exit 1; }
echo "      chunk built and carries the group labels."
for gone in 'CSCS onboarding pending' 'Using built-in defaults' 'Profile and branding set' 'Read-only'; do
  grep -qF "$gone" "$CHUNK" \
    && { echo "ERROR: '$gone' compiled into the settings chunk. Aborting"; exit 1; }
done
echo "      no status strings compiled into the settings chunk."

echo "[5/8] Packaging zip..."; rm -f "$ZIP"; zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Deploying..."; az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/8] Waiting for BUILD_ID ${NEW_BUILD}..."
LANDED=""; for i in $(seq 1 40); do sleep 15; CURB=$(kudu_buildid); echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  [ "$CURB" = "$NEW_BUILD" ] && { LANDED=yes; break; }; done
[ -n "$LANDED" ] || { echo "WARNING: build id not confirmed. NOT cutting over."; exit 2; }
echo "      new build landed on disk."

echo "[8/8] Cutting over..."; az webapp stop -g "$RG" -n "$APP" -o none; az webapp start -g "$RG" -n "$APP" -o none
CODE=""; for i in $(seq 1 20); do sleep 15; CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"; [ "$CODE" = "200" ] && break; done

echo "== DEPLOY SUMMARY =="; echo "   old build: ${OLD_BUILD:-<unknown>}"; echo "   new build: ${NEW_BUILD}"; echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== REMOVE STATUS COLUMN DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
