#!/usr/bin/env bash
# Deploy: Documents presented as ONE logical document (Documents module +
# Worker Portal). Audit findings / action evidence galleries must be untouched.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/docsingle_deploy.zip

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# Strip comments before grepping SOURCE. The explanatory comments in these files
# legitimately quote the very strings the guards assert are gone, so a raw grep
# fails on prose while the code is correct.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== DOCUMENTS SINGLE-ENTRY DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/platform/dashboard/documents/page.tsx
components/platform/DocumentForm.tsx
scripts/backfill-annotated-titles.mjs
services/audits/auditService.ts
services/documents/documentService.ts
services/documents/supersededDocuments.ts"
CH=$(git diff --name-only HEAD~1 HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: exactly the six intended files changed." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# The four leaks must be gone at source.
code components/platform/DocumentForm.tsx | grep -qF '(annotated)' \
  && { echo "ERROR: the (annotated) title suffix is still written on upload — aborting"; exit 1; }
code components/platform/DocumentForm.tsx | grep -qF -- '-annotated.jpg' \
  && { echo "ERROR: the -annotated.jpg file name is still written on upload — aborting"; exit 1; }
code app/platform/dashboard/documents/page.tsx | grep -qF 'Annotated' \
  && { echo "ERROR: the ANNOTATED badge is still in the register — aborting"; exit 1; }
echo "      confirmed: suffix, annotated file name and badge all removed."

# The collapse must be in the QUERY, in the function both count() and list() use.
code services/documents/documentService.ts | grep -q 'async function documentWhere' \
  && code services/documents/documentService.ts | grep -q 'await supersededDocumentIds(siteIds)' \
  && echo "      confirmed: exclusion lives in the shared where-clause." \
  || { echo "ERROR: exclusion is not in documentWhere — count and rows could disagree. Aborting"; exit 1; }
code services/audits/auditService.ts | grep -q 'supersededDocumentIds' \
  && echo "      confirmed: audit document picker follows the same rule." \
  || { echo "ERROR: audit picker would still show both rows — aborting"; exit 1; }

# Annotation must survive at rest AND remain creatable.
grep -qE 'annotated\s+Boolean' prisma/schema.prisma \
  && grep -q 'annotationData' prisma/schema.prisma \
  && grep -q 'originalDocumentId' prisma/schema.prisma \
  && echo "      confirmed: annotation columns retained in the schema." \
  || { echo "ERROR: annotation metadata missing from the schema — aborting"; exit 1; }
grep -q "fd2.set('annotated', 'true')" components/platform/DocumentForm.tsx \
  && grep -q "fd2.set('originalDocumentId', id)" components/platform/DocumentForm.tsx \
  && grep -q "fd2.set('annotationData'" components/platform/DocumentForm.tsx \
  && echo "      confirmed: annotation still created and linked on upload." \
  || { echo "ERROR: annotation creation was broken — aborting"; exit 1; }

# EVIDENCE WORKFLOWS MUST BE BYTE-IDENTICAL.
EV="services/annotations/supersededEvidence.ts services/annotations/supersededEvidenceQuery.ts
services/annotations/annotationUpload.ts services/annotations/annotationTypes.ts
components/platform/EvidenceGallery.tsx components/platform/PendingPhotos.tsx
components/platform/PhotoAnnotator.tsx components/platform/annotatedUpload.ts
services/audits/findingEvidenceService.ts services/actions/actionEvidenceService.ts
components/platform/AuditFindingsPanel.tsx services/closeOut/closeOutService.ts"
for f in $EV; do
  git diff --quiet HEAD~1 HEAD -- "$f" || { echo "ERROR: evidence file changed: $f — aborting"; exit 1; }
done
echo "      confirmed: all 12 evidence-workflow files untouched."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (written from observed build output)..."
# Register page must compile WITHOUT the badge literal.
if grep -qF 'Annotated' .next/server/app/platform/dashboard/documents/page.js 2>/dev/null; then
  echo "ERROR: badge literal present in the compiled register — aborting"; exit 1; fi
echo "      confirmed: no badge literal in the compiled register page."

# The superseded query must be compiled into the server chunks.
grep -rqF 'annotated:!0,originalDocumentId:{not:null}' .next/server/chunks 2>/dev/null \
  && echo "      confirmed: superseded-original query compiled." \
  || { echo "ERROR: superseded query absent from the bundle — aborting"; exit 1; }

# Neither leaked string may survive anywhere in the client bundle.
for s in '(annotated)' '-annotated.jpg'; do
  if grep -rqF "$s" .next/static/chunks 2>/dev/null; then
    echo "ERROR: \"$s\" still present in a client chunk — aborting"; exit 1; fi
done
echo "      confirmed: no annotation strings in any client chunk."

# Annotation upload must still be compiled in.
grep -rqF '"annotated","true"' .next/static/chunks 2>/dev/null \
  && echo "      confirmed: annotated upload still compiled." \
  || { echo "ERROR: annotated upload missing from the bundle — aborting"; exit 1; }

# Evidence gallery copy must still be compiled in.
grep -rqF 'Original photo (kept for audit)' .next/static/chunks 2>/dev/null \
  && grep -rqF 'Annotated photo' .next/static/chunks 2>/dev/null \
  && echo "      confirmed: evidence gallery copy intact in the bundle." \
  || { echo "ERROR: evidence gallery copy missing — aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== DOCUMENTS SINGLE-ENTRY DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
