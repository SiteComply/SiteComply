#!/usr/bin/env bash
# Deploy: sortable columns on Platform → Check-ins.
#
# The guards here are about the two ways sorting ships broken in a way that
# still LOOKS fine: a missing tiebreaker (invisible until you page through a
# tied sort) and a sort param dropped by one of the several places that rebuild
# the query string (invisible until you click that particular control).
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/checkinsort_deploy.zip
SORT='services/submissions/checkinSort.ts'
PAGE='app/platform/dashboard/submissions/page.tsx'
EXPORT_ROUTE='app/api/platform/submissions/export/route.ts'
CHUNK='.next/server/app/platform/dashboard/submissions/page.js'
DEPLOYED=5b1f129

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

echo "== CHECK-INS SORTING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/api/platform/submissions/export/route.ts
app/platform/dashboard/submissions/page.tsx
scripts/checkinsort_integrity.js
scripts/checkinsort_responsive.js
scripts/checkinsort_verify.js
services/submissions/checkinFilter.ts
services/submissions/checkinListService.ts
services/submissions/checkinSort.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: exactly the eight intended files changed." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# THE TIEBREAKER. Every branch of checkinOrderBy must end with the unique id, or
# paging a tied sort silently duplicates and drops rows.
BRANCHES=$(code "$SORT" | grep -c "tiebreak")
[ "$BRANCHES" -ge 5 ] \
  && echo "      id tiebreaker present on every orderBy branch ($BRANCHES references)." \
  || { echo "ERROR: tiebreaker missing from an orderBy branch. Aborting"; exit 1; }
code "$SORT" | grep -q "id: 'asc' as const" \
  || { echo "ERROR: the tiebreaker is not the unique id. Aborting"; exit 1; }

# STATUS MUST SORT ON checkedOutAt, NOT the SubmissionStatus enum.
code "$SORT" | grep -q "checkedOutAt: { sort: dir, nulls:" \
  || { echo "ERROR: status sort is not ordering on checkedOutAt nulls. Aborting"; exit 1; }
code "$SORT" | grep -qE "\{ status: (dir|'asc'|'desc')" \
  && { echo "ERROR: sorting on Submission.status — that is the induction enum. Aborting"; exit 1; }
echo "      status sorts on checkedOutAt null-ness, not the induction enum."

# THE SORT MUST BE CARRIED BY EVERY QUERY-STRING BUILDER ON THE PAGE.
CARRIERS=$(code "$PAGE" | grep -c "checkinSortParams(sort)")
[ "$CARRIERS" -ge 3 ] \
  && echo "      sort carried by the page's query builders ($CARRIERS sites)." \
  || { echo "ERROR: only $CARRIERS carrier(s) — a control would drop the sort. Aborting"; exit 1; }
code "$PAGE" | grep -q "whitespace-nowrap" \
  || { echo "ERROR: header nowrap missing — the header wraps with the rail open. Aborting"; exit 1; }
code "$PAGE" | grep -q "aria-sort" \
  || { echo "ERROR: aria-sort missing from the headers. Aborting"; exit 1; }

# THE EXPORT MUST FOLLOW THE SCREEN.
code "$EXPORT_ROUTE" | grep -q "checkinOrderBy(sort)" \
  || { echo "ERROR: export does not honour the active sort. Aborting"; exit 1; }
code "$EXPORT_ROUTE" | grep -q "orderBy: { checkedInAt: 'desc' }" \
  && { echo "ERROR: export still hardcodes newest-first. Aborting"; exit 1; }
echo "      export follows the active sort."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (compiled check-ins chunk)..."
[ -f "$CHUNK" ] || { echo "ERROR: check-ins chunk not built at $CHUNK. Aborting"; exit 1; }
for want in 'aria-sort' 'whitespace-nowrap' 'Checked in'; do
  grep -qF "$want" "$CHUNK" || { echo "ERROR: '$want' absent from the compiled chunk — stale .next? Aborting"; exit 1; }
done
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
[ "$CODE" = "200" ] && echo "== CHECK-INS SORTING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
