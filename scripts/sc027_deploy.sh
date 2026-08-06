#!/usr/bin/env bash
# SC-027 — production CODE deploy: report the SMS provider that is delivering.
#
# The Authentication & Access screen said "SMS one-time codes: Available",
# derived from the channel flag alone. That reading stayed reassuring for the
# entire time production was running the console mock and delivering nothing.
# It now resolves the provider the same way the send path resolves it, and
# names the first thing that is actually wrong:
#
#   Switched off     one-time codes are off in the Admin Centre
#   Sending paused   the master outbound switch is off
#   Not delivering   the mock provider is active; no text can arrive
#   Misconfigured    the provider id is not one this build can construct
#   <provider name>  a real provider is sending
#
# After this deploy production will show "Not delivering", because it is.
#
# TRANSPARENCY ONLY — NO AUTHENTICATION CHANGE.
#
# The devCode suppression is a SEPARATE, HELD release on
# security/otp-disclosure-hardening. While the console mock is the only
# provider, the on-screen code is the only way a worker receives one, so
# closing the disclosure first would leave worker sign-in with no delivery
# path at all. It ships once Twilio is configured and verified end-to-end.
#
# [2/8] asserts BOTH halves of that split: the transparency work is present,
# AND the suppression is absent. A guard that only checks what should be here
# would happily let the held change ride along and take worker login down.
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
ZIP=/tmp/sc027_deploy.zip

# The commit currently in production.
BASE_COMMIT=a4adab4

UI=components/platform/AuthAccessSettings.tsx
SVC=services/auth/authConfigService.ts
SMSCFG=services/sms/smsConfigService.ts
SMSIDX=services/sms/index.ts
OTP=services/auth/otpService.ts
OTPROUTE='app/api/worker/otp/request/route.ts'

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-027 — SMS PROVIDER TRANSPARENCY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Asserting transparency present, authentication untouched..."

# ---------------------------------------------------------------------------
# THE SPLIT GUARD. These files decide whether a worker can sign in. This
# release must not touch ONE of them: it is a presentation change to a status
# line, and the moment it moves an auth file it stops being that and inherits
# a completely different risk assessment.
#
# Asserted as a diff against the commit in production rather than by grepping
# for known strings, so an edit nobody anticipated still trips it.
# ---------------------------------------------------------------------------
AUTH_FILES="services/auth/otpService.ts app/api/worker/otp/request/route.ts \
lib/config.ts lib/session.ts services/sms/smsSendService.ts \
services/sms/index.ts services/workerAccess/workerAssignmentService.ts \
app/api/worker/otp/verify/route.ts"

TOUCHED=$(git diff --name-only "${BASE_COMMIT}"..HEAD -- $AUTH_FILES)
if [ -n "$TOUCHED" ]; then
  echo "ERROR: this deploy changes authentication behaviour:"
  echo "$TOUCHED" | sed 's/^/         /'
  echo
  echo "       SC-027 is a status-line change. If the devCode suppression has"
  echo "       been merged in, STOP — it must not ship until a real SMS"
  echo "       provider is live, or workers lose the only way they receive a"
  echo "       code. See security/otp-disclosure-hardening."
  exit 1
fi

FROZEN="prisma package.json package-lock.json next.config.js middleware.ts"
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

CHANGED=$(git diff --name-only "${BASE_COMMIT}"..HEAD | tr '\n' ' ')
echo "      confirmed: no auth, prisma or dependency change since ${BASE_COMMIT}."
echo "                 Changed: ${CHANGED:-<none>}"

# ---------------------------------------------------------------------------
# Everything below matches against source with COMMENTS STRIPPED. These files
# carry long comments naming the very identifiers being asserted — the header
# of this script says "canDiscloseOtpCode" itself. A plain grep matches the
# prose and passes while the code is missing.
# ---------------------------------------------------------------------------
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const fail=(m)=>{console.error('ERROR: '+m);process.exit(1);};

// ---------- the held change must NOT be here ----------
// Belt and braces with the diff guard above: that catches the files moving,
// this catches the identifier arriving by any other route (a copy into a new
// file, a helper re-exported from elsewhere).
for(const f of ['$OTP','$OTPROUTE','lib/config.ts','$UI','$SVC','$SMSCFG']){
  if(strip(f).indexOf('canDiscloseOtpCode') >= 0)
    fail('the devCode suppression is present in '+f+' — it is HELD until a real SMS provider is live; deploying it now removes the only way workers receive a code');
}
// The disclosure must still work exactly as it does in production today.
const otp=strip('$OTP');
if(otp.indexOf(\"devCode: sent.provider === 'mock' ? code : undefined\") < 0)
  fail('the devCode expression changed — this release must not alter sign-in behaviour');

// ---------- the transparency work must be here ----------
const cfg=strip('$SMSCFG');
if(cfg.indexOf('getSmsDeliveryStatus') < 0)
  fail('getSmsDeliveryStatus is missing — the page cannot report the real provider');
if(cfg.indexOf('resolveProviderId') < 0)
  fail('the shared provider resolver is gone');
// It must NOT decrypt anything: answering 'is SMS working' should never need a
// connection string, and a screen that decrypts secrets to render a status
// line is a much bigger surface than the question deserves.
const statusFn=cfg.slice(cfg.indexOf('export async function getSmsDeliveryStatus'));
if(/decryptProviderSettings|decryptSecret/.test(statusFn.slice(0, 900)))
  fail('getSmsDeliveryStatus decrypts secrets — it only needs the provider id and the master switch');

// The resolver must agree with the send path. If index.ts changes its
// production default and this does not, the screen starts lying again — which
// is the entire defect this release exists to fix.
const idx=strip('$SMSIDX');
const prodDefault = /NODE_ENV === 'production' \? 'acs' : 'mock'/;
if(!prodDefault.test(idx))
  fail('the send path production default changed shape — re-check resolveProviderId agrees with it');
if(!prodDefault.test(cfg))
  fail('resolveProviderId no longer mirrors the send path default');

// The admin screen's old literal 'mock' fallback must stay gone.
if(/activeProvider: row\?\.activeProvider \?\? process\.env\.SMS_PROVIDER \?\? 'mock'/.test(cfg))
  fail('getSmsConfigForAdmin is back to the literal mock fallback — it would misreport the live provider');

const svc=strip('$SVC');
if(svc.indexOf('smsDelivery') < 0)
  fail('the settings view no longer carries the delivery status');

// ---------- the UI ----------
const ui=strip('$UI');
if(ui.indexOf('DeliveryRow') < 0)
  fail('the SMS delivery row is gone');
// THE DEFECT ITSELF. 'Available' derived from the channel flag is the exact
// reading that stayed green while nothing was being delivered.
if(/settings\.smsOtpEnabled \? 'Available' : 'Unavailable'/.test(ui))
  fail('the page is back to reporting Available from the channel flag alone — that is the defect');
for(const state of ['Switched off','Sending paused','Not delivering','Misconfigured']){
  if(ui.indexOf(state) < 0) fail('the \"'+state+'\" delivery state is missing');
}
if(ui.indexOf(\"tone=\\\"warn\\\"\") < 0)
  fail('the warning treatment is gone — a broken delivery state would read as normal');

console.log('      confirmed: the held suppression is absent and devCode is');
console.log('                 unchanged; the delivery row resolves the provider');
console.log('                 the same way the send path does, decrypts nothing,');
console.log('                 and all four warning states are present.');
" || exit 1

# Run the whole assertion block without deploying: DRY_RUN=1 scripts/sc027_deploy.sh
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "== DRY RUN — assertions passed, stopping before build/deploy =="
  exit 0
fi

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Type-checking, linting and building..."
npx tsc --noEmit || { echo "ERROR: typecheck failed"; exit 1; }
npx next lint --dir app --dir components || { echo "ERROR: lint failed"; exit 1; }
rm -rf .next
npm run build 2>&1 | tail -5
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[5/8] Packaging zip..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Deploying to App Service..."
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/8] Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
LANDED=""
for i in $(seq 1 40); do
  sleep 15
  CURB=$(kudu_buildid)
  echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  if [ "$CURB" = "$NEW_BUILD" ]; then LANDED=yes; break; fi
done
if [ -z "$LANDED" ]; then
  echo "WARNING: new build id not confirmed on disk yet. NOT cutting over."
  exit 2
fi
echo "      new build landed on disk."

echo "[8/8] Cutting over (stop/start) and health-checking..."
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 20); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done

echo "      route smoke test (3xx/4xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in \
  /platform/dashboard/settings/authentication \
  /admin/settings/integrations \
  /api/worker/otp/request ; do
  RC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${RC}"
  case "$RC" in 5*|000) SMOKE_FAIL=yes ;; esac
done

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
echo "   routes:    ${SMOKE_FAIL:+ONE OR MORE FAILED}${SMOKE_FAIL:-all reachable}"
if [ "$CODE" = "200" ] && [ -z "$SMOKE_FAIL" ]; then
  echo "== SC-027 DEPLOYED =="
  echo "   Authentication & access will now show \"Not delivering\" — that is"
  echo "   correct, and is the point. Worker sign-in is UNCHANGED."
else
  echo "== NOT HEALTHY — investigate before announcing =="
fi
