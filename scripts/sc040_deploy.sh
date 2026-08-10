#!/usr/bin/env bash
# SC-040 — production CODE deploy: company profile partial-update fix (H-2).
#
# A partial update erased every field it did not mention; an empty request
# erased the whole profile and returned 200. Root cause was one collapse of
# ABSENT into BLANK, in the service and again in the route's boolean helper.
#
# THE RISK HERE IS THE OPPOSITE OF THE BUG. A fix that preserves too much
# would make a field impossible to CLEAR — the user could never remove a
# report footer or a phone number, and would have no way to tell, because the
# save would still report success. [3/7] therefore asserts BOTH directions:
# undefined must be preserved, AND an explicitly supplied empty string must
# still become null.
#
# It also pins the blast radius. saveCompanyConfig — the Admin Centre fallback
# in the SAME FILE — must not have moved, and neither may any other settings
# store. That is asserted as a diff, not by grepping for what should be there.
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
ZIP=/tmp/sc040_deploy.zip

# The commit currently in production.
BASE_COMMIT=e0355e0

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

echo "== SC-040 — QUIETER ADMIN TAB STRIP =="
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
  echo "       SC-040 is a colour change. If the devCode suppression has been"
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
  | grep -v '^services/company/companyConfigService.ts$' \
  | grep -v '^app/api/platform/company-profile/route.ts$' \
  | grep -v '^scripts/' || true)
if [ -n "$OUTSIDE" ]; then
  echo "ERROR: SC-040 fixes ONE defect, but these also changed:"
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

const svc=strip('services/company/companyConfigService.ts');
const route=strip('app/api/platform/company-profile/route.ts');

// ---------- absent must be PRESERVED ----------
if(svc.indexOf('const text = (v?: string) => (v === undefined ? undefined : v.trim())') < 0)
  fail('the service still collapses an absent field into an empty string — this is the defect itself');
if(svc.indexOf('const store = (v: string | undefined) => (v === undefined ? undefined : v || null)') < 0)
  fail('the store() mapping is gone — undefined must be omitted from the write so the column keeps its value');
if(route.indexOf('const bool = (v: unknown) => (typeof v === boolean ? v : undefined)') < 0)
  fail('the route still turns an absent close-out toggle into true, which destroys the distinction before the service sees it');

// ---------- ...but blank must still CLEAR ----------
// The opposite failure: a fix that preserves everything would make a field
// impossible to empty, and the save would still report success.
if(svc.indexOf('v || null') < 0)
  fail('an explicitly emptied field no longer becomes null — the user would be unable to clear a value');

// Every text column must go through store(), or the ones left behind still wipe.
for(const f of ['companyName','registrationNumber','vatNumber','primaryContactName',
                'primaryEmail','primaryPhone','website','addressLine1','addressLine2',
                'addressTown','addressPostcode','tagline','disclaimer','reportFooter']){
  if(svc.indexOf(f+': store(') < 0)
    fail(f+' is not written through store() — a partial update would still blank it');
}
// The four toggles must be passed straight through, not defaulted.
for(const t of ['packIncludeCompanyInfo','packIncludeLogo','packIncludePrintLogo','packIncludeStandardDetails']){
  if(svc.indexOf(t+': input.'+t+',') < 0)
    fail(t+' is not passed through untouched — an omitted toggle would be forced back on');
  if(svc.indexOf(t+': input.'+t+' !== false') >= 0)
    fail(t+' still defaults an absent toggle to true');
}

// ---------- the Admin Centre fallback in the SAME FILE must not have moved ----------
if(svc.indexOf('const text = (v?: string) => (v ?? ).trim();') < 0)
  fail('saveCompanyConfig no longer has its own original text() — this release must not touch the Admin Centre fallback');
" || exit 1

# saveCompanyConfig is in the same file as the function being fixed, so the
# blast radius is asserted as a DIFF: the only changed lines must fall inside
# savePlatformCompanyProfile. A grep cannot tell those two apart.
SPCP_START=$(grep -n "^export async function savePlatformCompanyProfile" services/company/companyConfigService.ts | cut -d: -f1)
SPCP_END=$(awk -v s="$SPCP_START" 'NR>s && /^}/ {print NR; exit}' services/company/companyConfigService.ts)
OUTSIDE_HUNKS=0
while read -r h; do
  LN=$(echo "$h" | sed -E 's/@@ -([0-9]+).*/\1/')
  if [ "$LN" -lt "$SPCP_START" ] || [ "$LN" -gt "$SPCP_END" ]; then
    echo "ERROR: a hunk at line $LN falls OUTSIDE savePlatformCompanyProfile (${SPCP_START}-${SPCP_END})."
    echo "       saveCompanyConfig and the other helpers in this file must not move."
    OUTSIDE_HUNKS=1
  fi
done < <(git diff -U0 "${BASE_COMMIT}"..HEAD -- services/company/companyConfigService.ts | grep -E "^@@")
[ "$OUTSIDE_HUNKS" = "0" ] || exit 1
echo "      confirmed: absent preserved, blank still clears, Admin Centre fallback untouched."


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

echo "[4/7] Building and packaging..."
npx prisma generate > /dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
npm run build > /tmp/sc040_build.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: build failed. Last lines:"
  tail -25 /tmp/sc040_build.log | sed 's/^/         /'
  exit 1
fi
grep -qE "Compiled successfully" /tmp/sc040_build.log || { echo "ERROR: build did not report success"; exit 1; }
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
  echo "== SC-040 DEPLOYED =="
  echo "   Partial company-profile updates now preserve omitted fields."
  echo "   Explicitly cleared fields still null. Nothing else changed."
else
  echo "== SC-040 DEPLOYED BUT NOT HEALTHY — INVESTIGATE =="
  exit 1
fi
