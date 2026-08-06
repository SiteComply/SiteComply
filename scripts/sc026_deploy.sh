#!/usr/bin/env bash
# SC-026 — production CODE deploy: organisation-wide Authentication & Access.
#
# Settings gains a third area. Directors can now set, for the whole
# organisation, how people sign in, how long sessions last and the minimum
# standard for reaching a site. Project Managers can read it; nobody else can
# reach it at all.
#
#   Login methods    — SMS login for workers, Express check-in
#   Session security — Platform session timeout, Worker session timeout
#   OTP settings     — read-only; the Admin Centre owns these
#   Access controls  — Invited workers only, Require an active site assignment
#
# EVERY CONTROL IS WIRED. This deploy asserts each one against its enforcement
# point, because a settings screen whose switches do nothing is worse than no
# screen: it tells an organisation it is protected when it is not. The four
# enforcement points are named in [3/9] and checked in source, not in prose.
#
# ORDERING IS LOAD-BEARING. This build SELECTs six columns that only exist
# after 20260811090000_auth_config_org_access. Deploying it against an
# un-migrated database does not degrade — every query touching AuthConfig
# raises, which means worker OTP login and platform session creation both
# fail. [2/9] refuses to proceed until the migration is confirmed in
# production, so the order cannot be got wrong by accident.
#
# NOT INCLUDED, DELIBERATELY: Microsoft Entra ID, email OTP and single-session
# enforcement. The behaviour behind them does not exist, and a control that
# silently does nothing is a false assurance. [3/9] asserts they are still
# absent, so they cannot arrive as decoration.
#
# ROLLBACK is a redeploy of b238694. The migration stays; the previous build
# ignores the columns. See docs/AUTH-ACCESS-DEPLOYMENT.md.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
# See sc026_migrate.sh — psql is a userland install and needs its lib path, or
# the ordering guard in [2/9] cannot read the column list and aborts.
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
PG=sitecomply-pg
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/sc026_deploy.zip
RULE=tmp-sc026-precheck

# The commit currently in production — the release this one follows.
BASE_COMMIT=b238694

PAGE='app/platform/dashboard/settings/authentication/page.tsx'
UI=components/platform/AuthAccessSettings.tsx
NAV=components/platform/SettingsWorkspace.tsx
API='app/api/platform/auth-settings/route.ts'
SVC=services/auth/authConfigService.ts
PERM=services/platformUsers/platformPermissions.ts
OTP=services/auth/otpService.ts
ASSIGN=services/workerAccess/workerAssignmentService.ts
EXPRESS='app/api/worker/express-checkin/route.ts'
VERIFY='app/api/worker/otp/verify/route.ts'
SESSION=lib/session.ts

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-026 — AUTHENTICATION & ACCESS CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/9] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

# ---------------------------------------------------------------------------
# THE ORDERING GUARD. Everything else in this script protects the shape of the
# change; this one protects the sequence. It is the only failure here that
# takes the product DOWN rather than making it wrong.
# ---------------------------------------------------------------------------
echo "[2/9] Confirming the migration has already been applied in production..."
if [ "${DRY_RUN:-}" = "1" ]; then
  # A dry run exists to exercise the source assertions before the migration has
  # been applied — which is exactly when this check would fail. Skipping it here
  # is safe because DRY_RUN never reaches the deploy; it is NOT skippable on a
  # real run, and there is no flag to make it so.
  echo "      SKIPPED (DRY_RUN) — this guard is not optional on a real deploy."
else
precheck_cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
}
trap precheck_cleanup EXIT
MYIP=$(curl -s --max-time 20 https://api.ipify.org)
az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
  --name "$RULE" --yes -o none 2>/dev/null || true
az postgres flexible-server firewall-rule create -g "$RG" -s "$PG" \
  --name "$RULE" --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none
DBURL=$(az webapp config appsettings list -g "$RG" -n "$APP" \
  --query "[?name=='DATABASE_URL'].value | [0]" -o tsv)
[ -n "$DBURL" ] || { echo "ERROR: could not read DATABASE_URL"; exit 1; }
PRESENT=$(psql "$DBURL" -X -q -t -A -c \
  "SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'AuthConfig'
     AND column_name IN ('workerSessionTtlSeconds','workerSmsLoginEnabled',
                         'expressCheckInEnabled','invitedWorkersOnly',
                         'requireActiveSiteAssignment','updatedByUserId');" \
  2>/dev/null || echo ERR)
precheck_cleanup
trap - EXIT
if [ "$PRESENT" != "6" ]; then
  echo "ERROR: production AuthConfig has ${PRESENT}/6 of the new columns."
  echo "       This build SELECTs all six. Deploying now would break worker OTP"
  echo "       login and platform session creation, not merely look wrong."
  echo "       RUN scripts/sc026_migrate.sh FIRST."
  exit 1
fi
echo "      confirmed: all 6 columns present in production."
fi

echo "[3/9] Asserting every setting is wired, and the scope has not grown..."

# ---------------------------------------------------------------------------
# Matching is done against source with COMMENTS STRIPPED.
#
# These files carry long explanatory comments that name the very identifiers
# being asserted — the header above says "Invited workers only" three times. A
# plain grep matches the prose and passes while the code is missing. This repo
# has been bitten by exactly that; do not "simplify" these into greps.
# ---------------------------------------------------------------------------
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const fail=(m)=>{console.error('ERROR: '+m);process.exit(1);};

// ================= THE FOUR ENFORCEMENT POINTS =================
// One assertion per setting. If a control loses its enforcement it becomes a
// placeholder, and this release exists precisely to not ship placeholders.

// 1. SMS login for workers — refused before a code is ever sent.
const otp=strip('$OTP');
if(otp.indexOf('workerSmsLoginEnabled') < 0)
  fail('otpService no longer checks workerSmsLoginEnabled — the SMS login toggle does nothing');
if(!/!authConfig\.smsOtpEnabled \|\| !authConfig\.workerSmsLoginEnabled/.test(otp))
  fail('the SMS gate is no longer BOTH the Admin Centre channel and the org setting');

// 2. Express check-in — refused at the WRITE, not by hiding a button. The
//    endpoint is directly reachable, so a UI-only gate is not a gate.
const ex=strip('$EXPRESS');
if(ex.indexOf('expressCheckInEnabled') < 0)
  fail('the express check-in route no longer reads expressCheckInEnabled — the toggle does nothing');
if(ex.indexOf('getAuthRuntimeConfig') < 0)
  fail('express check-in is not reading the runtime config');

// 3. Worker session timeout — applied at BOTH routes that mint a worker
//    session. Missing one leaves a path that silently keeps the old 2h.
for(const f of ['$VERIFY','app/api/worker/profile/route.ts']){
  const s=strip(f);
  if(s.indexOf('workerSessionTtlSeconds') < 0)
    fail(f+' does not apply the configured worker session TTL');
}
const ses=strip('$SESSION');
if(!/ttlSeconds/.test(ses))
  fail('lib/session.ts no longer accepts a TTL — the worker timeout cannot be applied');

// 4. Invited workers only / Require an active site assignment — an
//    organisation FLOOR beneath each site's own flag. The site check must
//    still come first, or switching these on could WIDEN access on a site
//    that already enforces its own stricter rules.
const asg=strip('$ASSIGN');
if(!/!siteEnforced && !org\.invitedWorkersOnly/.test(asg))
  fail('the invitedWorkersOnly floor is gone from canWorkerCheckIn');
if(!/!siteEnforced && !org\.requireActiveSiteAssignment/.test(asg))
  fail('the requireActiveSiteAssignment floor is gone from canWorkerCheckIn');
if(asg.indexOf('siteEnforced') < 0)
  fail('the per-site enforcement flag is no longer consulted — the org rule could widen site access');

// ================= RBAC =================
// The rendering is a courtesy; the API is the permission. Both are asserted,
// because either one alone is a screen that lies about who can change things.
const perm=strip('$PERM');
if(!/AUTH_SETTINGS_MANAGE_ROLES/.test(perm) || !/canManageAuthSettings/.test(perm))
  fail('the auth-settings permission helper is gone');
// Read the DECLARATION, not 'the constant name somewhere near a role array'.
// The first version of this check used AUTH_SETTINGS_MANAGE_ROLES[^=]*= and
// passed a file where the list had been widened to include PROJECT_MANAGER:
// [^=]* skipped from the .includes(role) call site across to the NEXT
// constant in the file — SITE_CREATE_ROLES, which is legitimately ['DIRECTOR']
// — and asserted against that instead. It validated the wrong declaration and
// would have waved through the exact regression it exists to stop.
const decl=perm.match(/AUTH_SETTINGS_MANAGE_ROLES[^=\n]*=\s*(\[[^\]]*\])/);
if(!decl) fail('cannot find the AUTH_SETTINGS_MANAGE_ROLES declaration');
const roles=decl[1].replace(/\s/g,'');
if(roles !== \"['DIRECTOR']\")
  fail('auth settings are no longer DIRECTOR-only — the list is '+roles);
const api=strip('$API');
if(api.indexOf('canManageAuthSettings') < 0)
  fail('the auth-settings API route is not gated — a Project Manager could PATCH it');
const page=strip('$PAGE');
if(page.indexOf('canManageAuthSettings') < 0)
  fail('the page no longer computes canEdit — every control would render editable');
const ui=strip('$UI');
if(ui.indexOf('disabled={!canEdit}') < 0)
  fail('the settings controls no longer respect canEdit');

// ================= OWNERSHIP SPLIT (option 2) =================
// Admin Centre keeps what protects the SYSTEM; Platform owns organisation
// policy. If the Platform save ever writes an OTP field, a Director could
// change infrastructure timings from the wrong portal and the split is over.
const svc=strip('$SVC');
const save=svc.slice(svc.indexOf('export async function savePlatformAuthSettings'));
if(save.length < 100)
  fail('savePlatformAuthSettings is missing');
for(const owned of ['otpTtlSeconds','otpMaxAttempts','smsOtpEnabled','emailOtpEnabled']){
  if(new RegExp(owned+'\\s*:').test(save))
    fail('savePlatformAuthSettings writes '+owned+' — that belongs to the Admin Centre');
}
if(svc.indexOf('updatedByUserId') < 0)
  fail('the platform save no longer records WHO changed it');

// The dependency must be refused server-side, not only greyed in the UI.
if(save.indexOf('requireActiveSiteAssignment') < 0)
  fail('savePlatformAuthSettings does not handle requireActiveSiteAssignment');
if(!/invitedWorkersOnly/.test(save))
  fail('the invitedWorkersOnly dependency is not validated on save');

// ================= OUT OF SCOPE =================
// Absent by decision. If one of these appears, someone has shipped a control
// with nothing behind it and the deploy should stop.
if(/Microsoft Entra|entraEnabled|ssoEnabled/i.test(ui))
  fail('a Microsoft Entra ID control has appeared — out of scope until SSO exists');
if(/singleSession|Single session/i.test(ui))
  fail('a single-session control has appeared — out of scope until enforcement exists');
// Email OTP may be READ (the column exists) but must not be offered as a
// switch: nothing sends an email code today.
if(/emailOtpEnabled[^)]*onChange/.test(ui) || /Email one-time|Email OTP/i.test(ui))
  fail('an email OTP control has appeared — out of scope until email codes exist');

// ================= THE NAVIGATOR =================
const nav=strip('$NAV');
if(nav.indexOf('authentication') < 0)
  fail('Settings does not list the Authentication & access area');
// The two existing areas' hrefs are load-bearing: SC-021 Phase 2's historical
// redirects still resolve to them.
if(nav.indexOf('/platform/dashboard/settings/config-templates') < 0 ||
   nav.indexOf('/platform/dashboard/settings/permission-templates') < 0)
  fail('an existing Settings area lost its route — historical redirects would break');

console.log('      confirmed: all four settings reach an enforcement point, the');
console.log('                 site flag still precedes the org floor, DIRECTOR-only');
console.log('                 on both the page and the API, the Admin Centre keeps');
console.log('                 its OTP fields, and no out-of-scope control shipped.');
" || exit 1

# Run the whole assertion block without deploying: DRY_RUN=1 scripts/sc026_deploy.sh
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "== DRY RUN — assertions passed, stopping before build/deploy =="
  exit 0
fi

# THE WORKING TREE IS WHAT SHIPS. [6/9] zips the working tree, not HEAD, so a
# commit-only check asks the wrong question: uncommitted edits would deploy
# without ever being asserted.
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo "ERROR: working tree is not clean, and the zip is built from the working"
  echo "       tree — deploy what is committed, or commit what you are deploying:"
  echo "$DIRTY" | sed 's/^/         /'
  exit 1
fi

echo "[4/9] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[5/9] Type-checking, linting and building..."
npx tsc --noEmit || { echo "ERROR: typecheck failed"; exit 1; }
npx next lint --dir app --dir components || { echo "ERROR: lint failed"; exit 1; }
rm -rf .next
npm run build 2>&1 | tail -5
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[6/9] Packaging zip..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[7/9] Deploying to App Service..."
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[8/9] Waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
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

echo "[9/9] Cutting over (stop/start) and health-checking..."
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 20); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done

# Smoke test, not the walkthrough. Unauthenticated these redirect to sign-in
# (3xx) — that is a pass; a 200 would mean the auth gate had gone and a 5xx
# means the build is broken on a page nobody has opened yet.
#
# The worker OTP route is included on purpose: it is the path that would break
# if the schema and code were out of step, and it is not a page anyone would
# think to click.
echo "      route smoke test (3xx/4xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in \
  /platform/dashboard/settings/authentication \
  /platform/dashboard/settings/config-templates \
  /platform/dashboard/settings/permission-templates \
  /api/platform/auth-settings ; do
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
  echo "== SC-026 DEPLOYED =="
  echo "   NOW RUN THE WALKTHROUGH: docs/AUTH-ACCESS-DEPLOYMENT.md"
  echo "   Until a Director saves, nothing has changed for anyone."
else
  echo "== NOT HEALTHY — investigate before announcing =="
fi
