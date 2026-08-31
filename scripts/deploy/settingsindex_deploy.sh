#!/usr/bin/env bash
# Deploy: Admin → Settings becomes a grouped index instead of a card grid.
#
# The change is presentation-only and touches one route, so the guards here are
# about the two ways it could ship wrong: the old card grid surviving in the
# bundle, and the CSCS status going out naming the mock provider instead of the
# onboarding state. Both are asserted in the SOURCE and again in the compiled
# ARTIFACT, because a stale .next has shipped an unchanged page before.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/settingsindex_deploy.zip
PAGE='app/admin/(dashboard)/settings/page.tsx'

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# Comments in the page quote the very strings the guards assert ("CSCS on mock
# provider" appears in the rationale), so SOURCE greps run over stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== SETTINGS INDEX DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/admin/(dashboard)/settings/page.tsx
components/admin/SettingsIcons.tsx
scripts/settingsindex_verify.js"
CH=$(git diff --name-only b7d0a88 HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: exactly the three intended files changed." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# The old layout must be gone, not merely unused.
code "$PAGE" | grep -q 'sm:grid-cols-2' \
  && { echo "ERROR: the old card grid is still in the page. Aborting"; exit 1; }
code "$PAGE" | grep -q 'Manage integrations' \
  && { echo "ERROR: old card CTA copy still present. Aborting"; exit 1; }
echo "      old card grid and CTA copy are gone."

# The new layout must actually be there.
code "$PAGE" | grep -q '17.5rem' \
  || { echo "ERROR: fixed status column missing from the row grid. Aborting"; exit 1; }
code "$PAGE" | grep -q 'Platform configuration' \
  || { echo "ERROR: group labels missing. Aborting"; exit 1; }
echo "      grouped list with a fixed status column is present."

# The CSCS status must describe onboarding and must NOT name the mock provider.
code "$PAGE" | grep -q 'CSCS onboarding pending' \
  || { echo "ERROR: CSCS onboarding status missing. Aborting"; exit 1; }
code "$PAGE" | grep -qi 'mock' \
  && { echo "ERROR: the page still references mock mode in shipped copy. Aborting"; exit 1; }
echo "      CSCS status describes onboarding, no mock reference in shipped copy."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (compiled output, not source)..."
HITS=$(grep -rlF 'CSCS onboarding pending' .next/server 2>/dev/null | wc -l)
[ "$HITS" -ge 1 ] \
  && echo "      new status copy compiled into the bundle ($HITS file(s))." \
  || { echo "ERROR: new status copy absent from the build — stale .next? Aborting"; exit 1; }
grep -rqF 'Manage integrations' .next/server 2>/dev/null \
  && { echo "ERROR: old card CTA is still in the compiled bundle. Aborting"; exit 1; }
grep -rqF 'CSCS on mock provider' .next/server 2>/dev/null \
  && { echo "ERROR: mock wording compiled into the bundle. Aborting"; exit 1; }
echo "      old CTA and mock wording absent from the compiled bundle."

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
[ "$CODE" = "200" ] && echo "== SETTINGS INDEX DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
