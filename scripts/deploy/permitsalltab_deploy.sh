#!/usr/bin/env bash
# Deploy: "All permits" leads the permits status tabs.
#
# The change is small and its risk is concentrated in one place: the All tab's
# href must be the BARE PATH, because that is what "no status filter" has always
# meant here. If it shipped as ?status=all or ?status= the register would still
# work, but every existing bookmark would start disagreeing with the tab strip.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/permitsalltab_deploy.zip
PAGE='app/platform/dashboard/permits/page.tsx'
CHUNK='.next/server/app/platform/dashboard/permits/page.js'
DEPLOYED=58a7be6

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== PERMITS ALL TAB DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/platform/dashboard/permits/page.tsx
docs/BACKLOG.md
scripts/deploy/permitsalltab_deploy.sh
scripts/permitstabs_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the permits page, the backlog and its verifier." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# The All tab must exist, be first, and be active on an empty status.
code "$PAGE" | grep -qF "label: 'All permits'" \
  || { echo "ERROR: the All permits tab is missing. Aborting"; exit 1; }
code "$PAGE" | grep -qF "active: status === ''" \
  || { echo "ERROR: All permits is not the selected state for an empty status. Aborting"; exit 1; }
# It must come BEFORE the mapped statuses, or it is not the first tab.
ALL_LINE=$(code "$PAGE" | grep -n "label: 'All permits'" | cut -d: -f1)
MAP_LINE=$(code "$PAGE" | grep -n "PERMIT_STATUSES.map" | cut -d: -f1)
[ "$ALL_LINE" -lt "$MAP_LINE" ] \
  && echo "      All permits is present, first, and selected on an empty status." \
  || { echo "ERROR: All permits is not first in the strip. Aborting"; exit 1; }

# ITS HREF MUST DROP THE PARAMETER, not set it to '' or 'all'.
code "$PAGE" | grep -qF "href: qp({ status: '' })" \
  || { echo "ERROR: the All tab does not clear the status param. Aborting"; exit 1; }
code "$PAGE" | grep -qE "status: 'all'" \
  && { echo "ERROR: the All tab sets ?status=all — existing bookmarks would disagree. Aborting"; exit 1; }
echo "      All permits clears the parameter rather than setting one."

# THE TOGGLE MUST BE GONE: a status tab points at itself, unconditionally.
code "$PAGE" | grep -qF "status === s.value ? '' : s.value" \
  && { echo "ERROR: the clear-on-active toggle is still present. Aborting"; exit 1; }
code "$PAGE" | grep -qF "href: qp({ status: s.value })" \
  || { echo "ERROR: status tabs do not link to their own status. Aborting"; exit 1; }
echo "      status tabs link to themselves; the toggle is gone."

# NO COUNTS, by decision.
code "$PAGE" | grep -qE "count:" \
  && { echo "ERROR: a count pill has appeared — counts were explicitly out of scope. Aborting"; exit 1; }
echo "      no counts, as specified."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (compiled permits chunk)..."
[ -f "$CHUNK" ] || { echo "ERROR: permits chunk not built. Aborting"; exit 1; }
grep -qF 'All permits' "$CHUNK" \
  && echo "      the All permits tab compiled into the bundle." \
  || { echo "ERROR: 'All permits' absent from the chunk — stale .next? Aborting"; exit 1; }
# The status LABELS are not in the page chunk: PERMIT_STATUSES lives in
# permitConstants.ts and compiles into a shared chunk, while "All permits" is an
# inline string in the page. Asserting both against the page chunk failed on a
# perfectly good build — the same mistake as the Actions deploy, where the column
# list was equally not where I looked for it. Each fact is checked where it is.
#
# Matching the whole list in order is also stronger than one label: it catches a
# status dropped or reordered as well as one missing.
grep -rqF '{value:"SUBMITTED",label:"Awaiting approval"},{value:"UNDER_REVIEW",label:"Under review"}' .next/server 2>/dev/null \
  || { echo "ERROR: the permit status list is missing or reordered. Aborting"; exit 1; }
echo "      the status list compiled intact, in order, alongside it."

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
[ "$CODE" = "200" ] && echo "== PERMITS ALL TAB DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
