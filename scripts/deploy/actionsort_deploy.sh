#!/usr/bin/env bash
# Deploy: sortable columns on Platform → Actions.
#
# Same two failure modes as the Check-ins sorting deploy, so the same shape of
# guard: a missing tiebreaker (invisible until someone pages a tied sort) and a
# sort param dropped by one of the builders that assemble the query string
# (invisible until someone clicks that one control). Both are asserted in source
# and again in the compiled bundle.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/actionsort_deploy.zip
SORT='services/actions/actionSort.ts'
PAGE='app/platform/dashboard/actions/page.tsx'
ARROW='components/platform/SortArrow.tsx'
CHUNK='.next/server/app/platform/dashboard/actions/page.js'
DEPLOYED=20ee030

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

echo "== ACTIONS SORTING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/platform/dashboard/actions/page.tsx
app/platform/dashboard/submissions/page.tsx
components/platform/SortArrow.tsx
scripts/actionsort_responsive.js
scripts/actionsort_ux_capture.js
scripts/actionsort_verify.js
services/actions/actionService.ts
services/actions/actionSort.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: exactly the eight intended files changed." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# THE TIEBREAKER, on every branch of the order builder.
T=$(code "$SORT" | grep -c "tiebreak")
[ "$T" -ge 5 ] && echo "      id tiebreaker on every orderBy branch ($T references)." \
  || { echo "ERROR: a branch has lost the tiebreaker. Aborting"; exit 1; }
code "$SORT" | grep -q "id: 'asc' as const" \
  || { echo "ERROR: the tiebreaker is not the unique id. Aborting"; exit 1; }

# NULLS LAST on both nullable columns — otherwise reversing Due leads with
# undated actions, and reversing Assigned leads with unassigned ones.
for col in dueDate assignedTo; do
  code "$SORT" | grep -qE "$col: \{ sort: dir, nulls: 'last' \}" \
    || { echo "ERROR: $col does not sort nulls last. Aborting"; exit 1; }
done
echo "      dueDate and assignedTo both sort nulls last."

# THE DEFAULT MUST NOT MOVE: Due ascending, keeping createdAt desc as secondary.
code "$SORT" | grep -q "key: 'due'" \
  || { echo "ERROR: default sort key is not 'due'. Aborting"; exit 1; }
code "$SORT" | grep -q "{ createdAt: 'desc' }" \
  || { echo "ERROR: the due branch lost its createdAt secondary — the default order would change. Aborting"; exit 1; }
echo "      default is unchanged: Due ascending, createdAt desc secondary."

# EVERY QUERY-STRING BUILDER MUST CARRY THE SORT.
C=$(code "$PAGE" | grep -c "actionSortParams(")
[ "$C" -ge 3 ] && echo "      sort carried by the page's query builders ($C sites)." \
  || { echo "ERROR: only $C carrier(s) — a control would drop the sort. Aborting"; exit 1; }
code "$PAGE" | grep -q "aria-sort" \
  || { echo "ERROR: aria-sort missing from the headers. Aborting"; exit 1; }
code "$PAGE" | grep -q "whitespace-nowrap" \
  || { echo "ERROR: header nowrap missing. Aborting"; exit 1; }

# SortArrow must be the SHARED component, not a local copy.
[ -f "$ARROW" ] || { echo "ERROR: shared SortArrow missing. Aborting"; exit 1; }
for f in "$PAGE" app/platform/dashboard/submissions/page.tsx; do
  code "$f" | grep -q "from '@/components/platform/SortArrow'" \
    || { echo "ERROR: $f does not use the shared SortArrow. Aborting"; exit 1; }
  code "$f" | grep -q "function SortArrow" \
    && { echo "ERROR: $f has a local SortArrow copy. Aborting"; exit 1; }
done
echo "      both registers use the shared SortArrow, no local copies."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (compiled actions chunk)..."
[ -f "$CHUNK" ] || { echo "ERROR: actions chunk not built. Aborting"; exit 1; }
# The page chunk carries the MARKUP. The column list does not live here: it
# compiles into a shared chunk with the rest of actionSort.ts, so looking for a
# label in this file fails on a perfectly good build — which is exactly what it
# did on the first run of this script. Assert each thing where it actually is.
for want in 'aria-sort' 'whitespace-nowrap'; do
  grep -qF "$want" "$CHUNK" || { echo "ERROR: '$want' absent from the page chunk — stale .next? Aborting"; exit 1; }
done
echo "      page chunk carries the sortable-header markup."

# The column list, wherever it was bundled. Asserting the whole array in order
# is stronger than one label: it catches a dropped or reordered column too.
grep -rqF '{key:"action",label:"Action"},{key:"state",label:"State"},{key:"due",label:"Due"},{key:"assigned",label:"Assigned"}' .next/server 2>/dev/null \
  && echo "      all four sortable columns compiled, in order." \
  || { echo "ERROR: the compiled column list is missing or reordered. Aborting"; exit 1; }
grep -rqF 'nulls:"last"' .next/server 2>/dev/null \
  && echo "      nulls-last ordering compiled in." \
  || { echo "ERROR: nulls-last ordering absent from the bundle. Aborting"; exit 1; }
echo "      sortable header compiled into the bundle."

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
[ "$CODE" = "200" ] && echo "== ACTIONS SORTING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
