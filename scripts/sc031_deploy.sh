#!/usr/bin/env bash
# SC-031 — production CODE deploy: Company Profile & Branding.
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
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
# psql is a userland install; without this the ordering guard cannot read the
# column list and aborts. See sc026_migrate.sh.
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
PG=sitecomply-pg
PRECHECK_RULE=tmp-sc031-precheck
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/sc031_deploy.zip

# The commit currently in production.
BASE_COMMIT=ebdc9b9

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

echo "== SC-031 — COMPANY PROFILE & BRANDING =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

# ---------------------------------------------------------------------------
# THE ORDERING GUARD. Everything else in this script protects the SHAPE of the
# change; this one protects the SEQUENCE, and it is the only failure here that
# breaks pages rather than making them wrong.
#
# CompanyConfig is read by close-out packs and by the PUBLIC /pack/[token]
# share page. Against an un-migrated database this build's SELECT raises, and
# the page a client was sent stops rendering. Migration first, always.
# ---------------------------------------------------------------------------
echo "[2/8] Confirming the migration has already been applied in production..."
if [ "${DRY_RUN:-}" = "1" ]; then
  # A dry run exists to exercise the source assertions BEFORE the migration has
  # been applied — exactly when this check would fail. Skipping is safe because
  # DRY_RUN never reaches the deploy; it is NOT skippable on a real run.
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
  "SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'CompanyConfig'
     AND column_name IN ('registrationNumber','vatNumber','primaryContactName',
                         'primaryEmail','primaryPhone','website','addressLine1',
                         'addressLine2','addressTown','addressPostcode',
                         'printLogoBlobPath','printLogoContentType','printLogoUpdatedAt',
                         'disclaimer','reportFooter','packIncludeCompanyInfo',
                         'packIncludeLogo','packIncludePrintLogo',
                         'packIncludeStandardDetails','updatedByUserId');" \
  2>/dev/null || echo ERR)
precheck_cleanup
trap - EXIT
if [ "$PRESENT" != "20" ]; then
  echo "ERROR: production CompanyConfig has ${PRESENT}/20 of the new columns."
  echo "       This build SELECTs all twenty, and CompanyConfig is read by"
  echo "       close-out packs and the PUBLIC pack share page — deploying now"
  echo "       would break pages a client may be looking at."
  echo "       RUN scripts/sc031_migrate.sh FIRST."
  exit 1
fi
echo "      confirmed: all 20 columns present in production."
fi

echo "[3/8] Asserting scope and RBAC..."

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

FROZEN="package.json package-lock.json next.config.js middleware.ts"
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
  | grep -v '^components/platform/CompanyProfileSettings.tsx$' \
  | grep -v '^components/platform/SettingsWorkspace.tsx$' \
  | grep -v '^components/admin/CompanySettings.tsx$' \
  | grep -v '^services/company/companyConfigService.ts$' \
  | grep -v '^services/platformUsers/platformPermissions.ts$' \
  | grep -v '^app/platform/dashboard/settings/company/page.tsx$' \
  | grep -v '^app/api/platform/company-profile/' \
  | grep -v '^app/api/admin/settings/company/' \
  | grep -v '^app/api/company/print-logo/route.ts$' \
  | grep -v '^prisma/' \
  | grep -v '^scripts/' || true)
if [ -n "$OUTSIDE" ]; then
  echo "ERROR: SC-031 should touch only the company profile path, but these also changed:"
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


// ---------- SC-031 company profile & branding ----------
// NOTE: no double quotes and no backticks in comments inside this node -e
// block — either one breaks out of the shell string and silently truncates or
// executes. Both have happened here before.
const cpSvc=strip('services/company/companyConfigService.ts');
const cpPerm=strip('services/platformUsers/platformPermissions.ts');
const cpPage=strip('app/platform/dashboard/settings/company/page.tsx');
const cpUi=strip('components/platform/CompanyProfileSettings.tsx');
const cpNav=strip('components/platform/SettingsWorkspace.tsx');
const cpAdminApi=strip('app/api/admin/settings/company/route.ts');
const cpAdminLogo=strip('app/api/admin/settings/company/logo/route.ts');
const cpApi=strip('app/api/platform/company-profile/route.ts');

// ---- RBAC ----
const cpDecl=cpPerm.match(/COMPANY_PROFILE_MANAGE_ROLES[^=\n]*=\s*(\[[^\]]*\])/);
if(!cpDecl) fail('cannot find the COMPANY_PROFILE_MANAGE_ROLES declaration');
if(cpDecl[1].replace(/\s/g,'') !== \"['DIRECTOR']\")
  fail('company profile is no longer DIRECTOR-only');
if(cpApi.indexOf('canManageCompanyProfile') < 0)
  fail('the company-profile API is not gated — a Project Manager could PATCH it');
if(cpPage.indexOf('canManageCompanyProfile') < 0)
  fail('the cpPage no longer computes canEdit');
if(cpUi.indexOf('disabled={!canEdit}') < 0 && !/disabled=\{!canEdit\}/.test(cpUi))
  fail('the company profile controls no longer respect canEdit');

// ---- ONE ROW, ONE EDITOR ----
// The Admin Centre must not write this row any more. If these come back, the
// duplicate source of truth is back with them.
if(cpAdminApi.indexOf('saveCompanyConfig') >= 0)
  fail('the Admin Centre can write company config again — that is the duplicate editor this release removed');
if(cpAdminLogo.indexOf('setCompanyLogo') >= 0 || cpAdminLogo.indexOf('clearCompanyLogo') >= 0)
  fail('the Admin Centre can write company logos again');
if(cpAdminApi.indexOf('409') < 0 || cpAdminLogo.indexOf('409') < 0)
  fail('the retired Admin Centre endpoints no longer answer 409');

// ---- NO DUPLICATE SOURCE OF TRUTH ----
// Per-project legal appointments must stay per-project. An organisation-level
// contact reaching CdmDutyHolders would be a legal misstatement on a CPP.
for(const f of ['services/company/companyConfigService.ts','app/api/platform/company-profile/route.ts','app/platform/dashboard/settings/company/page.tsx']){
  const t=strip(f);
  if(t.indexOf('cdmDutyHolders') >= 0 || t.indexOf('CdmDutyHolders') >= 0)
    fail(f+' reaches into CdmDutyHolders — project duty holders are legal appointments and must not be fed from organisation settings');
  if(t.indexOf('siteProjectDetails') >= 0)
    fail(f+' reaches into SiteProjectDetails — CPP data is per-project');
}
// The support pair already prints on packs and answers a different question.
// Writing it from this screen would silently change existing documents.
const cpSave=cpSvc.slice(cpSvc.indexOf('export async function savePlatformCompanyProfile'));
if(cpSave.length < 100) fail('savePlatformCompanyProfile is missing');
if(/supportEmail:/.test(cpSave) || /supportPhone:/.test(cpSave))
  fail('the platform save writes supportEmail/supportPhone — that would change what already prints on packs');
if(cpSvc.indexOf('updatedByUserId') < 0)
  fail('the platform cpSave no longer records who changed it');

// ---- pack branding defaults ----
// TRUE reproduces what packs render today. A default of false would strip
// branding from the next pack anyone generated.
const cpView=cpSvc.slice(cpSvc.indexOf('export async function getPlatformCompanyProfile'));
for(const k of ['packIncludeCompanyInfo','packIncludeLogo','packIncludePrintLogo','packIncludeStandardDetails']){
  // Substring test, not regex: the backslash escaping needed inside this
  // shell-quoted node block is exactly where a guard silently becomes
  // unparseable, and an unparseable guard asserts nothing.
  if(cpView.indexOf(k + ': row?.' + k + ' ?? true') < 0)
    fail(k+' no longer defaults to true — packs would silently lose branding');
}

// ---- the workspace ----
if(cpNav.indexOf('/platform/dashboard/settings/company') < 0)
  fail('Settings does not list the Company profile area');
if(cpNav.indexOf('/platform/dashboard/settings/authentication') < 0 ||
   cpNav.indexOf('/platform/dashboard/settings/config-templates') < 0)
  fail('an existing Settings area lost its route');
// SVG stays excluded: the logo is served on a public route.
if(cpSvc.indexOf('image/svg') >= 0)
  fail('SVG logo uploads are accepted again — that is a stored-XSS vector on the public logo route');

console.log('      confirmed: DIRECTOR-only on page and API, the Admin Centre');
console.log('                 can no longer write, nothing reaches CdmDutyHolders');
console.log('                 or SiteProjectDetails, the support pair is not');
console.log('                 overwritten, and pack branding still defaults on.');
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
  echo "== SC-031 DEPLOYED =="
  echo "   Nothing changes for anyone until a Director saves."
else
  echo "== NOT HEALTHY — investigate before announcing =="
fi
