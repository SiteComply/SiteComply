#!/usr/bin/env bash
# SC-030 — production CODE deploy: SC-024 single executive summary.
#
# The close-out AI narrative becomes ONE project-level executive summary.
# Per-section prose is gone from new packs; the evidence sections carry
# records only.
#
# REV-1 SC-024 asks the AI to compile and organise the pack — the words
# summary, narrative and executive appear in it nowhere. Per-section prose sat
# furthest from that and, measured on real data, restated the tables beneath
# it, leaked a raw JSON key (photoCount = 3) and addressed sections by
# identifier (PROJECT_INFORMATION) in a document handed to a client.
#
# REVERTIBLE WITHOUT A DEPLOY: set CLOSE_OUT_NARRATIVE_MODE=sections on the
# App Service to restore the previous behaviour.
#
# STORED PACKS ARE NOT TOUCHED. A pack already carrying per-section prose keeps
# it and still renders it; the mode decides what NEW generations produce.
#
# The devCode suppression remains HELD on security/otp-disclosure-hardening
# until Twilio is live. [2/8] still asserts both halves of that split, plus
# that this release changes NOTHING outside the one component.
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
ZIP=/tmp/sc030_deploy.zip

# The commit currently in production.
BASE_COMMIT=caab7d8

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

echo "== SC-030 — SC-024 EXECUTIVE SUMMARY =="
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

# ONE COMPONENT. This release is a polish pass; anything else moving means it
# has quietly become something with a different risk profile.
OUTSIDE=$(git diff --name-only "${BASE_COMMIT}"..HEAD \
  | grep -v '^components/platform/CloseOutNarrativeControls.tsx$' \
  | grep -v '^services/closeOut/closeOutNarrative.ts$' \
  | grep -v '^services/closeOut/closeOutAi.ts$' \
  | grep -v '^app/platform/dashboard/sites/\[id\]/close-out/\[packId\]/page.tsx$' \
  | grep -v '^scripts/' || true)
if [ -n "$OUTSIDE" ]; then
  echo "ERROR: SC-030 should touch only the close-out narrative path, but these also changed:"
  echo "$OUTSIDE" | sed 's/^/         /'
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


// ---------- SC-028 polish ----------
// The raw minutes box is what this pass removed. If an input[type=number] is
// back on this screen, the durations regressed to arithmetic.
if(/type=\"number\"/.test(ui))
  fail('a raw number input is back — timeouts should be chosen as durations');
if(ui.indexOf('DURATION_CHOICES') < 0)
  fail('the duration choices are gone');
// A stored value that is not one of the presets must be OFFERED, not rounded.
// Without this branch, opening the page and pressing Save silently rewrites a
// setting the user never touched — the one way this pass could lose data.
if(ui.indexOf('(current)') < 0)
  fail('a non-preset stored value would be silently rewritten on save');
// Seconds in, seconds out. The select must not reintroduce a minutes conversion.
if(/Number\(e\.target\.value\) \* 60/.test(ui))
  fail('the duration control is converting minutes again — it must store seconds unchanged');

if(ui.indexOf('Worker SMS Login') < 0) fail('the Worker SMS Login label is missing');
if(ui.indexOf('SMS login for workers') >= 0) fail('the old SMS login label is still present');
if(ui.indexOf('ManagedElsewhereBadge') < 0)
  fail('the OTP read-only badge is gone — the section reads as controls that failed to load');
// Save must LEAD the workspace and stay put. sticky is the property that
// makes saving-without-scrolling true on a page this tall, not merely at the
// top. NOTE: no double quotes in comments inside this node -e block — an
// unescaped one closes the shell string and silently truncates the program,
// which exits 0 having asserted nothing.
if(!/sticky top-0/.test(ui))
  fail('the Save action is no longer sticky — it would scroll away on this page');


// ---------- SC-024 executive summary ----------
// NOTE: no double quotes and no backticks in comments inside this node -e
// block — either one breaks out of the shell string and silently truncates or
// executes. Both have happened here before.
const nar=strip('services/closeOut/closeOutNarrative.ts');
const ai=strip('services/closeOut/closeOutAi.ts');
const ctl=strip('components/platform/CloseOutNarrativeControls.tsx');

// THE DEFAULT IS THE RELEASE. If this inverts, every new pack silently goes
// back to ten AI blocks restating its own tables.
if(!/=== \s*\n?\s*'sections'/.test(nar) && nar.indexOf(\"'sections'\\n    ? 'sections'\") < 0 && !/'sections'[\s\S]{0,40}\?\s*'sections'\s*:\s*'summary'/.test(nar))
  fail('the narrative mode default is not summary-with-explicit-sections-opt-in');
if(!/:\s*'summary';/.test(nar))
  fail('the fallback branch no longer yields summary');
// Both modes must still exist, or the revert path is gone.
if(nar.indexOf('CLOSE_OUT_SUMMARY_SYSTEM_PROMPT') < 0) fail('the summary prompt is missing');
if(nar.indexOf('CLOSE_OUT_SYSTEM_PROMPT') < 0) fail('the sections prompt was deleted — there is no way back');
if(nar.indexOf('CLOSE_OUT_NARRATIVE_MODE') < 0) fail('the configuration switch is gone');
// The summary schema must not be able to ask for per-section prose.
const sch=nar.slice(nar.indexOf('CLOSE_OUT_SUMMARY_SCHEMA'), nar.indexOf('CLOSE_OUT_SUMMARY_SYSTEM_PROMPT'));
if(sch.indexOf('sectionNarratives') >= 0)
  fail('the summary schema asks for sectionNarratives — the section prose would come back');
// Summary mode must pass an EMPTY allowed-section list, so prose the model
// volunteers anyway is dropped rather than rendered.
if(!/mode === 'summary' \? \[\]/.test(ai))
  fail('summary mode no longer drops unsolicited per-section prose');
// The prohibitions are the reason this is safe in a client document.
for(const rule of ['certify','compliant','satisfactory']){
  if(nar.toLowerCase().indexOf(rule) < 0) fail('the summary prompt lost its '+rule+' prohibition');
}
if(nar.indexOf('findConclusionLanguage') < 0)
  fail('the verdict-language guard is gone');
// The offer must describe what actually arrives.
// indexOf('mode') is too weak — the word appears in ordinary code. Require the
// control to actually BRANCH on it, which is what makes the offer match what
// the pack will contain.
if(!/mode === 'summary'/.test(ctl))
  fail('the narrative control no longer branches on the mode — it would promise per-section prose the pack will not contain');
// Still optional and reversible by the author.
if(ctl.indexOf('DELETE') < 0) fail('the narrative can no longer be removed');
if(ctl.indexOf('POST') < 0) fail('the narrative can no longer be generated');

console.log('      confirmed: summary is the default and sections is still');
console.log('                 reachable, the summary schema cannot request');
console.log('                 per-section prose, the verdict guard and');
console.log('                 prohibitions are intact, and the narrative is');
console.log('                 still optional and removable.');
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
  # 000* not 000: curl prints "000" via -w AND the `|| echo 000` fires, so an
  # unreachable route reports "000000" — which never matched the bare "000"
  # pattern. SC-031 printed "routes: all reachable" while every route was
  # unreachable. A smoke test that cannot fail is not a smoke test.
  case "$RC" in 5*|000*) SMOKE_FAIL=yes ;; esac
done

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
echo "   routes:    ${SMOKE_FAIL:+ONE OR MORE FAILED}${SMOKE_FAIL:-all reachable}"
if [ "$CODE" = "200" ] && [ -z "$SMOKE_FAIL" ]; then
  echo "== SC-030 DEPLOYED =="
  echo "   Revert without a deploy: CLOSE_OUT_NARRATIVE_MODE=sections on the App Service."
else
  echo "== NOT HEALTHY — investigate before announcing =="
fi
