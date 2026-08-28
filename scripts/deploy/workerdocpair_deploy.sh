#!/usr/bin/env bash
# Deploy: worker-facing pairing of original/annotated documents.
# Platform views, storage, versioning and annotation metadata must be untouched.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/workerdocpair_deploy.zip
SVC=services/workerDashboard/workerDashboardService.ts
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
echo "== WORKER DOCUMENT PAIRING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# ONLY the worker service may change.
CH=$(git diff --name-only HEAD~1 HEAD)
[ "$CH" = "$SVC" ] && echo "      confirmed: only the worker service changed." \
  || { echo "ERROR: unexpected files changed: $CH — aborting"; exit 1; }

# PLATFORM SIDE MUST BE INTACT — badge, suffix-on-upload, schema.
grep -qF 'Annotated' app/platform/dashboard/documents/page.tsx \
  && echo "      confirmed: platform Annotated badge still present." \
  || { echo "ERROR: the platform badge was removed — aborting"; exit 1; }
grep -qF '(annotated)' components/platform/DocumentForm.tsx \
  && echo "      confirmed: suffix still written on upload (managers keep it)." \
  || { echo "ERROR: the upload suffix was removed — aborting"; exit 1; }
grep -qE 'annotated\s+Boolean' prisma/schema.prisma && grep -q 'annotationData' prisma/schema.prisma \
  && echo "      confirmed: annotation metadata retained in the schema." \
  || { echo "ERROR: annotation metadata missing from the schema — aborting"; exit 1; }

# WORKER SIDE — pairing, title cleaning, and counts that agree with the lists.
for fn in pairAnnotated cleanWorkerTitle countWorkerDocuments; do
  code "$SVC" | grep -q "$fn" || { echo "ERROR: $fn missing — aborting"; exit 1; }
done
echo "      confirmed: pairing, title cleaning and paired counts present."

# The annotated copy must WIN — the original is what gets dropped.
code "$SVC" | grep -q 'supersededIds.has(d.id)' \
  && echo "      confirmed: the original is suppressed, annotated copy wins." \
  || { echo "ERROR: precedence logic missing — aborting"; exit 1; }

# The dashboard must NOT be back on a plain document count().
if code "$SVC" | grep -q 'prisma.document.count'; then
  echo "ERROR: a plain document count() is back — counts would double-count pairs. Aborting"; exit 1
fi
echo "      confirmed: dashboard counts use the paired helper."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
grep -rq 'Annotated' .next/server/app/platform/dashboard/documents 2>/dev/null \
  && echo "      confirmed: platform badge compiled." \
  || { echo "ERROR: platform badge absent from the bundle — aborting"; exit 1; }
[ -f '.next/server/app/worker/documents/page.js' ] && [ -f '.next/server/app/worker/rams/page.js' ] \
  && echo "      confirmed: both worker document routes compiled." \
  || { echo "ERROR: a worker document route did not compile — aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== WORKER DOC PAIRING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
