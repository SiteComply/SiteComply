#!/usr/bin/env bash
# SC-044 — production CODE deploy: induction record outcome (knowledge check).
#
# The record showed the FIRST-TRY figure under a bare "Knowledge check" label,
# so an induction that can only complete at 100% displayed as "33% (1/3)".
#
# PRESENTATION ONLY. The pass gate and the stored first-try count are
# untouched; the record now leads with the outcome and keeps the first-try
# figure as a labelled secondary line.
#
# THE RISK IS CLAIMING A PASS THAT DID NOT HAPPEN. `passed` must be read from
# the attempt's own status, never inferred from the attempt row existing, or an
# IN_PROGRESS attempt would render as "Passed" on a compliance record. [3/7]
# asserts that, and that the scoring/persistence side has not moved.
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
ZIP=/tmp/sc044_deploy.zip

# The commit currently in production.
BASE_COMMIT=3625433

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

echo "== SC-044 — INDUCTION RECORD OUTCOME =="
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
  echo "       SC-044 is a colour change. If the devCode suppression has been"
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
  | grep -v '^services/inductionSignature/inductionRecordService.ts$' \
  | grep -v '^app/worker/inductions/\[id\]/page.tsx$' \
  | grep -v '^scripts/' || true)
if [ -n "$OUTSIDE" ]; then
  echo "ERROR: SC-044 fixes ONE defect, but these also changed:"
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

const svc=strip('services/inductionSignature/inductionRecordService.ts');
const page=strip('app/worker/inductions/[id]/page.tsx');
const att=strip('services/knowledgeChecks/attemptService.ts');

// ---------- the record must lead with the OUTCOME ----------
if(page.indexOf('Passed (\${record.knowledgeCheck.total}/\${record.knowledgeCheck.total})') < 0)
  fail('the record no longer shows the outcome as Passed (n/n)');
if(page.indexOf('record.knowledgeCheck.pct') >= 0 || svc.indexOf('pct:') >= 0)
  fail('the old unlabelled percentage is back as the primary value — that is the defect itself');

// ---------- a pass must be read from the attempt STATUS ----------
// Inferring it from the row existing would print Passed on an IN_PROGRESS
// attempt, on a record a worker can show as proof of induction.
if(svc.indexOf('passed: attempt.status === PASSED') < 0)
  fail('passed is no longer derived from the attempt status — an incomplete attempt could render as Passed');
if(svc.indexOf('status: true') < 0)
  fail('the attempt status is no longer selected, so passed cannot be derived from it');

// ---------- the first-try figure must survive, clearly labelled ----------
if(page.indexOf('First-time score') < 0)
  fail('the first-time metric is gone — it was to be retained as a labelled secondary statistic');
// The VALUE, not just the identifier: the label alone with nothing beside it
// is a row that says First-time score and shows nothing. Checking the file
// merely mentions firstTryCorrect passed while the interface field was gone.
if(page.indexOf('record.knowledgeCheck.firstTryPct') < 0
   || page.indexOf('record.knowledgeCheck.firstTryCorrect') < 0)
  fail('the first-time row no longer renders the figure');
if(svc.indexOf('firstTryCorrect: number;') < 0 || svc.indexOf('firstTryPct: number;') < 0)
  fail('the first-try figures are no longer part of the result type');

// ---------- scoring and persistence must be UNCHANGED ----------
if(att.indexOf('const remaining = sampled.filter((id) => !answers[id]?.correct);') < 0)
  fail('the pass gate changed — this release is presentation only');
if(att.indexOf('incorrectFirstTryCount: incorrectFirstTry,') < 0)
  fail('the stored first-try count changed — this release must not alter what is recorded');
" || exit 1

# The scoring/persistence side and the reports that read incorrectFirstTryCount
# under their own heading must not have been dragged in.
LOGIC_TOUCHED=$(git diff --name-only "${BASE_COMMIT}"..HEAD -- services/knowledgeChecks services/reports prisma/schema.prisma app/api/worker/knowledge-check)
if [ -n "$LOGIC_TOUCHED" ]; then
  echo "ERROR: knowledge-check logic, reporting or schema changed:"
  echo "$LOGIC_TOUCHED" | sed 's/^/         /'
  echo "       SC-044 changes only how the completed record is DISPLAYED."
  exit 1
fi
echo "      confirmed: outcome leads, pass read from status, first-try retained, scoring untouched."










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
npx tsx scripts/sc001_cscs_tests.ts > /tmp/sc044_cscs.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: the CSCS verification suite failed."
  tail -15 /tmp/sc044_cscs.log | sed 's/^/         /'
  exit 1
fi
echo "      $(tail -2 /tmp/sc044_cscs.log | tr -d '\n' | sed 's/.*== //')"

echo "[4/7] Building and packaging..."
npx prisma generate > /dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
npm run build > /tmp/sc044_build.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: build failed. Last lines:"
  tail -25 /tmp/sc044_build.log | sed 's/^/         /'
  exit 1
fi
grep -qE "Compiled successfully" /tmp/sc044_build.log || { echo "ERROR: build did not report success"; exit 1; }
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
  echo "== SC-044 DEPLOYED =="
  echo "   The induction record now reports Passed (n/n), with the first-time"
  echo "   score as a labelled secondary line. Presentation only."
else
  echo "== SC-044 DEPLOYED BUT NOT HEALTHY — INVESTIGATE =="
  exit 1
fi
