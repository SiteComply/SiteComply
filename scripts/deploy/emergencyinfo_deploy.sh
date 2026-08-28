#!/usr/bin/env bash
# Deploy: operational ownership of emergency information + honest worker-facing
# completeness. SITE_EDIT_ROLES must remain Director-only.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/emergencyinfo_deploy.zip
SVC=services/sites/siteInformationService.ts
ROUTE=app/api/platform/sites/\[id\]/emergency/route.ts
PANEL=components/platform/SiteEmergencyConfig.tsx
PERMS=services/platformUsers/platformPermissions.ts
OVERVIEW=app/platform/dashboard/sites/\[id\]/page.tsx
EXPERIENCE=app/platform/dashboard/sites/\[id\]/experience/page.tsx

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

# Strips // line comments and multi-line /* … */ and {/* … */} blocks. Written in
# python after three earlier deploy guards in this repo false-positived on their
# own explanatory comments.
code() {
  python3 - "$1" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
PY
}

echo "== EMERGENCY INFO OWNERSHIP DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."

# ---- THE CRITICAL INVARIANT: Director-only site administration is untouched ----
git diff --quiet HEAD~1 HEAD -- "$PERMS" \
  && echo "      confirmed: platformPermissions.ts byte-identical." \
  || { echo "ERROR: platformPermissions.ts changed — aborting"; exit 1; }

grep -qF "export const SITE_EDIT_ROLES: PlatformRoleValue[] = ['DIRECTOR'];" "$PERMS" \
  && echo "      confirmed: SITE_EDIT_ROLES is still ['DIRECTOR']." \
  || { echo "ERROR: SITE_EDIT_ROLES is no longer Director-only — aborting"; exit 1; }

grep -qF "export const SITE_CREATE_ROLES: PlatformRoleValue[] = ['DIRECTOR'];" "$PERMS" \
  && echo "      confirmed: SITE_CREATE_ROLES is still ['DIRECTOR']." \
  || { echo "ERROR: SITE_CREATE_ROLES changed — aborting"; exit 1; }

# The Director-only whole-site route must still gate on canEditSite.
code 'app/api/platform/sites/[id]/route.ts' | grep -q 'canEditSite' \
  && echo "      confirmed: whole-site PATCH still gated on canEditSite." \
  || { echo "ERROR: the Director-only site route lost its gate — aborting"; exit 1; }

# ---- the new narrow endpoint ----
code "$ROUTE" | grep -q "permits(viewer.role, 'sites', 'edit')" \
  && echo "      confirmed: emergency route reuses the sites:edit gate." \
  || { echo "ERROR: emergency route is not on the sites:edit gate — aborting"; exit 1; }

if code "$ROUTE" | grep -qE 'canEditSite|SITE_EDIT_ROLES'; then
  echo "ERROR: emergency route references the Director-only gate — aborting"; exit 1
fi
echo "      confirmed: emergency route does not touch SITE_EDIT_ROLES."

# The write must whitelist the six emergency columns and nothing else.
for f in fireAssemblyPoint firstAiderName firstAiderNumber firstAiderLocation nearestHospital emergencyNumber; do
  code "$SVC" | grep -A30 'export async function saveSiteEmergency' | grep -q "$f" \
    || { echo "ERROR: saveSiteEmergency is missing $f — aborting"; exit 1; }
done
if code "$SVC" | grep -A30 'export async function saveSiteEmergency' \
     | grep -qE '\b(name|jobReference|status|addressLine1|town|postcode):'; then
  echo "ERROR: saveSiteEmergency writes a Director-only column — aborting"; exit 1
fi
echo "      confirmed: emergency write whitelists only the six fields."

code "$SVC" | grep -A30 'export async function saveSiteEmergency' | grep -q 'viewer.siteIds.includes' \
  && echo "      confirmed: emergency write enforces site scope." \
  || { echo "ERROR: emergency write lost its site-scope check — aborting"; exit 1; }

# ---- completeness ----
code "$SVC" | grep -q 'export function computeWorkerFacingCompleteness' \
  && code "$OVERVIEW" | grep -q 'workerFacingCompleteness' \
  && echo "      confirmed: Overview uses the worker-facing total." \
  || { echo "ERROR: Overview is not on the worker-facing total — aborting"; exit 1; }

# The Site Information panel must keep its OWN six-section figure.
code "$SVC" | grep -q 'complete: SITE_INFO_SECTIONS.length - missing.length' \
  && echo "      confirmed: Site Information panel keeps its own 6-section count." \
  || { echo "ERROR: computeCompleteness was altered — aborting"; exit 1; }

# ---- UI ----
code "$EXPERIENCE" | grep -q 'SiteEmergencyConfig' \
  && ! code "$EXPERIENCE" | grep -q 'canEditSite' \
  && echo "      confirmed: experience tab uses the editable panel, no Director gate." \
  || { echo "ERROR: experience tab wiring wrong — aborting"; exit 1; }

code "$PANEL" | grep -q "sites/\${siteId}/emergency" \
  && echo "      confirmed: panel writes to the narrow endpoint." \
  || { echo "ERROR: panel does not target the emergency endpoint — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
[ -f '.next/server/app/api/platform/sites/[id]/emergency/route.js' ] \
  && echo "      confirmed: emergency route compiled." \
  || { echo "ERROR: emergency route did not compile — aborting"; exit 1; }
[ -f '.next/server/app/api/platform/sites/[id]/route.js' ] \
  && echo "      confirmed: Director-only site route still compiled." \
  || { echo "ERROR: whole-site route missing — aborting"; exit 1; }
EXPJS=$(find '.next/server/app/platform/dashboard/sites/[id]/experience' -maxdepth 1 -name page.js 2>/dev/null | head -1)
[ -n "$EXPJS" ] && grep -qF "Shown to workers on their Emergency info page" "$EXPJS" \
  && echo "      confirmed: editable panel copy compiled into the experience route." \
  || { echo "ERROR: panel copy absent from the bundle — aborting"; exit 1; }

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
[ -n "$LANDED" ] || { echo "WARNING: new build id not confirmed. NOT cutting over."; exit 2; }
echo "      new build landed on disk."

echo "[8/8] Cutting over and health-checking..."
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
[ "$CODE" = "200" ] && echo "== EMERGENCY INFO DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 — investigate =="; exit 3; }
