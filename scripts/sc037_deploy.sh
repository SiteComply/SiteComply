#!/usr/bin/env bash
# SC-037 — production CODE deploy: quieter Admin tab strip.
#
# The previous pass overcorrected: a saturated brand fill inside a bordered,
# filled container made the tabs the loudest element on the page. This one
# drops the container and tints the active segment instead of flooding it.
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
ZIP=/tmp/sc037_deploy.zip

# The commit currently in production.
BASE_COMMIT=4361b4c

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

echo "== SC-037 — QUIETER ADMIN TAB STRIP =="
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
  echo "       SC-037 is a colour change. If the devCode suppression has been"
  echo "       merged in, STOP — see security/otp-disclosure-hardening."
  exit 1
fi

FROZEN="package.json package-lock.json next.config.js middleware.ts prisma/schema.prisma tailwind.config.ts"
FROZEN_TOUCHED=$(git diff --name-only "${BASE_COMMIT}"..HEAD -- $FROZEN)
if [ -n "$FROZEN_TOUCHED" ]; then
  echo "ERROR: this is no longer a code-only deploy — frozen zones changed:"
  echo "$FROZEN_TOUCHED" | sed 's/^/         /'
  echo "       tailwind.config.ts is frozen here on purpose: a token change"
  echo "       would repaint both portals, not just this strip."
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
  | grep -v '^components/admin/AdminTabs.tsx$' \
  | grep -v '^components/platform/navUi.tsx$' \
  | grep -v '^scripts/' || true)
if [ -n "$OUTSIDE" ]; then
  echo "ERROR: SC-037 is a visual refinement to the tab strip, but these also changed:"
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
for(const f of ['$OTP','$OTPROUTE','lib/config.ts','$NAV','$TABS']){
  if(strip(f).indexOf('canDiscloseOtpCode') >= 0)
    fail('the devCode suppression is present in '+f+' — it is HELD until a real SMS provider is live');
}
const otp=strip('$OTP');
if(otp.indexOf('devCode: sent.provider === mock ? code : undefined') < 0)
  fail('the devCode expression changed — a colour change must not alter sign-in behaviour');

const nav=strip('$NAV');

// ---------- THE PLATFORM STRIPS MUST NOT MOVE ----------
// Both defaults, because either one flipping repaints all four filter strips.
if(nav.indexOf('tone = solid') < 0)
  fail('SegmentedNav no longer defaults to the solid tone — the four Platform filter strips would all switch to the quiet Admin treatment');
if(nav.indexOf('size = sm') < 0)
  fail('SegmentedNav no longer defaults to the small size — the Platform filter strips would grow');

// The solid branch itself must be intact, not merely reachable.
if(nav.indexOf('bg-brand-500 text-white shadow-sm') < 0)
  fail('the solid active fill is gone — this is what the Platform filter strips render');
if(nav.indexOf('px-3 py-1.5') < 0)
  fail('the small padding is gone — the Platform filter strips would resize');
if(nav.indexOf('border border-line bg-surface-sunken') < 0)
  fail('the solid container treatment is gone — the Platform filter strips would lose their recessed background');

// ---------- the subtle tone must actually be quieter ----------
if(nav.indexOf('bg-brand-50 text-brand-700') < 0)
  fail('the subtle active tint is missing — the whole point of this release');
if(nav.indexOf('border border-transparent') < 0)
  fail('the subtle container is no longer transparent — the filled box is most of the weight this release removes');

// ---------- AdminTabs must still delegate, and must be the ONLY opt-in ----------
const tabs=strip('$TABS');
if(tabs.indexOf('use client') >= 0)
  fail('AdminTabs became a client component — the tab is a URL, not local state');
if(tabs.indexOf('SegmentedNav') < 0)
  fail('AdminTabs no longer delegates to SegmentedNav — two hand-maintained copies of one visual language drift the moment either is touched');
if(tabs.indexOf('tone=subtle') < 0) fail('AdminTabs no longer opts into the subtle tone');
if(tabs.indexOf('size=md') < 0)
  fail('AdminTabs no longer opts into the larger target — the 52px touch target was the point of the previous pass and is deliberately kept');
" || exit 1

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
npm run build > /tmp/sc037_build.log 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: build failed. Last lines:"
  tail -25 /tmp/sc037_build.log | sed 's/^/         /'
  exit 1
fi
grep -qE "Compiled successfully" /tmp/sc037_build.log || { echo "ERROR: build did not report success"; exit 1; }
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      built: $NEW_BUILD"

# Tailwind emits only classes it finds in source. Both tones must survive into
# the stylesheet: if the subtle utilities are absent the release did nothing,
# and if the solid ones are absent it broke the Platform.
CSS=$(ls -1 .next/static/css/*.css 2>/dev/null | head -1)
[ -n "$CSS" ] || { echo "ERROR: no stylesheet in the build"; exit 1; }
for needle in 'bg-brand-50' 'bg-brand-500' 'px-3' 'px-5'; do
  grep -q "$needle" "$CSS" || { echo "ERROR: '$needle' is missing from the built stylesheet"; exit 1; }
done
echo "      stylesheet carries both tones."

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
  echo "== SC-037 DEPLOYED =="
  echo "   Admin tabs are quieter. The four Platform filter strips are unchanged."
else
  echo "== SC-037 DEPLOYED BUT NOT HEALTHY — INVESTIGATE =="
  exit 1
fi
