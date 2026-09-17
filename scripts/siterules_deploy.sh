#!/usr/bin/env bash
# SITE RULES LIBRARY — production deploy.
#
# A standard library of UK construction site rules, selectable per site in
# Site > Operative experience > Site rules, shown during induction under the
# single existing "site rules and signage" acknowledgement.
#
# THE MIGRATION RUNS FIRST AND IS NOT PART OF THIS SCRIPT. Production startup is
# `next start`, so `prisma migrate deploy` never runs here; the enum value is
# added by hand from ~/site_rule_enum.sql before this script is invoked, and
# [2/9] refuses to deploy until it can see the value in the live database. That
# ordering is not optional: Prisma names every enum value strictly, and a build
# that can write SITE_RULE against a database that does not know it fails at the
# write, on an operative's phone, at the gate.
#
# Rollback is a redeploy of the previous build. The enum value stays — Postgres
# cannot remove one, and an unused label is inert. See ~/site_rule_enum_rollback.sql.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/siterules_deploy.zip
PRODURL_FILE="${PRODURL_FILE:?set PRODURL_FILE to the file holding the production DATABASE_URL}"

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

# Kudu VFS is not always readable on this app. The served HTML always is, and it
# carries the build id the RUNNING process is using — which is the thing that
# actually matters at cut-over, and is strictly better evidence than a file on
# disk. Used as the fallback and as the post-restart confirmation.
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "== SITE RULES LIBRARY — DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/9] Current prod build id:"
OLD_BUILD=$(kudu_buildid)
[ -z "$OLD_BUILD" ] && OLD_BUILD=$(served_buildid)
echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

# ---------------------------------------------------------------------------
echo "[2/9] Asserting the MIGRATION is already live..."
# The one thing that must be true before anything else happens. Asked of the
# production database, not of a file, a memory or an earlier terminal scroll.
ENUM_OK=$(psql "$(sed 's/?schema=public//' "$PRODURL_FILE")" -Atc \
  "SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
                   WHERE t.typname='ChecklistItemType' AND e.enumlabel='SITE_RULE');" 2>&1)
if [ "$ENUM_OK" != "t" ]; then
  echo "ERROR: SITE_RULE is not in the production ChecklistItemType enum."
  echo "       psql said: ${ENUM_OK}"
  echo "       Run ~/site_rule_enum.sql against production BEFORE this deploy."
  exit 1
fi
echo "      confirmed: SITE_RULE exists in the production enum."

# No rules should exist yet — the migration is additive and writes nothing. A
# non-zero count here means something already wrote rules, which the previous
# build cannot do, so the situation is not what this script assumes.
RULE_ROWS=$(psql "$(sed 's/?schema=public//' "$PRODURL_FILE")" -Atc \
  'SELECT count(*) FROM "ChecklistItem" WHERE type = '"'"'SITE_RULE'"'"';' 2>&1)
echo "      existing SITE_RULE rows in production: ${RULE_ROWS}"

# ---------------------------------------------------------------------------
echo "[3/9] Asserting the feature, and the things it must not have touched..."

# THE WORKING TREE IS WHAT SHIPS. [6/9] zips the working tree, not HEAD, so an
# uncommitted edit would deploy without ever being asserted.
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo "ERROR: working tree is not clean, and the zip is built from the working tree:"
  echo "$DIRTY" | sed 's/^/         /'
  exit 1
fi

# Everything below matches SOURCE WITH COMMENTS STRIPPED. These files carry long
# explanatory comments that name the very things being asserted, and a plain grep
# matches the prose and passes while the code is missing. This repo has been
# bitten by exactly that; do not simplify these into greps.
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const fail=(m)=>{console.error('ERROR: '+m);process.exit(1);};

// ---------------- the enum ----------------
const sch=fs.readFileSync('prisma/schema.prisma','utf8');
const enumBlock=sch.match(/enum ChecklistItemType \{[\s\S]*?\n\}/);
if(!enumBlock) fail('the ChecklistItemType enum is gone from the schema');
if(!/\bSITE_RULE\b/.test(enumBlock[0]))
  fail('SITE_RULE is not in the schema enum — the build cannot write a rule');
// The three that were already there must still be there, in place. An enum value
// removed or renamed is a data-destroying change wearing the same diff shape.
for (const v of ['ACKNOWLEDGEMENT','YES_NO','PPE_CONFIRM'])
  if(!new RegExp('\\\\b'+v+'\\\\b').test(enumBlock[0]))
    fail(v+' has vanished from ChecklistItemType');

// ---------------- the library, and its two tiers ----------------
// The interface declaration carries a 'label:' and a 'defaultSelected:' of its
// own. Counting them inflates both totals equally, so the comparison below still
// discriminates - but the failure message would name a count nobody recognises.
// Drop the interface before counting.
const libRaw=strip('services/checklists/ukSiteRulesLibrary.ts');
const libStart=libRaw.indexOf('UK_SITE_RULES_LIBRARY: SiteRuleTemplate');
if(libStart<0) fail('the library export is gone');
const lib=libRaw.slice(libStart);
const ruleCount=(lib.match(/label:/g)||[]).length;
if(ruleCount<12) fail('the standard library has only '+ruleCount+' rules');
// Every entry must state its tier. A missing flag would silently drop a rule off
// every new site, or silently put a site-specific one on it.
const tierCount=(lib.match(/defaultSelected:/g)||[]).length;
if(tierCount<ruleCount)
  fail(tierCount+' of '+ruleCount+' library entries state a tier - every one must');
if(!/UK_SITE_RULES_DEFAULT/.test(lib)) fail('the default tier export is gone');
// The seed must take the DEFAULT tier, never the whole library.
const tpl=strip('services/checklists/ukInductionTemplate.ts');
if(!/UK_SITE_RULES_DEFAULT\.map/.test(tpl))
  fail('new sites are not seeded from the DEFAULT tier - optional templates would ship to every site');
if(/UK_SITE_RULES_LIBRARY/.test(tpl))
  fail('the template references the whole library again');
// The rationalised removals, named individually. A count would pass even if the
// wrong ones had gone.
for (const [what,pattern] of [
  ['permit to work',/valid permit where one is required/],
  ['site signage',/Obey all site signage/],
  ['possession-phrased drugs rule',/No alcohol or drugs on site/],
]) if(pattern.test(lib)) fail('the '+what+' rule is back in the library');
// ...and the five conversions must still EXIST, as optional templates.
for (const [what,pattern] of [
  ['smoking',/Smoking and vaping/],
  ['waste segregation',/Segregate waste/],
  ['site traffic',/site speed limit/],
  ['mobile phones',/Mobile phones must not be used/],
  ['respect and harassment',/Bullying and harassment/],
]) if(!pattern.test(lib)) fail('the '+what+' optional template has been deleted, not converted');

// ---------------- the flow ----------------
const flow=strip('services/checklists/inductionFlow.ts');
if(!/SITE_RULE/.test(flow)) fail('inductionFlow does not know about SITE_RULE');
if(!/export function isSiteRulesAck/.test(flow))
  fail('isSiteRulesAck is gone — nothing would host the rules');
// A rule must never become something to answer. This is the single most
// important invariant in the feature: a required rule with no way to tick it
// would lock every operative out of the induction.
if(!/i\.type === 'SITE_RULE'/.test(flow))
  fail('buildInductionSteps no longer separates rules from answerable items');
if(!/case 'rules':/.test(flow))
  fail('isStepComplete has no rules case — an orphan rules screen would block');

// ---------------- the service ----------------
const svc=strip('services/checklists/siteRulesService.ts');
if(!/export function validateSiteRules/.test(svc)) fail('validateSiteRules is gone');
if(!/export function mergeRuleItems/.test(svc)) fail('mergeRuleItems is gone');
if(!/export function buildRuleRows/.test(svc))
  fail('buildRuleRows is gone - the editor row logic would be untestable again');
if(!/required: false,/.test(svc))
  fail('the service no longer forces required:false — a rule could gate a screen');
// It must go through saveChecklist, so versioning stays in ONE place. A second
// copy of the version rule is how historic check-ins start pointing at content
// nobody agreed to.
if(!/saveChecklist\(siteId, merged\)/.test(svc))
  fail('the service is not saving through saveChecklist — versioning would be bypassed');

// ---------------- the free-text field stays SEPARATE ----------------
// The owner asked for these to be two different things. If siteRules ever left
// SiteInformation, the reference material and the induction set have been merged.
if(!/siteRules\s+String\?/.test(sch))
  fail('SiteInformation.siteRules is gone — the free-text field must stay separate');

// ---------------- the two silent-failure fixes ----------------
const bld=strip('components/admin/ChecklistBuilder.tsx');
if(!/SITE_RULE:/.test(bld))
  fail('the admin builder has no SITE_RULE option — it would show every rule as an Acknowledgement and convert it on first touch');
const sub=strip('app/admin/(dashboard)/submissions/[id]/page.tsx');
if(!/type === 'SITE_RULE'/.test(sub))
  fail('the submission detail page would show every rule as \"Not acknowledged\" in red');

// ---------------- the editor is wired in ----------------
const exp=strip('app/platform/dashboard/sites/[id]/experience/page.tsx');
if(!/<SiteRulesConfig/.test(exp))
  fail('the Site rules section is not rendered on Operative experience');
if(exp.indexOf(\"key: 'site-rules'\")<0)
  fail('the Site rules section is not registered in the workspace nav');
// PPE must still be there and untouched beside it.
if(exp.indexOf(\"key: 'ppe'\")<0) fail('the PPE section has gone missing');

// ---------------- an unticked rule is not a deleted rule ----------------
// A strikethrough reads as 'removed' or 'no longer valid'. An unticked rule is
// neither: it is a rule this site has chosen not to show, and the checkbox says
// so on its own. Asserted because it is a judgement that is easy to undo by
// reflex while tidying styles.
const cfg=strip('components/platform/SiteRulesConfig.tsx');
if(/line-through/.test(cfg))
  fail('unticked rules are struck through again - that reads as deleted, not unselected');
if(/border-dashed/.test(cfg))
  fail('unticked rules have a dashed border again - same problem as the strikethrough');
if(cfg.indexOf('Selected rules are shown to operatives during their induction')<0)
  fail('the short intro copy is gone');
// The editor must receive the WHOLE library, or the optional templates are
// unreachable and the conversion was a deletion.
if(!/library=\{SITE_RULE_LIBRARY\}/.test(exp))
  fail('the editor is not being given the full library - optional templates would be unreachable');
if(!/buildRuleRows\(initial, library\)/.test(cfg))
  fail('the editor is not building its rows from the shared, tested function');
if(cfg.indexOf(\"'Optional'\")<0)
  fail('the Optional badge is gone - an unadopted template would look like a deselected default');

console.log('      confirmed: enum intact, rules are never answerable, versioning');
console.log('                 still goes through saveChecklist, the free-text field');
console.log('                 is still separate, and both silent-failure paths');
console.log('                 (admin builder dropdown, submission detail) are fixed.');
" || exit 1

echo "[4/9] Running the verification suite..."
npx tsx scripts/site_rules_verify.ts || { echo "ERROR: site_rules_verify failed"; exit 1; }
npx tsx scripts/induction_grouping_verify.ts >/dev/null 2>&1 \
  || { echo "ERROR: induction_grouping_verify failed — the induction regressed"; exit 1; }
echo "      induction_grouping_verify: passed"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "== DRY RUN — assertions passed, stopping before build/deploy =="
  exit 0
fi

echo "[5/9] Type-checking, linting and building..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
npx tsc --noEmit || { echo "ERROR: typecheck failed"; exit 1; }
rm -rf .next
npm run build 2>&1 | tail -4
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "      guarding the compiled artifact..."
npx tsx scripts/site_rules_artifact_guard.ts \
  || { echo "ERROR: the feature is not in the build that would ship"; exit 1; }

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
  echo "      [$i] prod build id on disk: ${CURB:-<unreadable>}"
  if [ "$CURB" = "$NEW_BUILD" ]; then LANDED=yes; break; fi
done
if [ -z "$LANDED" ]; then
  echo "      build id not confirmed on disk; will confirm from the SERVED page instead."
fi

echo "[9/9] Cutting over (stop/start) and health-checking..."
# A zip deploy does not reliably restart the process on this app. The restart is
# what makes the new build the one actually serving, so it is unconditional.
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 20); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done

SERVED=$(served_buildid)
echo "      served build id: ${SERVED:-<unreadable>}"

# The routes must be REACHABLE, not 500. Unauthenticated they redirect to
# sign-in (3xx) — that is a pass. A 5xx means the new build is broken on a page
# nobody has opened yet.
echo "      route smoke test (3xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in \
  /platform/dashboard/sites \
  /check-in/site ; do
  RC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${RC}"
  # 000* not 000: curl prints "000" via -w AND the `|| echo 000` fires, so an
  # unreachable route reports "000000", which a bare "000" pattern never matched.
  case "$RC" in 5*|000*) SMOKE_FAIL=yes ;; esac
done

echo
echo "== DEPLOY SUMMARY =="
echo "   old build:    ${OLD_BUILD:-<unknown>}"
echo "   new build:    ${NEW_BUILD}"
echo "   served build: ${SERVED:-<unreadable>}"
echo "   health:       HTTP ${CODE}"
echo "   routes:       ${SMOKE_FAIL:+ONE OR MORE FAILED}${SMOKE_FAIL:-all reachable}"
if [ "$CODE" = "200" ] && [ -z "$SMOKE_FAIL" ] && [ "$SERVED" = "$NEW_BUILD" ]; then
  echo "== SITE RULES LIBRARY DEPLOYED =="
else
  echo "== NOT CONFIRMED — investigate before announcing =="
  exit 2
fi
