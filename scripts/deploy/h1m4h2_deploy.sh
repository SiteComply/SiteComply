#!/usr/bin/env bash
# Deploy: H1 (unscored audits must not read Fail), M4 (no-data sites must not
# read 0%), H2 (worker header usable on narrow phones).
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/h1m4h2_deploy.zip

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# Comments in these files quote the very strings the guards assert, so SOURCE
# greps run over comment-stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== H1 / M4 / H2 DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/api/platform/reports/org-overview/export/route.ts
app/api/platform/reports/scorecard/export/route.ts
app/platform/dashboard/reports/org-overview/page.tsx
app/platform/dashboard/reports/scorecard/page.tsx
components/worker/CheckOutOfSiteButton.tsx
components/worker/WorkerShell.tsx
scripts/backfill-audit-unscored-result.mjs
services/audits/auditScoringService.ts
services/audits/scoringMath.ts
services/reports/orgOverviewReport.ts
services/reports/reportFormat.ts
services/reports/scorecardReport.ts"
CH=$(git diff --name-only HEAD~1 HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: exactly the twelve intended files changed." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# H1 — passed must be nullable, and the mandatory gate must stay FIRST.
code services/audits/scoringMath.ts | grep -q 'passed: boolean | null' \
  && echo "      H1: ScoreResult.passed is nullable." \
  || { echo "ERROR: passed is not nullable — aborting"; exit 1; }
python3 - <<'PY' || exit 1
import re,sys
s=open('services/audits/scoringMath.ts').read()
s=re.sub(r'(?m)^\s*//.*$','',s)
m=re.search(r'function didPass\(.*?\n\}', s, re.S)
body=m.group(0)
gate=body.find('mandatoryFailureIds.length > 0')
null=body.find('percent === null')
if gate < 0 or null < 0 or gate > null:
    print("ERROR: mandatory gate must precede the null check — aborting"); sys.exit(1)
if 'return null' not in body:
    print("ERROR: didPass never returns null — aborting"); sys.exit(1)
print("      H1: mandatory gate precedes the null check, and null is returned.")
PY
code services/audits/auditScoringService.ts | grep -qF 'result.passed ?? null' \
  && echo "      H1: null persisted to calculatedPassed." \
  || { echo "ERROR: calculatedPassed no longer persists null — aborting"; exit 1; }

# M4 — pct must return null, never 0, in BOTH reports.
for f in services/reports/orgOverviewReport.ts services/reports/scorecardReport.ts; do
  code "$f" | grep -q 'Math.round((n / d) \* 100) : null' \
    || { echo "ERROR: $f still yields 0 for an empty denominator — aborting"; exit 1; }
done
echo "      M4: both reports return null for an empty denominator."
# and no raw interpolation may remain anywhere
if grep -rn 'compliancePct}%\|inductionPct}%' app/ >/dev/null 2>&1; then
  echo "ERROR: a raw pct interpolation survives — would render \"null%\". Aborting"; exit 1; fi
echo "      M4: no raw percentage interpolation left in app/."

# H2 — the header must wrap and its actions must not shrink.
code components/worker/WorkerShell.tsx | grep -qF 'flex-wrap' \
  && code components/worker/WorkerShell.tsx | grep -qF 'sm:w-auto' \
  && echo "      H2: header wraps below sm." \
  || { echo "ERROR: header no longer wraps — aborting"; exit 1; }
code components/worker/CheckOutOfSiteButton.tsx | grep -qF 'whitespace-nowrap' \
  && echo "      H2: check-out button cannot wrap mid-word." \
  || { echo "ERROR: check-out button can wrap — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (written from observed build output)..."
grep -rqF 'calculatedPassed:' .next/server/chunks 2>/dev/null \
  && grep -rq 'calculatedPassed:[a-zA-Z_$]*\.scoringEnabled?[a-zA-Z_$]*\.passed??null:null' .next/server/chunks 2>/dev/null \
  && echo "      H1: nullable persist compiled." \
  || { echo "ERROR: H1 persist not found in the bundle — aborting"; exit 1; }
grep -rqF 'Math.round(e/t*100):null' .next/server 2>/dev/null \
  && echo "      M4: nullable pct compiled." \
  || { echo "ERROR: M4 pct not found in the bundle — aborting"; exit 1; }
grep -rqF 'null===e?"—"' .next/server 2>/dev/null \
  && echo "      M4: em-dash label compiled." \
  || { echo "ERROR: M4 label not found in the bundle — aborting"; exit 1; }
grep -rqF 'flex-wrap items-center justify-between gap-x-3 gap-y-2' .next/server .next/static 2>/dev/null \
  && echo "      H2: wrapping header compiled." \
  || { echo "ERROR: H2 header markup not in the bundle — aborting"; exit 1; }
python3 - <<'PY' || exit 1
import glob,sys
ok=False
for f in glob.glob('.next/static/css/*.css'):
    s=open(f).read(); i=s.find('.sm\\:w-auto')
    if i<0: continue
    j=s.rfind('@media',0,i)
    if j>=0 and 'min-width:640px' in s[j:j+40]: ok=True
print("      H2: sm:w-auto lives inside the 640px breakpoint." if ok
      else "ERROR: sm:w-auto is not inside the sm breakpoint — aborting")
sys.exit(0 if ok else 1)
PY

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
[ "$CODE" = "200" ] && echo "== H1/M4/H2 DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
