#!/usr/bin/env bash
# Deploy: pagination stability across the Actions, Audits, Documents and Permits
# registers. A DEFECT CORRECTION, deliberately shipped on its own rather than
# bundled with the Actions sorting feature that follows it.
#
# The guards are shaped by what makes this defect dangerous: it is invisible.
# A missing tiebreaker changes nothing you can see on page one, so "it renders"
# proves nothing. The assertions below are about the ORDER BY clauses
# themselves, in source and again in the compiled bundle.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/registertiebreak_deploy.zip
DEPLOYED=edfe3a0

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== REGISTER PAGINATION STABILITY DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="scripts/register_pagination_verify.js
services/actions/actionService.ts
services/audits/auditService.ts
services/documents/documentService.ts
services/permits/permitAdminService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: exactly the four services plus its verifier changed." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# This deploy must NOT contain the Actions sorting feature.
git merge-base --is-ancestor 5061c98 HEAD 2>/dev/null \
  && { echo "ERROR: Actions sorting is in this build — the fix must ship alone. Aborting"; exit 1; }
[ -f services/actions/actionSort.ts ] \
  && { echo "ERROR: actionSort.ts present — sorting has leaked into the defect fix. Aborting"; exit 1; }
echo "      Actions sorting is NOT in this build, as intended."

# Each paginated list query must end in the unique id.
for f in services/actions/actionService.ts services/audits/auditService.ts \
         services/documents/documentService.ts services/permits/permitAdminService.ts; do
  code "$f" | grep -qE "\{ id: 'asc' \}\],\s*$|\{ id: 'asc' \}\]," \
    || { echo "ERROR: $f has no id tiebreaker. Aborting"; exit 1; }
done
echo "      all four services carry the id tiebreaker."

# And the un-tiebroken forms must be gone from the PAGINATED queries. Each of
# these appeared immediately above a `skip:` line, which is what makes it the
# paginated one rather than a top-N query that legitimately has no skip.
for f in services/audits/auditService.ts services/documents/documentService.ts; do
  code "$f" | grep -A1 "orderBy: { createdAt: 'desc' }," | grep -q "skip:" \
    && { echo "ERROR: $f still pages on an un-tiebroken orderBy. Aborting"; exit 1; }
done
echo "      no paginated query left on an un-tiebroken ordering."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (patterns read off the observed build output)..."
A=$(grep -rhoF 'orderBy:[{dueDate:"asc"},{createdAt:"desc"},{id:"asc"}]' .next/server 2>/dev/null | wc -l)
B=$(grep -rhoF 'orderBy:[{createdAt:"desc"},{id:"asc"}]' .next/server 2>/dev/null | wc -l)
[ "$A" -ge 1 ] && echo "      Actions register ordering compiled with the tiebreaker ($A)." \
  || { echo "ERROR: Actions ordering absent from the bundle. Aborting"; exit 1; }
[ "$B" -ge 3 ] && echo "      Audits/Documents/Permits orderings compiled with the tiebreaker ($B)." \
  || { echo "ERROR: only $B tiebroken createdAt orderings compiled, expected at least 3. Aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== PAGINATION STABILITY DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
