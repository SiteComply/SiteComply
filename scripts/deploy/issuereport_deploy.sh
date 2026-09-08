#!/usr/bin/env bash
# Deploy: issue reporting Phase 1 — capture and storage.
#
# THE MIGRATION MUST ALREADY BE APPLIED. This ships code that writes to
# "IssueReport"; without the table the button renders, the dialog opens and
# every submission 500s — a feature that looks like it works and does not, with
# no monitoring to say so. Applied by the owner from the VM before this ran.
#
# Guards written fresh. What must hold: the entry point is in all three shells,
# identity is resolved from the session and never from the body, query strings
# are stripped, and the rate limits are present.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/issuereport_deploy.zip
SVC='services/reports/reportService.ts'
API='app/api/reports/route.ts'
BTN='components/ui/ReportIssueButton.tsx'
DEPLOYED=aa75b65

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# These files explain their own decisions at length, so greps run over
# comment-stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== ISSUE REPORTING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/api/reports/route.ts
components/admin/AdminShell.tsx
components/platform/PlatformShell.tsx
components/ui/Dialog.tsx
components/ui/ReportIssueButton.tsx
components/ui/ReportIssueDialog.tsx
components/worker/WorkerShell.tsx
prisma/migrations/20260908120000_add_issue_reports/migration.sql
prisma/schema.prisma
scripts/deploy/issuereport_deploy.sh
scripts/issuereport_verify.js
services/reports/reportService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the feature, three shells, the migration and the scripts." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# ONE ENTRY POINT, ALL THREE EXPERIENCES.
for f in components/platform/PlatformShell.tsx components/admin/AdminShell.tsx components/worker/WorkerShell.tsx; do
  code "$f" | grep -qF '<ReportIssueButton' \
    || { echo "ERROR: $f has no entry point. Aborting"; exit 1; }
done
echo "      the entry point is in all three shells."

# IDENTITY FROM THE SESSION, NEVER THE BODY. A client that could name itself
# could file a report as somebody else.
for fn in getPlatformSession getAdminSession getWorkerSession; do
  code "$SVC" | grep -qF "$fn" \
    || { echo "ERROR: $SVC does not read $fn. Aborting"; exit 1; }
done
if code "$API" | grep -qE 'reporterName|reporterRole|reporterRef'; then
  echo "ERROR: the route reads reporter identity from the request body. Aborting"; exit 1
fi
code "$API" | grep -qF 'await resolveReporter()' \
  || { echo "ERROR: the route does not resolve the reporter server-side. Aborting"; exit 1; }
code "$API" | grep -qF 'status: 401' \
  || { echo "ERROR: the route does not refuse unauthenticated callers. Aborting"; exit 1; }
echo "      identity comes from the session; unauthenticated callers are refused."

# QUERY STRINGS STRIPPED. A filtered Check-ins URL carries worker names.
code "$SVC" | grep -qF "split('?')[0]" \
  || { echo "ERROR: page paths are not stripped of query strings. Aborting"; exit 1; }
code "$SVC" | grep -qF 'safePagePath(input.pagePath)' \
  || { echo "ERROR: the stored path does not go through safePagePath. Aborting"; exit 1; }
echo "      query strings are dropped before storage."

# RATE LIMITS.
N=$(code "$SVC" | grep -c 'seconds:.*max:')
[ "$N" = "3" ] || { echo "ERROR: found $N rate limits, expected 3. Aborting"; exit 1; }
echo "      three rate-limit windows present."

# THE AGREED VISUAL RULES.
code "$BTN" | grep -qF 'min-[375px]:inline' \
  || { echo "ERROR: the label breakpoint is not 375px. Aborting"; exit 1; }
code "$BTN" | grep -qF 'aria-label="Report an issue or give feedback"' \
  || { echo "ERROR: the accessible name is missing. Aborting"; exit 1; }
code "$BTN" | grep -qF 'M5 21V4M5 5h13l-2.6 4L18 13H5' \
  || { echo "ERROR: the entry point is not the flag icon. Aborting"; exit 1; }
echo "      375px label rule, accessible name and flag icon all in place."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
R=".next/server/app/api/reports/route.js"
[ -f "$R" ] || { echo "ERROR: the reports route was not built. Aborting"; exit 1; }
for want in 'Report an issue' 'M5 21V4M5 5h13l-2.6 4L18 13H5' 'Report an issue or give feedback'; do
  grep -rqF "$want" .next/server .next/static 2>/dev/null \
    || { echo "ERROR: '$want' absent from the bundle. Aborting"; exit 1; }
done
grep -rqF 'IssueReport' .next/server 2>/dev/null \
  || { echo "ERROR: the Prisma model is absent from the server bundle. Aborting"; exit 1; }
echo "      route, flag, accessible name and model all compiled in."

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
[ "$CODE" = "200" ] && echo "== ISSUE REPORTING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
