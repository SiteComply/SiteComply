#!/usr/bin/env bash
# SC-036 — production CODE deploy: Test Connection for CSCS Smart Check.
#
# Adds a connectivity probe to the Admin Centre so partner credentials can be
# proved before the provider is selected. saveCscsConfig() refuses to select
# Smart Check without credentials, so the workflow is enter → prove → enable,
# and until now there was nothing to do in the middle.
#
# THE CENTRAL RISK IS NOT THE NEW CODE, IT IS THE OLD CODE IT SITS NEXT TO.
# The probe reuses REQUEST_SHAPE from smartCheckProvider.ts — the module that
# performs real worker card verification on the onboarding path. [4/8] asserts
# that the ONLY change to that file is the word `export`, by diffing it rather
# than by grepping for what should be there. A guard that checks for presence
# would pass while verifyCard had been rewritten around it.
#
# The other assertions defend the two claims the screen makes to a user:
#   - a 2xx says the service ANSWERED, never that the card contract is right;
#   - a 404 is inconclusive, not a pass and not a failure.
# Both are the difference between a useful diagnostic and a green tick over a
# broken mapping.
#
# The devCode suppression remains HELD on security/otp-disclosure-hardening
# until Twilio is live. [4/8] still asserts both halves of that split.
#
# CODE ONLY: no schema change, no migration, no seed, no backfill.
# Rollback is a redeploy of the current production commit; nothing is destructive.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
# psql is a userland install; without this the table guard cannot read the
# table list and aborts. See sc026_migrate.sh.
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
PG=sitecomply-pg
PRECHECK_RULE=tmp-sc036-precheck
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/sc036_deploy.zip

# The commit currently in production.
BASE_COMMIT=7d0262c

PROV=services/cscs/smartCheckProvider.ts
CONN=services/cscs/smartCheckConnectionTest.ts
CFG=services/cscs/cscsConfigService.ts
ROUTE='app/api/admin/settings/cscs/test/route.ts'
UI=components/admin/CscsProviderSettings.tsx
OTP=services/auth/otpService.ts
OTPROUTE='app/api/worker/otp/request/route.ts'

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-036 — CSCS SMART CHECK: TEST CONNECTION =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

# ---------------------------------------------------------------------------
# No migration ships with this release, but the new code READS CscsConfig on
# every test (resolveCscsTestCredentials → getCscsRuntimeConfig). That table
# arrived with SC-033; this confirms it is really there rather than trusting
# that an earlier deploy did what its log said.
# ---------------------------------------------------------------------------
echo "[2/8] Confirming the CSCS tables exist in production..."
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "      SKIPPED (DRY_RUN) — this guard is not optional on a real deploy."
else
precheck_cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$PRECHECK_RULE" --yes -o none 2>/dev/null || true
}
trap precheck_cleanup EXIT
MYIP=$(curl -s --max-time 20 https://api.ipify.org)
az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
  --name "$PRECHECK_RULE" --yes -o none 2>/dev/null || true
az postgres flexible-server firewall-rule create -g "$RG" -s "$PG" \
  --name "$PRECHECK_RULE" --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none
DBURL=$(az webapp config appsettings list -g "$RG" -n "$APP" \
  --query "[?name=='DATABASE_URL'].value | [0]" -o tsv)
[ -n "$DBURL" ] || { echo "ERROR: could not read DATABASE_URL"; exit 1; }
PRESENT=$(psql "$DBURL" -X -q -t -A -c \
  "SELECT count(*) FROM information_schema.tables
   WHERE table_name IN ('CscsConfig','CscsVerificationLog');" \
  2>/dev/null || echo ERR)
precheck_cleanup
trap - EXIT
if [ "$PRESENT" != "2" ]; then
  echo "ERROR: production has ${PRESENT}/2 of the CSCS tables."
  echo "       The test endpoint reads CscsConfig to resolve stored credentials."
  exit 1
fi
echo "      confirmed: both CSCS tables present in production."
fi

echo "[3/8] Asserting scope..."

# ---------------------------------------------------------------------------
# THE SPLIT GUARD. These files decide whether a worker can sign in. This
# release is an Admin Centre diagnostic and must not touch one of them.
# ---------------------------------------------------------------------------
AUTH_FILES="services/auth/otpService.ts app/api/worker/otp/request/route.ts \
lib/config.ts lib/session.ts services/sms/smsSendService.ts \
services/sms/index.ts services/workerAccess/workerAssignmentService.ts \
app/api/worker/otp/verify/route.ts"

TOUCHED=$(git diff --name-only "${BASE_COMMIT}"..HEAD -- $AUTH_FILES)
if [ -n "$TOUCHED" ]; then
  echo "ERROR: this deploy changes authentication behaviour:"
  echo "$TOUCHED" | sed 's/^/         /'
  echo "       If the devCode suppression has been merged in, STOP — it must not"
  echo "       ship until a real SMS provider is live, or workers lose the only"
  echo "       way they receive a code. See security/otp-disclosure-hardening."
  exit 1
fi

FROZEN="package.json package-lock.json next.config.js middleware.ts prisma/schema.prisma"
FROZEN_TOUCHED=$(git diff --name-only "${BASE_COMMIT}"..HEAD -- $FROZEN)
if [ -n "$FROZEN_TOUCHED" ]; then
  echo "ERROR: this is no longer a code-only deploy — frozen zones changed:"
  echo "$FROZEN_TOUCHED" | sed 's/^/         /'
  echo "       A prisma/ change needs its migration applied FIRST; see"
  echo "       scripts/sc026_migrate.sh for the pattern."
  exit 1
fi

# THE WORKING TREE IS WHAT SHIPS. [5/8] zips the working tree, not HEAD, so a
# commit-only check asks the wrong question.
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo "ERROR: working tree is not clean, and the zip is built from the working"
  echo "       tree — deploy what is committed, or commit what you are deploying:"
  echo "$DIRTY" | sed 's/^/         /'
  exit 1
fi

OUTSIDE=$(git diff --name-only "${BASE_COMMIT}"..HEAD \
  | grep -v '^services/cscs/smartCheckConnectionTest.ts$' \
  | grep -v '^services/cscs/smartCheckProvider.ts$' \
  | grep -v '^services/cscs/cscsConfigService.ts$' \
  | grep -v '^components/admin/CscsProviderSettings.tsx$' \
  | grep -v '^app/api/admin/settings/cscs/test/route.ts$' \
  | grep -v '^scripts/' || true)
if [ -n "$OUTSIDE" ]; then
  echo "ERROR: SC-036 adds a CSCS connection test, but these also changed:"
  echo "$OUTSIDE" | sed 's/^/         /'
  exit 1
fi

CHANGED=$(git diff --name-only "${BASE_COMMIT}"..HEAD | tr '\n' ' ')
echo "      confirmed: no auth, prisma or dependency change since ${BASE_COMMIT}."
echo "                 Changed: ${CHANGED:-<none>}"

# ---------------------------------------------------------------------------
# THE VERIFICATION-PATH GUARD, and the most important check in this script.
#
# smartCheckProvider.ts runs real worker card verification. The connection test
# reuses REQUEST_SHAPE from it, and the ONLY change this release makes to that
# file is adding the word `export`. Asserted as a DIFF, not a grep: a presence
# check would pass while verifyCard had been rewritten around the constant.
#
# Comment and blank lines are dropped — the change also added a comment block
# explaining the export, and that is not behaviour.
# ---------------------------------------------------------------------------
PROV_ADDED=$(git diff -U0 "${BASE_COMMIT}"..HEAD -- "$PROV" \
  | grep '^+' | grep -v '^+++' | sed 's/^+//' | sed 's/^[[:space:]]*//' \
  | grep -v '^\*' | grep -v '^//' | grep -v '^/\*' | grep -v '^$' || true)
PROV_REMOVED=$(git diff -U0 "${BASE_COMMIT}"..HEAD -- "$PROV" \
  | grep '^-' | grep -v '^---' | sed 's/^-//' | sed 's/^[[:space:]]*//' \
  | grep -v '^\*' | grep -v '^//' | grep -v '^/\*' | grep -v '^$' || true)
if [ "$PROV_ADDED" != "export const REQUEST_SHAPE = {" ] \
   || [ "$PROV_REMOVED" != "const REQUEST_SHAPE = {" ]; then
  echo "ERROR: smartCheckProvider.ts changed by more than the REQUEST_SHAPE export."
  echo "       This file performs REAL worker card verification on the onboarding"
  echo "       path. SC-036 is a diagnostic and must not alter it."
  echo "       added:   ${PROV_ADDED:-<none>}"
  echo "       removed: ${PROV_REMOVED:-<none>}"
  exit 1
fi
echo "      confirmed: verification path untouched (export keyword only)."

# ---------------------------------------------------------------------------
# Source assertions. Matched against source with COMMENTS STRIPPED and ALL
# QUOTE CHARACTERS REMOVED.
#
# Comments, because these files carry long comment blocks naming the very
# identifiers being asserted — the header of this script does it too, and a
# plain grep matches the prose and passes while the code is missing.
#
# Quotes, because a double quote inside this node -e "..." string closes the
# shell string and silently truncates the program, and a backtick executes as
# command substitution. Stripping them from BOTH sides lets every needle below
# be written without one.
# ---------------------------------------------------------------------------
echo "[4/8] Asserting behaviour..."
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'')
  .replace(/[\x22\x27\x60]/g,'');
const fail=(m)=>{console.error('ERROR: '+m);process.exit(1);};

// ---------- the held change must NOT be here ----------
for(const f of ['$OTP','$OTPROUTE','lib/config.ts','$CONN','$ROUTE','$CFG']){
  if(strip(f).indexOf('canDiscloseOtpCode') >= 0)
    fail('the devCode suppression is present in '+f+' — it is HELD until a real SMS provider is live; deploying it now removes the only way workers receive a code');
}
const otp=strip('$OTP');
if(otp.indexOf('devCode: sent.provider === mock ? code : undefined') < 0)
  fail('the devCode expression changed — this release must not alter sign-in behaviour');

// ---------- the probe must exercise the REAL contract ----------
const conn=strip('$CONN');
if(conn.indexOf('import { REQUEST_SHAPE } from ./smartCheckProvider') < 0)
  fail('the connection test no longer imports REQUEST_SHAPE — a probe with its own copy of the contract can pass while real verification fails, which is the one outcome that makes this feature worse than having none');
if(/path:\s*\/v[0-9]/.test(conn))
  fail('the connection test declares its own endpoint path — it must use REQUEST_SHAPE.path so it tests what verifyCard will really call');

// ---------- the two claims the screen makes to a user ----------
// A 2xx proves the exchange happened, NOT that the fields were understood.
if(conn.indexOf('Confirm the card fields against the partner documentation') < 0)
  fail('the success verdict no longer qualifies itself — a 200 must not be reported as a confirmed integration');
if(/title:.*(Integration verified|successfully verified|verification confirmed)/i.test(conn))
  fail('the success verdict claims verification — a 200 only proves the service answered');

// A 404 is genuinely ambiguous and must stay a third state.
const nf=conn.indexOf('outcome: CARD_NOT_FOUND');
if(nf < 0) fail('the 404 branch is gone — it would fall through to the generic 4xx handler and be reported as a hard failure');
if(conn.slice(nf, nf+220).indexOf('severity: warning') < 0)
  fail('the 404 verdict is no longer a warning — it is inconclusive, and reporting it as a pass or a failure is wrong in one direction or the other');

// ---------- it must remain read-only ----------
for(const f of ['$CONN','$ROUTE']){
  const s=strip(f);
  if(s.indexOf('prisma.') >= 0 || s.indexOf('cscsVerificationLog') >= 0)
    fail(f+' writes to the database — a connectivity probe against a synthetic card number is not a worker verification, and CscsVerificationLog feeds the CSCS compliance report');
}

// ---------- the endpoint must be gated and guarded ----------
const route=strip('$ROUTE');
if(route.indexOf('requireAdminRole(ADMIN_WRITE_ROLES)') < 0)
  fail('the test endpoint is not gated on admin write roles — it makes the server fetch a URL and would be callable by a read-only admin');
if(conn.indexOf('isBlockedHost(target.hostname)') < 0)
  fail('the SSRF guard is not called — this endpoint makes the SERVER fetch a URL an admin typed');
if(conn.indexOf('169') < 0 || conn.indexOf('254') < 0)
  fail('the link-local/cloud-metadata range is no longer blocked');
if(conn.indexOf('target.protocol !== https:') < 0)
  fail('the https-only guard is gone — the probe carries the partner API key');

// ---------- existing behaviour must be intact ----------
const cfg=strip('$CFG');
if(cfg.indexOf('CSCS Smart Check needs a partner API URL and key before it can be selected.') < 0)
  fail('saveCscsConfig no longer refuses Smart Check without credentials — the guard this whole workflow is built around');
if(cfg.indexOf('supportsTest: false') < 0)
  fail('the mock provider offers a connection test — it never leaves the process, so the test could only ever report a meaningless success');

console.log('      confirmed: probe uses the real contract, both verdicts are honest,');
console.log('                 nothing is written, the endpoint is gated, save still refuses.');
" || exit 1

echo "[5/8] Running the connection-test suite..."
npx tsx scripts/sc036_conntest_tests.ts > /tmp/sc036_tests.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: the connection-test suite failed. Last lines:"
  tail -15 /tmp/sc036_tests.log | sed 's/^/         /'
  exit 1
fi
echo "      $(grep -c PASS /tmp/sc036_tests.log) assertions passed."

echo "[6/8] Running the SC-001 CSCS suite (verification logic must be intact)..."
npx tsx scripts/sc001_cscs_tests.ts > /tmp/sc036_cscs.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: the CSCS verification suite failed — this release must not change it."
  tail -15 /tmp/sc036_cscs.log | sed 's/^/         /'
  exit 1
fi
echo "      $(tail -2 /tmp/sc036_cscs.log | tr -d '\n' | sed 's/.*== //')"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo
  echo "== DRY RUN COMPLETE — all assertions passed, nothing deployed =="
  exit 0
fi

echo "[7/8] Building and packaging..."
npx prisma generate > /dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
npm run build > /tmp/sc036_build.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: build failed. Last lines:"
  tail -25 /tmp/sc036_build.log | sed 's/^/         /'
  exit 1
fi
grep -qE "Compiled successfully" /tmp/sc036_build.log || { echo "ERROR: build did not report success"; exit 1; }
grep -q "api/admin/settings/cscs/test" /tmp/sc036_build.log || {
  echo "ERROR: the new test route is not in the build output — it would 404 in production"; exit 1; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      built: $NEW_BUILD"

rm -f "$ZIP"
zip -rq "$ZIP" .next public package.json package-lock.json next.config.js \
  prisma node_modules -x 'node_modules/.cache/*' 2>/dev/null
echo "      zip: $(du -h "$ZIP" | cut -f1)"

echo "[8/8] Deploying..."
az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --timeout 1800 2>&1 | tail -5

echo "      Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
FLIPPED=0
for i in $(seq 1 40); do
  CUR=$(kudu_buildid)
  if [ "$CUR" = "$NEW_BUILD" ]; then FLIPPED=1; echo "      [$i] prod build id now: $CUR"; break; fi
  sleep 15
done
if [ "$FLIPPED" != "1" ]; then
  echo "WARNING: new build did not appear within 10 minutes. Last seen: ${CUR:-<unknown>}"
fi
echo "      new build landed on disk."

RC=000
for i in $(seq 1 20); do
  RC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP $RC"
  case "$RC" in 200) break;; 000*|5*) sleep 15;; *) sleep 15;; esac
done

echo
echo "      Route reachability:"
ROUTES_OK=1
for r in /platform/dashboard /admin/settings/integrations /api/worker/otp/request; do
  S=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "${BASE}${r}" || echo 000)
  echo "        ${r} -> HTTP ${S}"
  case "$S" in 000*|5*) ROUTES_OK=0;; esac
done
# Unauthenticated, the new endpoint must refuse — never 404 (not deployed) and
# never 200 (open). 401/403/405 are all correct answers here.
T=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X POST \
  -H 'content-type: application/json' -d '{}' \
  "${BASE}/api/admin/settings/cscs/test" || echo 000)
echo "        POST /api/admin/settings/cscs/test (no session) -> HTTP ${T}"
case "$T" in
  401|403) echo "        correct: deployed and refusing unauthenticated callers.";;
  404) echo "ERROR: the test endpoint is not deployed."; ROUTES_OK=0;;
  200) echo "ERROR: the test endpoint answered an unauthenticated caller."; ROUTES_OK=0;;
  *) echo "        unexpected — check manually."; ROUTES_OK=0;;
esac

echo
echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${RC}"
echo "   routes:    $([ "$ROUTES_OK" = "1" ] && echo 'all reachable' || echo 'PROBLEM — see above')"
echo "   rollback:  git checkout ${BASE_COMMIT} && re-run this script's build+deploy steps"
if [ "$RC" = "200" ] && [ "$ROUTES_OK" = "1" ]; then
  echo "== SC-036 DEPLOYED =="
  echo "   Smart Check credentials can now be proved before the provider is selected."
  echo "   The mock remains the live provider; no verification behaviour changed."
else
  echo "== SC-036 DEPLOYED BUT NOT HEALTHY — INVESTIGATE =="
  exit 1
fi
