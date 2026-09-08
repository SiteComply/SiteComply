#!/usr/bin/env bash
# Deploy: issue report delivery (Phase 2), SHIPPED DARK.
#
# The whole point of this deploy is that it changes nothing a user can see and
# nothing that runs, until app settings are added after the Entra setup. So the
# guards are mostly ABSENCE guards, each paired with a presence guard so an empty
# read cannot pass as green:
#
#   - no REPORT_MAIL_* credential in source, and mail must resolve to OFF;
#   - the capture path, the dialog, the button and the three shells byte-identical
#     to what is already deployed;
#   - the schema untouched, because a schema change would mean the user has to run
#     another migration and this deploy would break production until they did;
#   - delivery never awaited in the request path.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/reportphase2_deploy.zip
DEPLOYED=3e27394

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

die() { echo "ERROR: $1. Aborting"; exit 1; }

echo "== ISSUE REPORT DELIVERY (PHASE 2) DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/8] SOURCE guards..."
EXPECTED=".env.example
app/api/reports/route.ts
app/api/system/compliance/tick/route.ts
app/api/system/reports/deliver/route.ts
azure/scheduler-function/src/functions/reportDelivery.js
docs/ISSUE-REPORTING.md
lib/schedulerAuth.ts
scripts/deploy/reportphase2_deploy.sh
scripts/reportdelivery_verify.ts
services/reports/reportDelivery.ts
services/reports/reportMailer.ts
services/reports/reportService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: delivery only. No UI, no dialog, no schema." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- Nothing a user touches has changed. Byte-identical to the deployed commit.
for f in components/ui/ReportIssueDialog.tsx components/ui/ReportIssueButton.tsx \
         components/worker/WorkerShell.tsx components/platform/PlatformShell.tsx \
         components/admin/AdminShell.tsx prisma/schema.prisma; do
  git diff --quiet "$DEPLOYED" HEAD -- "$f" || die "$f changed; this deploy must not touch it"
done
echo "      the button, the dialog, all three shells and the schema are unchanged."

# The schema guard above is only meaningful if the schema is really where the
# model lives — assert the model is present, so a moved file cannot pass silently.
grep -q 'model IssueReport' prisma/schema.prisma || die "IssueReport model not found in the schema"
grep -q 'IssueReportDelivery' prisma/schema.prisma || die "the delivery enum is not in the schema"
echo "      the IssueReport model and its delivery enum are present and untouched."

# --- Ships dark: no credential in source, and mail resolves to OFF.
for v in REPORT_MAIL_TENANT_ID REPORT_MAIL_CLIENT_ID REPORT_MAIL_CLIENT_SECRET; do
  # .env.example declares the names with empty values; a VALUE would be a leak.
  if grep -rn "${v}\s*=\s*[\"'][^\"']\+" --include=*.ts --include=*.tsx --include=*.js . \
       --exclude-dir=node_modules --exclude-dir=.next | grep -q .; then
    die "a value for $v is hardcoded in source"
  fi
done
grep -q 'REPORT_MAIL_TENANT_ID' services/reports/reportMailer.ts || die "the mailer does not read its config"
echo "      no credential in source, and the mailer reads all of it from the environment."

# Config is all-or-nothing: a partial set must be OFF, not half-configured.
npx tsx -e '
process.env.REPORT_MAIL_TENANT_ID = "t";
process.env.REPORT_MAIL_CLIENT_ID = "c";
delete process.env.REPORT_MAIL_CLIENT_SECRET;
delete process.env.REPORT_MAIL_FROM;
delete process.env.REPORT_MAIL_TO;
const { mailerEnabled } = require("./services/reports/reportMailer");
if (mailerEnabled()) { console.error("partial config reported as enabled"); process.exit(1); }
' >/dev/null 2>&1 || die "a partial mail configuration does not resolve to OFF"
echo "      a partial configuration resolves to OFF, not half-configured."

# --- Delivery must never block or fail a submission.
code app/api/reports/route.ts | grep -q 'deliverInBackground(result.id)' \
  || die "the route does not kick off delivery"
code app/api/reports/route.ts | grep -q 'await deliver' \
  && die "the route AWAITS delivery; a submission must not wait on the mailbox"
code services/reports/reportDelivery.ts | grep -q 'void deliverReport(id).catch' \
  || die "deliverInBackground does not swallow its rejection"
echo "      delivery is fired after the row exists and is never awaited."

# --- The capture service must not have grown a dependency on mail.
code services/reports/reportService.ts | grep -qE "reportDelivery|reportMailer|sendMail" \
  && die "the capture service now depends on delivery; storage must not be able to fail on mail"
grep -q 'export async function createIssueReport' services/reports/reportService.ts \
  || die "createIssueReport is missing from the capture service"
echo "      capture still has no dependency on mail."

# --- One timing-safe comparison, in one place.
N=$(grep -rl 'diff |= ' --include=*.ts app lib services | wc -l)
[ "$N" = "1" ] || die "expected exactly 1 timing-safe comparison, found $N"
grep -q 'diff |= ' lib/schedulerAuth.ts || die "the timing-safe comparison is not in lib/schedulerAuth.ts"
code app/api/system/compliance/tick/route.ts | grep -q 'authoriseScheduler(req)' \
  || die "the tick route no longer uses the shared guard"
code app/api/system/reports/deliver/route.ts | grep -q 'authoriseScheduler(req)' \
  || die "the sweep route is not guarded"
echo "      one timing-safe comparison, shared by both machine endpoints."

# --- The sweep must not resend or retry forever.
code services/reports/reportDelivery.ts | grep -q "deliveryStatus === IssueReportDelivery.SENT) return 'skipped'" \
  || die "an already-sent report is not skipped"
code services/reports/reportDelivery.ts | grep -q 'deliveryAttempts: { lt: MAX_ATTEMPTS }' \
  || die "the sweep does not bound attempts"
echo "      a sent report is never resent, and retries are bounded."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"

echo "[4/8] Building..."
npm run build 2>&1 | tail -4
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
[ -f .next/server/app/api/system/reports/deliver/route.js ] || die "the sweep route did not compile"
grep -q 'graph.microsoft.com' .next/server/app/api/reports/route.js .next/server/chunks/*.js 2>/dev/null \
  || grep -rq 'graph.microsoft.com' .next/server/ || die "the Graph transport is not in the build"
# And the dark property, in the artifact rather than the source.
grep -rq 'REPORT_MAIL_TENANT_ID' .next/server/ || die "the mailer config is not in the build"
echo "      the sweep route, the Graph transport and the config lookup all compiled in."

echo "[5/8] Packaging zip..."
rm -f "$ZIP"; zip -qr "$ZIP" .next public package.json package-lock.json node_modules prisma next.config.js \
  -x "node_modules/.cache/*" || die "zip failed"
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Confirming production mail settings are absent (this deploy must land dark)..."
SET=$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?starts_with(name,'REPORT_MAIL')].name" -o tsv 2>/dev/null)
[ -z "$SET" ] && echo "      confirmed: no REPORT_MAIL_* settings in production. Delivery will stay off." \
  || echo "      NOTE: production already carries: $SET — delivery will be LIVE on restart."

echo "[7/8] Deploying..."
az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --async false || die "deploy failed"

echo "[8/8] Waiting for BUILD_ID $NEW_BUILD..."
for i in $(seq 1 30); do
  CUR=$(kudu_buildid); echo "      [$i] prod build id now: ${CUR:-<none>}"
  [ "$CUR" = "$NEW_BUILD" ] && { echo "      new build landed on disk."; break; }
  sleep 10
done
[ "$(kudu_buildid)" = "$NEW_BUILD" ] || die "the new build never landed"

for i in $(seq 1 30); do
  H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH"); echo "      [$i] health: HTTP $H"
  [ "$H" = "200" ] && break; sleep 10
done

echo "== DEPLOY SUMMARY =="
echo "   old build: $OLD_BUILD"
echo "   new build: $NEW_BUILD"
echo "   health:    HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH")"
echo "== PHASE 2 DEPLOY COMPLETE (dark until app settings are added) =="
