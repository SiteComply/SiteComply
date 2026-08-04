#!/usr/bin/env bash
#
# Platform UX Refresh — production CODE deploy. NO migration: the refresh
# introduces no schema change, which is what keeps rollback code-only.
#
# The scXXX_deploy.sh guards assert that a FEATURE's code is present. A UX
# refresh ships no feature, so the guards here assert the opposite kind of
# thing: that the frame changed as intended AND that the things a layout
# refactor silently breaks are still intact.
#
# Rollback: scripts/uxrefresh_rollback.sh --confirm
#
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/uxrefresh_deploy.zip

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== UX REFRESH CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Scope gate — the diff must be presentation-only..."
bash scripts/uxrefresh_gate.sh >/tmp/uxgate.out 2>&1 \
  || { echo "ERROR: scope gate FAILED — refusing to deploy:"; cat /tmp/uxgate.out; exit 1; }
echo "      confirmed: no logic, permission, migration, dependency or token change."

echo "[3/8] Frame invariants..."
# The width cap must be off the portal shell. Checked on the className, not the
# file — the explanatory comment mentions the old value on purpose.
grep -q 'max-w-\[1600px\]' components/platform/PlatformShell.tsx \
  || { echo "ERROR: content width cap missing — aborting"; exit 1; }
grep -q 'className="mx-auto flex w-full max-w-6xl' components/platform/PlatformShell.tsx \
  && { echo "ERROR: the old portal-wide max-w-6xl container is still present — aborting"; exit 1; }
# The rail must not be a card again.
grep -q 'rounded-xl border border-line bg-surface p-2 shadow-card' components/platform/PlatformShell.tsx \
  && { echo "ERROR: the sidebar is rendering as a card again — aborting"; exit 1; }
echo "      confirmed: content capped at 1600px, rail is not a card."

echo "[4/8] Things a layout refactor breaks silently..."
# SC-016's live badge is mounted in the shell. Lose it and notifications quietly
# stop updating without anything looking wrong.
grep -q '<NotificationPoller initialCount={notificationCount} />' components/platform/PlatformShell.tsx \
  || { echo "ERROR: NotificationPoller not mounted — the live badge would die — aborting"; exit 1; }
# Keyboard users reach content through this.
grep -q 'Skip to content' components/platform/PlatformShell.tsx \
  || { echo "ERROR: skip link missing — aborting"; exit 1; }
# The nav must still be filtered by EFFECTIVE per-site permissions (SC-022).
grep -q 'allowedModules' components/platform/PlatformShell.tsx \
  && grep -q 'allowedModules.includes(item.module)' components/platform/PlatformNav.tsx \
  || { echo "ERROR: nav is no longer filtered by effective permissions — aborting"; exit 1; }
grep -q "aria-current={active ? 'page' : undefined}" components/platform/PlatformNav.tsx \
  || { echo "ERROR: nav lost aria-current — aborting"; exit 1; }
echo "      confirmed: live badge, skip link, effective-permission filtering, aria-current."

echo "[5/8] Nav clusters must be CONTIGUOUS..."
# Interleaved clusters put the spacing in arbitrary places and split items that
# belong together. This caught exactly that during Phase 1.
node -e "
const s=require('fs').readFileSync('components/platform/PlatformNav.tsx','utf8');
const seq=[...s.matchAll(/group: '([a-z]+)'/g)].map(m=>m[1]);
if(seq.length!==11){console.error('expected 11 grouped nav items, got '+seq.length);process.exit(1);}
const runs=seq.filter((g,i)=>i===0||g!==seq[i-1]);
if(new Set(runs).size!==runs.length){console.error('nav clusters are NOT contiguous: '+runs.join(','));process.exit(1);}
console.log('      confirmed: '+runs.length+' contiguous clusters — '+runs.join(' | '));
" || exit 1

echo "[5b] Shared layout primitives (Phase 2)..."
# The point of the primitives is that there is ONE definition of each idea. If a
# screen quietly grows its own again, the refresh has failed in the exact way it
# was meant to prevent.
for f in Panel TableSurface RecordHeader; do
  [ -f "components/platform/$f.tsx" ] \
    || { echo "ERROR: components/platform/$f.tsx missing — aborting"; exit 1; }
done
# Section must delegate to Panel, not re-declare a panel.
grep -q '<Panel title={title}' components/platform/siteDetailUi.tsx \
  || { echo "ERROR: Section no longer delegates to Panel — aborting"; exit 1; }
# The benchmark must render through the shared primitive too, or "extracted from
# the benchmark" stops being true the first time one of them is edited.
grep -q '<Panel title={title} hint={hint}>' components/platform/AuditScoringConfig.tsx \
  || { echo "ERROR: Audit Scoring no longer uses the shared Panel — aborting"; exit 1; }
# Registers must use the joined surface, not a detached filter card.
for r in actions audits documents permits; do
  grep -q 'TABLE_TOOLBAR_CLASS' "app/platform/dashboard/$r/page.tsx" \
    || { echo "ERROR: $r register is not using the shared toolbar — aborting"; exit 1; }
  grep -q 'mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-card' \
    "app/platform/dashboard/$r/page.tsx" \
    && { echo "ERROR: $r register still has a detached filter card — aborting"; exit 1; }
done
echo "      confirmed: Panel/TableSurface/RecordHeader shared, 4 registers joined, benchmark on the shared panel."

echo "[5c] Worker Experience workspace (Phase 3)..."
WE='app/platform/dashboard/sites/[id]/experience/page.tsx'
[ -f components/platform/SectionWorkspace.tsx ] \
  || { echo "ERROR: SectionWorkspace.tsx missing — aborting"; exit 1; }
grep -q '<SectionWorkspace' "$WE" \
  || { echo "ERROR: Worker Experience is not using the workspace — aborting"; exit 1; }
# EVERY panel must still be rendered. Losing one would silently remove a manager's
# ability to configure part of the worker experience, and the page would still
# look perfectly fine.
for c in SiteBulletins WorkerDashboardConfig SiteInformationConfig \
         KnowledgeCheckConfig InductionValidityConfig GpsCheckInConfig SiteContacts; do
  grep -q "<$c" "$WE" \
    || { echo "ERROR: Worker Experience no longer renders $c — aborting"; exit 1; }
done
# Each panel keeps its OWN save + API call; the workspace is presentational. If a
# panel stopped being gated on canConfigureDashboard, a read-only role could see
# controls it must not have.
[ "$(grep -c 'canEdit={canConfigureDashboard}' "$WE")" -ge 6 ] \
  || { echo "ERROR: config panels are no longer gated on canConfigureDashboard — aborting"; exit 1; }
echo "      confirmed: workspace in use, all 7 panels rendered, edit gates intact."

echo "[5d] Site Details workspace (Phase 4)..."
# The status label defect: a COMPLETED project must never render as "Archived".
# They are different states reached by different workflows with different ways
# back, and the old ternary pre-dated COMPLETED existing.
if grep -rn "=== 'ACTIVE' ? 'Active' : 'Archived'" app components --include='*.tsx' \
     | grep -v '^\s*//' | grep -q 'value=\|label='; then
  echo "ERROR: a site status is still hardcoded to Active/Archived — a COMPLETED project would be mislabelled — aborting"; exit 1
fi
grep -q 'SITE_STATUS_LABEL' components/platform/SiteDetailHeader.tsx \
  && grep -q 'SITE_STATUS_LABEL' 'app/platform/dashboard/sites/[id]/page.tsx' \
  || { echo "ERROR: site status is not using the shared labels — aborting"; exit 1; }
# The duplicate heading defect.
[ "$(grep -c 'title="Site information"' 'app/platform/dashboard/sites/[id]/page.tsx')" -eq 0 ] \
  || { echo "ERROR: the duplicated 'Site information' heading is back — aborting"; exit 1; }
# The site header must go through the shared record header.
grep -q '<RecordHeader' components/platform/SiteDetailHeader.tsx \
  || { echo "ERROR: SiteDetailHeader is not using RecordHeader — aborting"; exit 1; }
# SC-025: a completed project must still announce itself before anything else,
# and must still offer neither editing nor the archive control.
grep -q "site.status === 'COMPLETED' ?" 'app/platform/dashboard/sites/[id]/page.tsx' \
  || { echo "ERROR: the completed-project banner is gone — aborting"; exit 1; }
grep -q "site.status !== 'COMPLETED' && (" components/platform/SiteDetailHeader.tsx \
  || { echo "ERROR: a completed project would be offered edit/archive — aborting"; exit 1; }
echo "      confirmed: shared status labels, no duplicate heading, RecordHeader in use, SC-025 completion behaviour intact."

echo "[5e] WorkSurface pattern (Phase 5)..."
[ -f components/platform/WorkSurface.tsx ] \
  && [ -f components/platform/outstandingWorkOrder.ts ] \
  || { echo "ERROR: WorkSurface / outstanding-work order missing — aborting"; exit 1; }
# The last register that rendered one card per row must stay a table.
grep -q '<WorkSurface' app/platform/dashboard/submissions/page.tsx \
  || { echo "ERROR: Check-ins is not using the work surface — aborting"; exit 1; }
grep -q 'space-y-3' app/platform/dashboard/submissions/page.tsx \
  && { echo "ERROR: Check-ins has reverted to stacked row-cards — aborting"; exit 1; }
# Selection must resolve against rows the viewer actually received, never a raw
# id lookup — otherwise a guessed id could confirm a record exists out of scope.
grep -q 'resolveSelected(searchParams.item, submissions)' app/platform/dashboard/submissions/page.tsx \
  || { echo "ERROR: check-in selection is not scoped to the returned rows — aborting"; exit 1; }
# Every record surface opens the same way.
for f in 'app/platform/dashboard/actions/[id]/page.tsx' \
         'app/platform/dashboard/audits/[id]/page.tsx' \
         'app/platform/dashboard/permits/[id]/page.tsx' \
         'app/platform/dashboard/workers/[id]/page.tsx' \
         components/platform/SiteDetailHeader.tsx; do
  grep -q '<RecordHeader' "$f" \
    || { echo "ERROR: $f is not using RecordHeader — aborting"; exit 1; }
done
echo "      confirmed: WorkSurface in use, check-ins is a table, selection scoped, 5 record surfaces share RecordHeader."

echo "[5f] Compliance outstanding-work workspace (Phase 5b)..."
CP='app/platform/dashboard/sites/[id]/compliance/page.tsx'
grep -q '<WorkSurface' "$CP" \
  || { echo "ERROR: Compliance is not a work surface — aborting"; exit 1; }
# The two separate panels must be gone, or it is still two lists.
grep -qE '<Section title="Outstanding (audits|actions)">' "$CP" \
  && { echo "ERROR: Compliance still renders separate audits/actions panels — aborting"; exit 1; }
# THE STANDING RULE: merging lists must never merge permissions. The merged array
# may only be built from the two already-gated variables, each of which is [] when
# the viewer lacks that module. If a future edit sourced rows directly from a
# service call here, a viewer without audits:view could see audit rows.
grep -q 'const audits = canViewAudits' "$CP" \
  && grep -q 'const actions = canViewActions' "$CP" \
  || { echo "ERROR: audits/actions are no longer separately gated — aborting"; exit 1; }
grep -q '\.\.\.audits\.map' "$CP" && grep -q '\.\.\.actions\.map' "$CP" \
  || { echo "ERROR: the merged list is not built from the gated arrays — aborting"; exit 1; }
# Checked on the WHOLE FILE, not line by line: Prettier wraps
#   const audits = canViewAudits
#     ? await listOutstandingAuditsForSite(...)
# so the call sits on a line with no `canView` on it. A line-based check reports
# a false positive here — it did, and blocked a correct deploy.
node -e "
const s=require('fs').readFileSync('$CP','utf8');
for (const [fn, gate] of [['listOutstandingAuditsForSite','canViewAudits'],
                          ['listOutstandingActionsForSite','canViewActions']]) {
  const re=new RegExp(fn+'\\\\(','g'); let m, n=0;
  while ((m=re.exec(s))) {
    n++;
    // The gate must appear in the 120 characters immediately before the call.
    const before=s.slice(Math.max(0,m.index-120), m.index);
    if (!before.includes(gate)) {
      console.error('ERROR: a '+fn+' call is not gated on '+gate);
      process.exit(1);
    }
  }
  if (n===0) { console.error('ERROR: '+fn+' is no longer called'); process.exit(1); }
}
" || exit 1
# Ids must stay kind-prefixed or ?item= could select the wrong record.
grep -q "id: \`audit:" "$CP" && grep -q "id: \`action:" "$CP" \
  || { echo "ERROR: merged row ids are not kind-prefixed — aborting"; exit 1; }
# The agreed order must come from the shared module, not a local sort.
grep -q 'sortOutstandingWork(workRows, now)' "$CP" \
  || { echo "ERROR: Compliance is not using the agreed outstanding-work order — aborting"; exit 1; }
echo "      confirmed: one work surface, gates unmerged, ids prefixed, agreed order in use."

echo "[5g] Workers roster workspace (Phase 5c)..."
WK='app/platform/dashboard/sites/[id]/workers/page.tsx'
grep -q '<WorkSurface' "$WK" \
  || { echo "ERROR: Workers is not a roster work surface — aborting"; exit 1; }
# The two panels showed THE SAME PEOPLE. They must not come back.
grep -qE '<Section title=\{?.?(Current workers|`Current workers)' "$WK" \
  && { echo "ERROR: the 'Current workers on site' panel is back — aborting"; exit 1; }
grep -q '<Section title="Recent check-ins">' "$WK" \
  && { echo "ERROR: the 'Recent check-ins' panel is back — aborting"; exit 1; }
# One row per PERSON is what removes the duplicate; a list keyed on submission
# id would silently reintroduce it.
grep -q 'const byWorker = new Map' "$WK" \
  || { echo "ERROR: the roster is no longer keyed per worker — aborting"; exit 1; }
# Assignment facts must stay behind canManageWorkerAccess. `access` is null
# without it, so the roster must read assignments through `access?.rows`.
grep -q 'access?.rows ?? \[\]' "$WK" \
  || { echo "ERROR: assignments are not read through the gated access object — aborting"; exit 1; }
node -e "
const s=require('fs').readFileSync('$WK','utf8');
const m=s.match(/const access = ([\s\S]{0,80})/);
if(!m || !m[1].includes('canManageWorkerAccess')) {
  console.error('ERROR: listSiteAssignments is not gated on canManageWorkerAccess');
  process.exit(1);
}
" || exit 1
# SC-023 management must remain reachable — invite/approve/suspend/transfer,
# enforcement and requirements all live in this component.
grep -q '<WorkerAccessManager' "$WK" \
  || { echo "ERROR: worker access management is no longer reachable — aborting"; exit 1; }
grep -q 'canSetEnforcement={canSetEnforcement(viewer.role)}' "$WK" \
  || { echo "ERROR: enforcement is no longer gated on canSetEnforcement — aborting"; exit 1; }
echo "      confirmed: one roster keyed per worker, assignments gated, SC-023 management intact."

echo "[5h] Reports + AI density (Phase 6)..."
RV=components/platform/ReportView.tsx
# THE FILTER CONTRACT IS FROZEN. Reports are in scope for layout only — every
# input name, value and default must survive, because the CSV exports read the
# same query parameters and an export must always match the screen.
for tok in 'name="from"' 'name="to"' 'name="sites"' 'name="includeCompleted"' \
           'defaultValue={filters.fromStr}' 'defaultValue={filters.toStr}' \
           'defaultChecked={filters.includeCompleted}' 'defaultChecked={selected.has(s.id)}' \
           'method="get"' 'action={action}'; do
  grep -qF "$tok" "$RV" \
    || { echo "ERROR: report filter contract broken — $tok missing — aborting"; exit 1; }
done
# SC-025's opt-in must stay conditional on there being something to include.
grep -q 'filters.completedCount > 0' "$RV" \
  || { echo "ERROR: the include-completed control is no longer conditional — aborting"; exit 1; }
echo "      confirmed: report filter contract intact (names, values, defaults)."

# AI LABELLING MUST NOT COLLAPSE. Condensing the prose is in scope; hiding the
# badge or the verification warning behind a click is not — SC-024 Phase 3's
# commitment is that AI output is labelled and carries its caveat wherever it
# appears.
node -e "
const s=require('fs').readFileSync('components/platform/AiSummaryPanel.tsx','utf8');
const i=s.indexOf('<details'), j=s.indexOf('</details>');
if (i === -1) { console.log('      (no disclosure in the AI panel)'); process.exit(0); }
const inside=s.slice(i,j);
for (const must of ['AI executive summary','always verify against the']) {
  if (!s.includes(must)) { console.error('ERROR: AI labelling LOST: '+must); process.exit(1); }
  if (inside.includes(must)) { console.error('ERROR: AI labelling is inside a disclosure: '+must); process.exit(1); }
}
console.log('      confirmed: AI badge, heading and verification warning stay always-visible.');
" || exit 1

echo "[5i] Settings, libraries and print output (Phase 7)..."
# Both template libraries must use the shared panel — they are the same kind of
# governance screen and previously each invented its own chrome.
for f in components/platform/ConfigTemplateLibrary.tsx \
         components/platform/PermissionTemplateLibrary.tsx; do
  grep -q "from '@/components/platform/Panel'" "$f" \
    || { echo "ERROR: $f is not using the shared Panel — aborting"; exit 1; }
done
# APPLICATION CHROME MUST NOT PRINT. The CPP and the close-out pack are handover
# documents; the print check found the whole navigation rail printing down the
# left of the CPP, squeezing it into two thirds of the page.
grep -q 'md:border-r print:hidden' components/platform/PlatformShell.tsx \
  || { echo "ERROR: the navigation rail would print on handover documents — aborting"; exit 1; }
grep -q 'print:max-w-none print:p-0' components/platform/PlatformShell.tsx \
  || { echo "ERROR: the screen container is not neutralised in print — aborting"; exit 1; }
# The CPP's on-screen reading measure must not constrain the printed page.
grep -q 'max-w-5xl' 'app/platform/dashboard/sites/[id]/cpp/page.tsx' \
  && grep -q 'print:max-w-none' 'app/platform/dashboard/sites/[id]/cpp/page.tsx' \
  || { echo "ERROR: CPP measure/print rules missing — aborting"; exit 1; }
# The DRAFT framing is a CDM commitment, not decoration.
grep -q 'DRAFT' 'app/platform/dashboard/sites/[id]/cpp/page.tsx' \
  || { echo "ERROR: the CPP DRAFT banner is gone — aborting"; exit 1; }
echo "      confirmed: shared Panel in both libraries, chrome hidden in print, CPP measure + DRAFT intact."

echo "[5j] Settings workspace + mobile/print sweep (Phase 8)..."
# Settings is ONE workspace: all three routes render it, and the URLs are
# unchanged so links elsewhere and SC-021 P2's historical redirects still resolve.
for f in app/platform/dashboard/settings/page.tsx \
         app/platform/dashboard/settings/config-templates/page.tsx \
         app/platform/dashboard/settings/permission-templates/page.tsx; do
  grep -q '<SettingsWorkspace' "$f" \
    || { echo "ERROR: $f is not rendering the Settings workspace — aborting"; exit 1; }
done
# The chooser must not come back.
grep -q 'grid gap-4 sm:grid-cols-2' app/platform/dashboard/settings/page.tsx \
  && { echo "ERROR: the two Settings feature cards are back — aborting"; exit 1; }
# GATES MOVED, NOT LOST. The config-templates page body now lives in a section
# component so /settings can render the same area; every gate went with it. The
# structural baseline only scans page files, so it reports these as removed —
# they are not, and this is where that is proven on every deploy.
for g in 'requirePlatformViewer' "assertModuleView(viewer, 'sites')" \
         'canManageSiteConfigTemplates(viewer.role)' "permits(viewer.role, 'sites', 'edit')"; do
  grep -qF "$g" components/platform/ConfigTemplatesSection.tsx \
    || { echo "ERROR: ConfigTemplatesSection lost the gate: $g — aborting"; exit 1; }
done
# /settings has ALWAYS turned a non-manager away, unlike /settings/config-templates.
# Rendering the section there must not quietly relax that.
grep -q 'redirect(' app/platform/dashboard/settings/page.tsx \
  || { echo "ERROR: /settings lost its non-manager redirect — aborting"; exit 1; }
grep -q 'redirect(' app/platform/dashboard/settings/permission-templates/page.tsx \
  || { echo "ERROR: permission-templates lost its redirect — aborting"; exit 1; }
# Mobile pass: a header action row held at content width forced every site tab
# 184px wider than a 390px phone.
grep -q 'sm:shrink-0' components/platform/RecordHeader.tsx \
  && grep -q 'sm:shrink-0' components/platform/PageHeader.tsx \
  || { echo "ERROR: header action rows would force horizontal page scroll on phones — aborting"; exit 1; }
echo "      confirmed: one Settings workspace, gates moved intact, redirects kept, headers wrap on phones."

echo "[6/8] Building..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
rm -rf .next
npm run build 2>&1 | tail -5
[ -f .next/BUILD_ID ] || { echo "ERROR: build produced no .next/BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[7/8] Packaging and deploying..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "      waiting for prod BUILD_ID to flip to ${NEW_BUILD}..."
LANDED=""
for i in $(seq 1 40); do
  sleep 15
  CURB=$(kudu_buildid)
  echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  if [ "$CURB" = "$NEW_BUILD" ]; then LANDED=yes; break; fi
done
if [ -z "$LANDED" ]; then
  echo "WARNING: new build id not confirmed on disk. NOT cutting over."
  exit 2
fi

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

echo
echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== UX REFRESH PHASE DEPLOYED ==" || echo "== HEALTH NOT 200 — investigate =="
