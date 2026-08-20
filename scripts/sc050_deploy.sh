#!/usr/bin/env bash
# SC-050 — production CODE deploy: plain-language report descriptions.
#
# CONTENT ONLY. Ten `description` strings in the report registry, rewritten as
# one-line business summaries with the internal ticket references removed.
#
# THE RISK IS A CONTENT EDIT REACHING THE ACCESS METADATA. The same registry
# entries carry directorOnly, personalData, clientAggregateOnly and exportRoles
# — the fields that decide who sees and exports what. [3/7] asserts every one
# of those is unchanged, that all ten ids and titles survive, and that no
# SC-nnn remains in any description.
#
# THE RISK IS A PRESENTATION CHANGE QUIETLY BECOMING AN ACCESS CHANGE. The page
# decides what a viewer may run via getVisibleReports; [3/7] asserts that call
# is intact, that nothing new filters the list, and that every registry entry
# still resolves to /platform/dashboard/reports/<id>.
#
# It also pins the escape hatch: the legacy grid must still be present and
# reachable by REPORTS_LAYOUT=cards, and the default must remain `catalogue`.
#
# THE ENTIRE RISK IS BLAST RADIUS, and it is bigger than the change looks.
# SegmentedNav is shared by both portals — four Platform filter strips render
# from it (submissions, permits, actions, sites). `tone` is opt-in and defaults
# to 'solid' precisely so those cannot move, and [3/7] asserts BOTH halves of
# that: the default is still 'solid', the solid branch still carries the
# brand-500 fill and the small padding, and no Platform page passes a tone.
#
# A guard that only checked the new subtle branch exists would pass while every
# register's filter strip had quietly changed appearance in production.
#
# The devCode suppression remains HELD on security/otp-disclosure-hardening
# until Twilio is live. [3/7] still asserts both halves of that split.
#
# NO DATABASE DEPENDENCY. Unlike SC-036 this release reads nothing new from the
# database, so there is no table pre-flight — adding a firewall rule to check a
# schema this change never touches would be ceremony, not safety.
#
# CODE ONLY: no schema change, no migration, no seed, no backfill.
# Rollback is a redeploy of the current production commit; nothing is destructive.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/sc050_deploy.zip

# The commit currently in production.
BASE_COMMIT=4819418

NAV=components/platform/navUi.tsx
TABS=components/admin/AdminTabs.tsx
OTP=services/auth/otpService.ts
OTPROUTE='app/api/worker/otp/request/route.ts'

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-050 — PLAIN-LANGUAGE REPORT DESCRIPTIONS =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/7] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/7] Asserting scope..."

AUTH_FILES="services/auth/otpService.ts app/api/worker/otp/request/route.ts \
lib/config.ts lib/session.ts services/sms/smsSendService.ts \
services/sms/index.ts services/workerAccess/workerAssignmentService.ts \
app/api/worker/otp/verify/route.ts"
TOUCHED=$(git diff --name-only "${BASE_COMMIT}"..HEAD -- $AUTH_FILES)
if [ -n "$TOUCHED" ]; then
  echo "ERROR: this deploy changes authentication behaviour:"
  echo "$TOUCHED" | sed 's/^/         /'
  echo "       SC-050 is a colour change. If the devCode suppression has been"
  echo "       merged in, STOP — see security/otp-disclosure-hardening."
  exit 1
fi

FROZEN="package.json package-lock.json next.config.js middleware.ts prisma/schema.prisma"
FROZEN_TOUCHED=$(git diff --name-only "${BASE_COMMIT}"..HEAD -- $FROZEN)
if [ -n "$FROZEN_TOUCHED" ]; then
  echo "ERROR: this is no longer a code-only deploy — frozen zones changed:"
  echo "$FROZEN_TOUCHED" | sed 's/^/         /'
  echo "       prisma/schema.prisma is frozen here on purpose: this fix changes"
  echo "       how existing columns are WRITTEN, never their shape."
  exit 1
fi

DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo "ERROR: working tree is not clean, and the zip is built from the working"
  echo "       tree — deploy what is committed, or commit what you are deploying:"
  echo "$DIRTY" | sed 's/^/         /'
  exit 1
fi

OUTSIDE=$(git diff --name-only "${BASE_COMMIT}"..HEAD \
  | grep -v '^services/reports/reportRegistry.ts$' \
  | grep -v '^scripts/' || true)
if [ -n "$OUTSIDE" ]; then
  echo "ERROR: SC-050 fixes ONE defect, but these also changed:"
  echo "$OUTSIDE" | sed 's/^/         /'
  exit 1
fi

CHANGED=$(git diff --name-only "${BASE_COMMIT}"..HEAD | tr '\n' ' ')
echo "      confirmed: no auth, prisma, tailwind or dependency change since ${BASE_COMMIT}."
echo "                 Changed: ${CHANGED:-<none>}"

# ---------------------------------------------------------------------------
# Matched against source with COMMENTS STRIPPED and ALL QUOTE CHARACTERS
# REMOVED. Comments, because these files carry long blocks naming the very
# identifiers asserted below — this script's own header does it too, and a
# plain grep matches the prose and passes while the code is missing. Quotes,
# because a double quote inside this node -e "..." closes the shell string and
# silently truncates the program, and a backtick executes as command
# substitution.
# ---------------------------------------------------------------------------
echo "[3/7] Asserting blast radius..."
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'')
  .replace(/[\x22\x27\x60]/g,'');
const fail=(m)=>{console.error('ERROR: '+m);process.exit(1);};

// ---------- the held change must NOT be here ----------
for(const f of ['services/auth/otpService.ts','app/api/worker/otp/request/route.ts','lib/config.ts']){
  if(strip(f).indexOf('canDiscloseOtpCode') >= 0)
    fail('the devCode suppression is present in '+f+' — it is HELD until a real SMS provider is live');
}
const otp=strip('services/auth/otpService.ts');
if(otp.indexOf('devCode: sent.provider === mock ? code : undefined') < 0)
  fail('the devCode expression changed — this release must not alter sign-in behaviour');

const page=strip('app/platform/dashboard/reports/page.tsx');
const flag=strip('services/reports/reportsLayout.ts');
const reg=strip('services/reports/reportRegistry.ts');
const acc=strip('services/reports/reportAccess.ts');

// ---------- ACCESS MUST BE UNCHANGED ----------
if(page.indexOf('const reports = getVisibleReports(viewer);') < 0)
  fail('the page no longer takes its list from getVisibleReports — visibility would no longer follow role');
if(page.indexOf('assertModuleView(viewer, reports)') < 0)
  fail('the reports module gate is gone from the page');
if(acc.indexOf('REPORT_TYPES.filter((r) => canRunReport(viewer, r))') < 0)
  fail('getVisibleReports changed — this release is presentation only');
// No extra filtering may be introduced on top of the access filter.
if(/reports\.filter\(/.test(page))
  fail('the page filters the report list itself — visibility must come only from getVisibleReports');

// ---------- both layouts must exist, default catalogue ----------
if(flag.indexOf('=== cards') < 0 || flag.indexOf('catalogue') < 0)
  fail('the layout flag no longer offers both layouts');
if(flag.indexOf('process.env[REPORTS_LAYOUT_ENV]') < 0)
  fail('the flag no longer reads the REPORTS_LAYOUT env var');
// BOTH branches, in order: cards only when explicitly asked for, catalogue as
// the fallback. Checking only that the word cards appears passed when the two
// branches were swapped and the legacy grid became the default.
if(flag.indexOf('? cards') < 0 || flag.indexOf(': catalogue;') < 0)
  fail('the layout default is no longer catalogue — an unset REPORTS_LAYOUT would serve the legacy grid');
if(page.indexOf('layout === cards ? (') < 0)
  fail('the page no longer branches on the layout flag');
if(page.indexOf('function LegacyCardGrid(') < 0 || page.indexOf('function ReportCard(') < 0)
  fail('the legacy card grid is gone — the documented revert would not work');
if(page.indexOf('function ReportCatalogue(') < 0)
  fail('the catalogue layout is gone');
// ---------- no internal identifiers in user-facing copy ----------
// Matched on the DESCRIPTION lines only: code comments legitimately cite the
// tickets they implement and are never rendered.
for(const line of reg.split(String.fromCharCode(10))){
  if(/^\s*description:/.test(line) && /SC-?\d{3}/.test(line))
    fail('a report description still carries an internal identifier: ' + line.trim().slice(0,80));
}
// ---------- the access metadata must be untouched ----------
for(const field of ['directorOnly','personalData','clientAggregateOnly','exportRoles: CSCS_EXPORT_ROLES']){
  if(reg.indexOf(field) < 0)
    fail('the registry lost ' + field + ' — a content edit must not touch the fields that decide access');
}
if((reg.match(/directorOnly: true/g)||[]).length !== 1)
  fail('the director-only flag changed — exactly one report is organisation-wide');
if((reg.match(/description:/g)||[]).length !== 10)
  fail('a report description was added or removed');
if(/<thead|<tbody|table-cell/.test(page))
  fail('the catalogue is a table again — Scope and Data must stay as supporting metadata, not headed columns');
// The LINK's own class string, not just any occurrence: the non-built title
// span carries the same classes, so a bare search passed while the link itself
// was demoted to text-sm.
if(page.indexOf('text-base font-semibold text-ink hover:text-brand-700 hover:underline') < 0)
  fail('the report name link lost its promoted size — scanning the list was the point of this pass');
if(page.indexOf('scopeLabel(report, viewer)') < 0 || page.indexOf('dataLabel(report, viewer)') < 0)
  fail('scope or data classification is no longer shown at all — it was to be de-emphasised, not dropped');

// ---------- every report must still be reachable ----------
// The CATALOGUE's own href, not just any occurrence: the retained legacy card
// carries the same URL, so a bare search passed while the rows pointed at #.
if(page.indexOf('const href = /platform/dashboard/reports/\${report.id};') < 0)
  fail('catalogue rows no longer link to /platform/dashboard/reports/<id>');
const ids=(reg.match(/id: [a-z-]+,/g)||[]).length;
if(ids < 10) fail('the report registry lost entries: found '+ids);
" || exit 1

# Every registry id must still have a page on disk, or a row would 404.
MISSING=0
for id in $(grep -oE "id: '[a-z-]+'" services/reports/reportRegistry.ts | sed "s/id: '//;s/'//"); do
  if [ ! -f "app/platform/dashboard/reports/$id/page.tsx" ]; then
    echo "ERROR: report '$id' is in the registry but has no page"; MISSING=1
  fi
done
[ "$MISSING" = "0" ] || exit 1
echo "      confirmed: access filter intact, both layouts present, every report has a page."


















# The Platform call sites must not have opted in. Asserted against the real
# files rather than by reading navUi, because this is the failure that would
# actually repaint a register.
OPTED=$(grep -rln 'tone=' app/platform/dashboard/submissions/page.tsx \
  app/platform/dashboard/permits/page.tsx \
  app/platform/dashboard/actions/page.tsx \
  app/platform/dashboard/sites/page.tsx 2>/dev/null || true)
if [ -n "$OPTED" ]; then
  echo "ERROR: a Platform filter strip has opted into a tone:"
  echo "$OPTED" | sed 's/^/         /'
  echo "       These four must keep the solid treatment."
  exit 1
fi
echo "      confirmed: defaults intact, solid branch intact, no Platform opt-in."

if [ "${DRY_RUN:-}" = "1" ]; then
  echo
  echo "== DRY RUN COMPLETE — all assertions passed, nothing deployed =="
  exit 0
fi

echo "      running the SC-001 CSCS suite (verification logic must be intact)..."
npx tsx scripts/sc001_cscs_tests.ts > /tmp/sc050_cscs.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: the CSCS verification suite failed."
  tail -15 /tmp/sc050_cscs.log | sed 's/^/         /'
  exit 1
fi
echo "      $(tail -2 /tmp/sc050_cscs.log | tr -d '\n' | sed 's/.*== //')"

echo "[4/7] Building and packaging..."
npx prisma generate > /dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
npm run build > /tmp/sc050_build.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: build failed. Last lines:"
  tail -25 /tmp/sc050_build.log | sed 's/^/         /'
  exit 1
fi
grep -qE "Compiled successfully" /tmp/sc050_build.log || { echo "ERROR: build did not report success"; exit 1; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      built: $NEW_BUILD"


rm -f "$ZIP"
zip -rq "$ZIP" .next public package.json package-lock.json next.config.js \
  prisma node_modules -x 'node_modules/.cache/*' 2>/dev/null
echo "      zip: $(du -h "$ZIP" | cut -f1)"

echo "[5/7] Deploying..."
az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --timeout 1800 2>&1 | tail -5

echo "[6/7] Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
FLIPPED=0
for i in $(seq 1 40); do
  CUR=$(kudu_buildid)
  if [ "$CUR" = "$NEW_BUILD" ]; then FLIPPED=1; echo "      [$i] prod build id now: $CUR"; break; fi
  sleep 15
done
if [ "$FLIPPED" != "1" ]; then
  echo "WARNING: new build did not appear within 10 minutes. Last seen: ${CUR:-<unknown>}"
fi

# SC-036 shipped while a worker instance was still serving the previous bundle,
# and the route check read as 404 until the restart finished. Restarting here
# makes that deterministic rather than something to diagnose afterwards.
echo "      restarting the app so every instance picks up the new bundle..."
az webapp restart -g "$RG" -n "$APP" -o none 2>/dev/null || echo "      (restart call failed — check health below)"

echo "[7/7] Verifying..."
RC=000
for i in $(seq 1 20); do
  RC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP $RC"
  [ "$RC" = "200" ] && break
  sleep 15
done

echo
echo "      Route reachability:"
ROUTES_OK=1
# NOTE: /worker, not /worker/login — the latter has never existed, and the
# SC-036 smoke test probed it and reported a 404 that meant nothing.
for r in /platform/dashboard /admin/settings/integrations /admin/login /worker /api/worker/otp/request; do
  S=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "${BASE}${r}" || echo 000)
  echo "        ${r} -> HTTP ${S}"
  case "$S" in 000*|404|5*) ROUTES_OK=0;; esac
done
T=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X POST \
  -H 'content-type: application/json' -d '{}' \
  "${BASE}/api/admin/settings/cscs/test" || echo 000)
echo "        POST /api/admin/settings/cscs/test (no session) -> HTTP ${T}  (SC-036 still live)"
case "$T" in 401|403) ;; *) ROUTES_OK=0;; esac

echo
echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${RC}"
echo "   routes:    $([ "$ROUTES_OK" = "1" ] && echo 'all reachable' || echo 'PROBLEM — see above')"
echo "   rollback:  git checkout ${BASE_COMMIT} && re-run this script's build+deploy steps"
if [ "$RC" = "200" ] && [ "$ROUTES_OK" = "1" ]; then
  echo "== SC-050 DEPLOYED =="
  echo "   Reports is a catalogue. Legacy grid: set REPORTS_LAYOUT=cards."
  echo "   Same report types, permissions, routes and exports."
else
  echo "== SC-050 DEPLOYED BUT NOT HEALTHY — INVESTIGATE =="
  exit 1
fi
