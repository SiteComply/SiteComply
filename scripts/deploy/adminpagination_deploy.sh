#!/usr/bin/env bash
# Deploy: Admin Check-ins pagination.
#
# Guards written fresh. What must hold: the cap is gone, the page is paginated,
# the ordering is TOTAL (a non-unique sort is what makes paging drop and repeat
# rows, and it is invisible until someone checks in a gang), the export stays
# uncapped, and the five platform lists still get the control from its new home.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/adminpagination_deploy.zip
SVC='services/submissions/submissionQueryService.ts'
PAGE='app/admin/(dashboard)/submissions/page.tsx'
DEPLOYED=aeff0e6

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# Both files explain the OLD cap in comments, so greps run over stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== ADMIN PAGINATION DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/admin/(dashboard)/submissions/page.tsx
app/platform/dashboard/actions/page.tsx
app/platform/dashboard/audits/page.tsx
app/platform/dashboard/documents/page.tsx
app/platform/dashboard/permits/page.tsx
app/platform/dashboard/submissions/page.tsx
components/platform/PaginationControls.tsx
components/ui/PaginationControls.tsx
scripts/adminpagination_verify.js
scripts/deploy/adminpagination_deploy.sh
services/submissions/submissionQueryService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the admin page, the service, the moved control, its five callers." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# THE CAP IS GONE.
! code "$SVC" | grep -q 'LIST_MAX_ROWS' \
  || { echo "ERROR: the 1,000-row cap is still in the service. Aborting"; exit 1; }
! code "$SVC" | grep -q 'listCap' \
  || { echo "ERROR: listCap() still exists. Aborting"; exit 1; }
! code "$PAGE" | grep -q 'Showing the first' \
  || { echo "ERROR: the truncation caveat is still rendered. Aborting"; exit 1; }
echo "      the cap and its messaging are gone."

# TOTAL ORDERING on both the list and the export. This is the guard that matters
# most: without it paging silently repeats and drops rows.
LIST_OB=$(code "$SVC" | grep -c "orderBy: \[{ checkedInAt: 'desc' }, { id: 'asc' }\]")
[ "$LIST_OB" = "2" ] \
  || { echo "ERROR: found $LIST_OB total orderings, expected 2 (list + export). Aborting"; exit 1; }
! code "$SVC" | grep -q "orderBy: { checkedInAt: 'desc' }," \
  || { echo "ERROR: a bare non-unique orderBy remains — paging would drop rows. Aborting"; exit 1; }
echo "      list and export both order by [checkedInAt desc, id asc]."

# PAGINATED, using the shared helpers.
code "$PAGE" | grep -qF 'resolvePage(searchParams.page, total)' \
  || { echo "ERROR: the page does not resolve paging bounds. Aborting"; exit 1; }
code "$PAGE" | grep -qF 'querySubmissions(filters, { skip: pg.skip, take: pg.take })' \
  || { echo "ERROR: the page does not pass paging to the query. Aborting"; exit 1; }
code "$PAGE" | grep -qF '<PaginationControls' \
  || { echo "ERROR: the pagination bar is not rendered. Aborting"; exit 1; }
echo "      the admin page paginates through the shared helpers."

# THE EXPORT STAYS WHOLE.
code "$SVC" | grep -q 'querySubmissionsForExport' \
  || { echo "ERROR: the export query is gone. Aborting"; exit 1; }
if code "$SVC" | sed -n '/querySubmissionsForExport/,/^}/p' | grep -qE 'take:|skip:'; then
  echo "ERROR: the export query has been paginated — the CSV would be a page. Aborting"; exit 1
fi
echo "      the export query is still uncapped and unpaged."

# REUSE, NOT DUPLICATION: one component, five platform callers repointed.
[ -f components/ui/PaginationControls.tsx ] \
  || { echo "ERROR: the shared control is missing. Aborting"; exit 1; }
[ -f components/platform/PaginationControls.tsx ] \
  && { echo "ERROR: the old copy is still there — two implementations will drift. Aborting"; exit 1; }
N=$(grep -rl "@/components/ui/PaginationControls" app | wc -l)
[ "$N" = "6" ] \
  || { echo "ERROR: $N pages import the shared control, expected 6 (5 platform + admin). Aborting"; exit 1; }
! grep -rq "@/components/platform/PaginationControls" app \
  || { echo "ERROR: something still imports the old path. Aborting"; exit 1; }
echo "      one control, six callers, no stale imports."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
A=".next/server/app/admin/(dashboard)/submissions/page.js"
[ -f "$A" ] || A=$(find .next/server/app/admin -name 'page.js' -path '*submissions*' | head -1)
[ -n "$A" ] && [ -f "$A" ] || { echo "ERROR: the admin submissions page was not built. Aborting"; exit 1; }
! grep -qF 'Showing the first' "$A" \
  || { echo "ERROR: the truncation caveat is compiled in. Aborting"; exit 1; }
grep -rqF 'Showing' .next/server .next/static 2>/dev/null \
  || { echo "ERROR: the pagination bar is absent from the bundle. Aborting"; exit 1; }
echo "      built admin page carries the pagination bar, not the caveat."

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
[ "$CODE" = "200" ] && echo "== ADMIN PAGINATION DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
