#!/usr/bin/env bash
# Deploy: one logical document everywhere documents are consumed (M3).
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/docpairing_deploy.zip
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
echo "== DOCUMENT PAIRING (M3) DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="services/closeOut/closeOutArchive.ts
services/closeOut/closeOutService.ts
services/dashboard/recentActivity.ts
services/documents/documentExpiryNotifications.ts
services/projectClosure/closureChecklist.ts"
CH=$(git diff --name-only HEAD~1 HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: exactly the five intended files changed." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# Every consuming surface must apply the rule. A silently-unpatched file is the
# failure mode this whole change exists to prevent, and one combined patch script
# already left two files behind once.
MISSING=0
for f in $EXPECTED; do
  code "$f" | grep -q 'supersededDocumentIds(' \
    || { echo "ERROR: $f does not apply the pairing rule"; MISSING=1; }
done
[ "$MISSING" = "0" ] && echo "      all five consuming surfaces apply supersededDocumentIds." || exit 1

# closeOutService has TWO sites (count and rows); both must have it.
[ "$(code services/closeOut/closeOutService.ts | grep -c 'supersededDocumentIds(')" = "2" ] \
  && echo "      close-out: both the count and the row list are filtered." \
  || { echo "ERROR: close-out count and rows must BOTH filter, or they disagree. Aborting"; exit 1; }

# The three id-fetch paths must NOT be filtered: a superseded original has to stay
# reachable by direct id, or "retained, just not presented" stops being true.
for f in services/documents/documentService.ts services/workerDashboard/workerDashboardService.ts; do
  code "$f" | grep -A6 'findFirst({' | grep -q 'notIn' \
    && { echo "ERROR: an id-fetch path is filtering — direct access would break. Aborting"; exit 1; }
done
code services/audits/auditService.ts | grep -A6 'id: { in: documentIds }' | grep -q 'notIn' \
  && { echo "ERROR: audit id validation is filtering — aborting"; exit 1; }
echo "      direct-id access left unfiltered (detail, download, audit validation)."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (written from observed build output)..."
for r in "sites/[id]/close-out/route.js" "sites/[id]/completion/route.js" "sites/[id]/close-out/[packId]/archive/route.js"; do
  f=".next/server/app/api/platform/$r"
  grep -qF 'annotated:!0,originalDocumentId:{not:null}' "$f" 2>/dev/null \
    && echo "      compiled into $r" \
    || { echo "ERROR: pairing query absent from $r — aborting"; exit 1; }
done

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
[ "$CODE" = "200" ] && echo "== DOCUMENT PAIRING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
