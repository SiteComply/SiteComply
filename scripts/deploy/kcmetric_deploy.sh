#!/usr/bin/env bash
# Deploy: remove first-attempt performance from every user-facing surface.
# Storage (schema + attemptService write path) must remain untouched.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/kcmetric_deploy.zip
kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }
code() { python3 - "$1" <<'KCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
KCPY
}
echo "== KNOWLEDGE CHECK METRIC REMOVAL DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# STORAGE MUST BE UNTOUCHED — the metric is retained for historical compatibility.
git diff --quiet HEAD~4 HEAD -- prisma/schema.prisma \
  && echo "      confirmed: prisma/schema.prisma unchanged (metric retained in storage)." \
  || { echo "ERROR: schema changed — storage must be retained. Aborting"; exit 1; }
git diff --quiet HEAD~4 HEAD -- services/knowledgeChecks/attemptService.ts \
  && echo "      confirmed: attemptService still writes the metric." \
  || { echo "ERROR: the write path changed — aborting"; exit 1; }
grep -q 'incorrectFirstTryCount' services/knowledgeChecks/attemptService.ts \
  && echo "      confirmed: incorrectFirstTryCount still recorded." \
  || { echo "ERROR: the metric is no longer written — aborting"; exit 1; }

# NO user-facing surface may read it.
FAIL=""
for f in services/reports/knowledgeCheckReport.ts \
         services/inductionSignature/inductionRecordService.ts \
         app/api/platform/reports/knowledge-checks/export/route.ts \
         app/platform/dashboard/reports/knowledge-checks/page.tsx \
         'app/worker/inductions/[id]/page.tsx'; do
  if code "$f" | grep -qiE 'incorrectFirstTry|firstTryCorrect|firstTryPct|Wrong first try|First-time (pass|score)'; then
    FAIL="$FAIL $f"
  fi
done
[ -z "$FAIL" ] && echo "      confirmed: no reporting or worker-facing file reads the metric." \
  || { echo "ERROR: still referenced in:$FAIL — aborting"; exit 1; }

# What must be PRESERVED.
code app/api/platform/reports/knowledge-checks/export/route.ts | grep -q "'Questions'" \
  && code 'app/worker/inductions/[id]/page.tsx' | grep -q 'Knowledge check' \
  && echo "      confirmed: question counts and the pass outcome retained." \
  || { echo "ERROR: an outcome/count was lost — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
HITS=$(grep -rliE 'wrong first try|first-time pass|first-time score' .next/server .next/static 2>/dev/null | wc -l)
[ "$HITS" -eq 0 ] \
  && echo "      confirmed: the metric's labels appear in NO compiled chunk." \
  || { echo "ERROR: metric labels still in $HITS compiled chunk(s) — aborting"; exit 1; }
grep -rq 'Workers assessed' .next/server .next/static 2>/dev/null \
  && echo "      confirmed: replacement card compiled." \
  || { echo "ERROR: 'Workers assessed' missing from the bundle — aborting"; exit 1; }

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
[ "$CODE" = "200" ] && echo "== KC METRIC REMOVAL DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
