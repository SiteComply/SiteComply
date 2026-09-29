#!/usr/bin/env bash
# THE ATTENTION SUMMARY BECOMES COUNTS, AND THE AREA READS AS AN ASSET LIST.
#
# WHAT MUST BE TRUE:
#   THE CLOSED LINE IS COUNTS  one chip per category; no item titles above the fold.
#   DETAIL IS NATIVE           <details>/<summary>, so still no client JavaScript.
#   THE LABEL SAYS IF IT IS LIVE  and nothing repeats it underneath.
#   ONE LIST, NOT THREE CARDS  the Library's bands are headings inside one list.
#
# (Inherited: the phase 2 attention gate.)
#
# A LIGHTWEIGHT ATTENTION SUMMARY ABOVE THE LISTS (Option A, phase 2).
#
# WHAT MUST BE TRUE:
#   NO THIRD OPINION     "reaches nobody" comes from moduleStatus / libraryStatus,
#                        and the item's detail IS their sentence.
#   NO URLS IN THE SERVICE a kind and an id; the component joins the base paths.
#   IT DISAPPEARS QUIET  renders nothing when there is nothing to say.
#   IT IS CAPPED         four items, then a count.
#   MOUNTED ON ALL FOUR  both tiers, modules and library.
#   STILL A SERVER COMPONENT — no state, nothing shipped to the browser.
#
# (Inherited: the modules master-detail gate.)
#
# COMPANY MODULES ARE A LIST, WITH A PAGE PER MODULE (Option A).
#
# WHAT MUST BE TRUE:
#   THE LIST CARRIES NO WORDING   no narration, no heading, in the row shape.
#   ONE INCLUSION RULE            usage counting asks moduleReachesSite, never a copy.
#   A PAGE PER MODULE             modules/[moduleId] in BOTH tiers, one component each.
#   basePath, NOT A CALLBACK      a function prop took the Library index down.
#   THE OLD COMPONENT IS GONE     not left behind to be imported by mistake.
#
# (Inherited: the progress-polling gate.)
#
# THE DEFECT: the poller called router.refresh() every 3s, re-rendering the whole
# page on the server. A render is 123s and ffmpeg runs IN THIS PROCESS on one B1, so
# ~41 heavy renders competed with the encode; the streamed React payload was
# truncated and the client threw "TypeError: Error in input stream" (SC-E-00009).
# Polling was crashing the page it refreshed, and the panels said to reload.
#
# WHAT MUST BE TRUE:
#   A POLL IS CHEAP       no getVideo, no views, no spend, no overrides, no events.
#   REFRESH ON CHANGE     router.refresh() only when the fingerprint moved.
#   IT SEES EVERY STEP    per-scene audio and job rows are in the fingerprint.
#   AUTHORITY UNCHANGED   a poll answers only for a version its viewer may open.
#   THE ENCODE YIELDS     ffmpeg is deprioritised so a page render keeps its slice.
#   NOBODY IS TOLD TO REFRESH.
#
# (Inherited: the company-production visibility gate.)
#
# THE DEFECT: startCompanyVideo refuses a second production while an unpublished one
# exists, and nothing rendered that production - libraryAssetDetail loaded revisions
# only, and the project listings are `where: { jobSiteId }` while a company video has
# none. The single route to one was the redirect fired once when Produce was pressed,
# so navigating away wedged the asset behind an error naming a version with no link to
# it. Production, 2026-09-29: Company Introduction, cleared by hand-written SQL.
#
# WHAT MUST BE TRUE:
#   IT IS LOADED          the detail loader reads productions, not only revisions.
#   IT IS RENDERED        asserted by a REAL RENDER, because the strings were never
#                         the problem - the section did not exist.
#   ONE PREDICATE         the page asks versionMayBeDeleted rather than restating it.
#   THE DISCARD IS SCOPED to the asset, or the Library endpoint deletes any video by id.
#   NO NULL SITE IN A URL neither version page interpolates jobSiteId any more.
#
# (Inherited from the previous gate: the standard modules a catalogue is missing.)
#
# MIGRATION FIRST: ~/library_ia_migrate.sh (two enums, two columns on LibraryAsset,
# one on LibraryAssetRevision). Additive and defaulted, so the live build is
# unaffected by it; step 3 proves it landed rather than trusting this comment.
#
# WHAT MUST BE TRUE:
#   ONE PAGE PER ASSET    both tiers render the SAME component over the SAME loader.
#   ONE STATUS VOCABULARY derived, never stored, shared by index and detail.
#   USAGE IS REAL         counted from scenes and decisions, not hard-coded.
#   CONSEQUENCE FIRST     retire and issue say what will happen before the button.
#   THE RULE IS IN THE    a generated asset's footage cannot be replaced here, and
#   SERVICE               that is enforced where it cannot be bypassed.
#   NO PRISMA IN THE      the client components value-import only client-safe
#   BROWSER               modules - including WRAPPED imports, which tsc cannot see.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/attention_compact_deploy.zip
DRY="${DRY_RUN:-}"

if [ -n "$DRY" ]; then
  fail() { echo "  FAIL $1"; DRY_FAILED=$((${DRY_FAILED:-0}+1)); }
else
  fail() { echo "  FAIL $1"; exit 1; }
fi
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

STATUS=services/inductionVideo/libraryStatus.ts
TAX=services/inductionVideo/libraryTaxonomy.ts
USAGE=services/inductionVideo/libraryUsage.ts
DETAILSVC=services/inductionVideo/libraryDetail.ts
SVC=services/inductionVideo/libraryAssetService.ts
INDEX=components/inductionVideo/LibrarySection.tsx
DETAIL=components/inductionVideo/LibraryAssetDetail.tsx
PP="app/platform/dashboard/induction-videos/library/[assetId]/page.tsx"
AP="app/admin/(dashboard)/induction-videos/library/[assetId]/page.tsx"

if [ -z "$DRY" ]; then
  echo "[1/7] Current prod build id:"
  PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
  [ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"
  echo "[2/7] Asserting a committed tree..."
  git diff --quiet HEAD -- prisma app components services lib scripts \
    || fail "there are uncommitted changes - the zip is the working tree"
  echo "  ok   tree committed"
else
  echo "DRY RUN: asserts only, nothing is built or deployed."
  PREV="(dry run)"
fi

echo "[3/7] Asserting the source, the history and the database..."
for f in "$STATUS" "$TAX" "$USAGE" "$DETAILSVC" "$SVC" "$INDEX" "$DETAIL" "$PP" "$AP"; do
  test -f "$f" || fail "missing: $f"
done

bash scripts/check_migration_drift.sh || fail "the migration history cannot rebuild the schema"

# --- ONE PAGE PER ASSET, SHARED ---
for P in "$PP" "$AP"; do
  grep -q "<LibraryAssetDetail" "$P" || fail "$P does not render the shared asset component"
  grep -q "libraryAssetDetail(" "$P" || fail "$P does not use the shared loader"
  grep -qE "ScriptEditor|<video|useState" "$P" \
    && fail "$P builds its own UI - two copies of this page would drift"
done

# --- ONE STATUS VOCABULARY ---
grep -q "export function libraryStatus" "$STATUS" || fail "the shared status derivation is gone"
grep -qE "status\s+LibraryAssetStatus" prisma/schema.prisma \
  && fail "a status column appeared - a stored status is a second source of truth"
grep -q "LIVE_WITH_DRAFT" "$STATUS" \
  || fail "live-with-a-replacement is not a state again; it needed two blocks to read before"
grep -q "libraryStatus(" services/inductionVideo/libraryRows.ts \
  || fail "the index does not use the shared derivation"
grep -q "libraryStatus(" "$DETAILSVC" || fail "the detail loader does not use the shared derivation"

# --- USAGE IS REAL ---
grep -q "libraryRevisionId" "$USAGE" \
  || fail "usage no longer reads the scenes that actually contain a revision"
grep -q "export async function libraryUsageSummaries" "$USAGE" \
  || fail "the batched index usage is gone - thirty assets would be ninety queries"
grep -q "usageFor(r.id)" "$DETAILSVC" || fail "per-revision usage is not attributed"
# The LOADER composes the sentence and the COMPONENT renders it, so assert both ends
# rather than looking for the function name in the screen.
grep -q "describeRetireConsequence" "$DETAILSVC" \
  || fail "the loader no longer composes the retire consequence"
grep -q "describeIssueConsequence" "$DETAILSVC" \
  || fail "the loader no longer composes the issue consequence"
grep -q "asset.retireConsequence" "$DETAIL" \
  || fail "retiring no longer says what will happen first"
grep -q "asset.issueConsequence" "$DETAIL" \
  || fail "issuing no longer says what will happen first"

# --- THE GENERATED RULE, IN THE SERVICE ---
grep -qF "owning?.asset.provenance === 'GENERATED'" "$SVC" \
  || fail "the service no longer refuses footage on a generated asset - the screen alone is not a guard"
grep -q "contentEditableHere" "$TAX" || fail "the single editability predicate is gone"
grep -q "sourceModuleRevisionId" prisma/schema.prisma \
  || fail "a generated revision no longer records which module revision produced it"

# --- TWO AXES, SEARCH, GROUPING, PLAYER ---
grep -q "LIBRARY_CATEGORIES" "$TAX" || fail "categories are gone"
grep -qF "BANDS.map((band) => {" "$INDEX" || fail "the index no longer groups by where it plays"
grep -qF "shown.filter((a) => a.placement === band.key)" "$INDEX" \
  || fail "the grouping no longer selects by placement"
for SETTER in setQ setCategory setProvenance setStatus setShowRetired; do
  grep -qE "\b${SETTER}\(" "$INDEX" || fail "the index lost its ${SETTER} filter"
done
grep -q "<video" "$DETAIL" || fail "the player is gone - a video library you cannot watch"
grep -qF "mediaSasUrl(path, 30)" "$SVC" \
  || fail "the preview URL is no longer short-lived, or no longer scoped to one blob"
# The creation form is its own component now — LibraryCreatePanel — so these read it
# rather than the index. It had grown to half the index file, and inside the list it
# only rendered after a click, which no static render could reach.
CREATE_SRC=components/inductionVideo/LibraryCreatePanel.tsx
grep -qF "Where will the video come from?" "$CREATE_SRC" \
  || fail "creation no longer asks the question that decides everything else"
# The generated option IS available now. What must hold is that choosing it commits you
# to a source module, because a generated video with no wording cannot be produced.
grep -qF "setProvenanceChoice('GENERATED')" "$CREATE_SRC" \
  || fail "the generated option is not offered as a real choice"
grep -qF "draft.provenance === 'GENERATED' && !draft.moduleId" "$CREATE_SRC" \
  || fail "a generated video can be created with no source module - it could never be produced"

# --- NO PRISMA IN THE BROWSER, WRAPPED IMPORTS INCLUDED ---
python3 - <<'PYCHK' || fail "a Library client component value-imports a service that reaches the database"
import re
CLIENT_SAFE = re.compile(r'libraryLimits|libraryTaxonomy|libraryStatus')
for f in ('components/inductionVideo/LibrarySection.tsx',
          'components/inductionVideo/LibraryAssetDetail.tsx'):
    src = open(f).read()
    # Wrapped imports count: the single-line form was blind to them.
    for m in re.finditer(r"^import\s+(?!type\b)[\s\S]*?from\s+'(@/services/[^']+)';", src, re.M):
        if not CLIENT_SAFE.search(m.group(1)):
            raise SystemExit(1)
raise SystemExit(0)
PYCHK
python3 scripts/check_client_prisma_leak.py \
  || fail "a client component value-imports the Prisma CLIENT"
# NO FUNCTION PROPS ACROSS THE BOUNDARY. This is what took the Library index down in
# production: `detailHref={(id) => ...}` passed from an async Server Component to a
# 'use client' component. Next cannot serialise a function, so it threw before
# rendering anything - on every request, empty library or not. It type-checked, it
# built, and the route smoke test below saw only the 307 at the login redirect.
python3 scripts/check_server_client_props.py \
  || fail "a Server Component passes a function prop to a client component - it will throw at render"
# --- ONE PIPELINE, AND THE WORDING IS NOT REGENERATED ----------------------
CVS=services/inductionVideo/companyVideoService.ts
test -f "$CVS" || fail "the company video service is missing"
grep -q "scope: 'COMPANY'" "$CVS" \
  || fail "a company video is not marked COMPANY - it would look like a site induction"
grep -q "status: InductionVideoStatus.SCRIPT_READY" "$CVS" \
  || fail "a production no longer starts ready to read; there is no script to generate"
grep -q "export function splitModuleNarration" "$CVS" \
  || fail "the mechanical split is gone - wording must not be regenerated"
grep -qE "generateScript|resolveAiProvider" "$CVS" \
  && fail "the company path calls the model: approved company wording must never be re-phrased"
grep -q "moduleRevisionId: revision.id," "$CVS" \
  || fail "scenes no longer record the module revision - a re-issue could change a rendered video"
grep -q "COMPANY MODULES ARE NOT SENT TO THE MODEL AT ALL" services/inductionVideo/scriptService.ts \
  || fail "the rule the company path follows has been removed from scriptService"

# --- PUBLISHING FILES A DRAFT REVISION -------------------------------------
grep -q "normalisedBlobPath: video.videoBlobPath," "$CVS" \
  || fail "the render is not filed as the segment - a transcode would be queued needlessly"
grep -q "if (!video.captionsBlobPath) {" "$CVS" \
  || fail "a production can publish with no captions, which cannot then be issued"
grep -qE "status: LibraryRevisionStatus.ISSUED" "$CVS" \
  && fail "publishing issues to every project directly - that is a separate decision"

# --- NOTHING SITE-SCOPED LEAKS, AND SITE PATHS DO NOT MOVE -----------------
OWN=services/inductionVideo/videoOwner.ts
grep -qF "return v.jobSiteId ?? v.libraryAssetId ?? v.id;" "$OWN" \
  || fail "media no longer partitions by asset for a company video, or site paths have moved"
grep -q "export function mayWorkOn" services/inductionVideo/videoActor.ts \
  || fail "the one authority question is gone"
grep -qF "{ libraryAssetId: current.libraryAssetId }" services/inductionVideo/inductionVideoService.ts \
  || fail "superseding is not scoped to the asset - it would sweep every company video"
grep -qF "if (!job.video.jobSite) {" services/inductionVideo/inductionVideoService.ts \
  || fail "the script drain no longer refuses a company video"
grep -qF "maySite: () => false," services/inductionVideo/videoActor.ts \
  || fail "company authority now implies authority over a project's induction"
# --- THE VISUAL LAYER -------------------------------------------------------
test -f services/inductionVideo/sceneTemplates.ts || fail "the scene template registry is missing"
test -f services/inductionVideo/timeline.ts || fail "the shared running order is missing"
test -f services/inductionVideo/brandMotion.ts || fail "the branded motion registry is missing"
for K in sting closing bumper-emergency bumper-hazard bumper-standards bumper-opening \
         bumper-project bumper-access bumper-welfare bumper-closing; do
  test -f "public/brand-motion/$K.mp4" \
    || fail "public/brand-motion/$K.mp4 is missing - run scripts/build_brand_motion.sh"
done
# Half a set would mean narration timing one running order and the renderer producing
# another, and the symptom is subtitles drifting further out of step as the video goes on.
grep -q "export function brandMotionReady" services/inductionVideo/brandMotion.ts \
  || fail "the all-or-nothing check on the asset set is gone"
grep -q "buildTimeline(" services/inductionVideo/narrationService.ts \
  || fail "captions are no longer timed against the rendered running order"
grep -qF "buildVtt(timedScenes)" services/inductionVideo/narrationService.ts \
  || fail "the VTT is built from the raw scenes again - every subtitle after a bumper would be early"
grep -q "buildTimeline(" services/inductionVideo/ffmpegRenderer.ts \
  || fail "the renderer builds its own running order again"
grep -qF "const accent = accentFilter(visual, width, height);" services/inductionVideo/ffmpegRenderer.ts \
  || fail "scene accents are no longer drawn"
grep -q "fade=t=in:st=0" services/inductionVideo/ffmpegRenderer.ts \
  || fail "parts no longer fade at their edges"
grep -q "xfade" services/inductionVideo/ffmpegRenderer.ts \
  && fail "a cross-fade would re-encode the whole induction instead of stream-copying it"
# --- THE MODULE COMES FIRST, AND UNISSUED ONES ARE VISIBLE ------------------
PANEL=components/inductionVideo/LibraryCreatePanel.tsx
test -f "$PANEL" || fail "the creation panel is missing"
grep -qF "Which company module is this video?" "$PANEL" \
  || fail "the generated branch no longer asks which module the video is"
grep -q "not issued yet" "$PANEL" \
  || fail "unissued modules are no longer marked - an absence reads as 'that topic does not exist'"
grep -q "There are no company modules yet" "$PANEL" \
  || fail "an empty picker gives no way out again"
grep -q "export function applyModuleToDraft" "$PANEL" \
  || fail "choosing a module no longer fills in what it implies"
grep -qF "modules.filter((m) => m.issued)" services/inductionVideo/libraryRows.ts \
  && fail "the picker filters unissued modules out again - that is what hid the wanted one"
grep -qF "hasIssued: Boolean(m.issued)" services/inductionVideo/libraryRows.ts \
  || fail "modules no longer carry their readiness"
grep -q "COMPANY_INTRODUCTION" services/inductionModules/moduleCatalogue.ts \
  || fail "Company introduction is not in the starter set"
grep -q "REPLACE THIS TEXT BEFORE ISSUING" services/inductionModules/moduleCatalogue.ts \
  || fail "the company introduction ships as usable-looking wording - it could be issued unread"
# --- THE COMPANY RULE IS ON, AND ROUTES TO THE FIX --------------------------
AR=services/workerAccess/accessRequirements.ts
grep -qF "export const REQUIRED_BY_DEFAULT: AccessRequirement[] = ['CSCS_VERIFIED'];" "$AR" \
  || fail "a verified card is no longer required by default - a new project would enforce nothing"
grep -qF "if (explicit.get(r) ?? true) on.add(r);" "$AR" \
  || fail "an explicit per-site OFF no longer wins, or the default is gone"
grep -qF "fixHref: CARD_FIX_HREF," "$AR" \
  || fail "a card refusal no longer carries the remediation journey"
grep -qF "requirement === 'CSCS_VERIFIED' || requirement === 'CSCS_IN_DATE'" "$AR" \
  || fail "the test-account exemption has widened beyond the CSCS requirements"
grep -qF "isCscsExemptMobile(worker.mobile)" "$AR" \
  || fail "the designated test-account exemption is gone"
grep -qE "REQUIRED_BY_DEFAULT[^=]*=[^]]*INDUCTION_VALID" "$AR" \
  && fail "INDUCTION_VALID defaulted on - it would refuse the re-induction that fixes it"
grep -qE "REQUIRED_BY_DEFAULT[^=]*=[^]]*SIGNATURE_ON_FILE" "$AR" \
  && fail "SIGNATURE_ON_FILE defaulted on - the signature is captured during the induction it blocks"
# Both doors, and both screens.
grep -qF "canWorkerCheckIn(input.workerId" services/submissions/submissionService.ts \
  || fail "the full check-in no longer asks before writing"
grep -qF "canWorkerCheckIn(workerId, siteId)" services/induction/inductionValidityService.ts \
  || fail "express check-in no longer asks - that is the second door"
for F in components/checkin/InductionWizard.tsx components/checkin/ExpressCheckInButton.tsx; do
  grep -qF "data.fix?.href" "$F" || fail "$F no longer sends a refused worker to the fix"
done
grep -qF "access.fix && (" "app/check-in/site/[siteId]/page.tsx" \
  || fail "the site page no longer offers the remediation button"
# --- A CATALOGUE THAT GREW AFTER YOU SEEDED IT ------------------------------
MODS=components/inductionModules/ModulesIndex.tsx
grep -qF "const missing = MODULE_CATALOGUE.filter(" "$MODS" \
  || fail "the missing-module prompt is gone - a catalogue seeded earlier can never receive a new standard module"
grep -qF "{missing.length > 0 && canIssue && (" "$MODS" \
  || fail "the prompt is gated on an EMPTY catalogue again, or shows for a complete one"
grep -qF "'Create the six standard modules'" "$MODS" \
  && fail "the seed label hard-codes a number again - it was already wrong"
grep -q "COMPANY_INTRODUCTION" services/inductionModules/moduleCatalogue.ts \
  || fail "Company introduction is no longer in the starter set"
grep -qE "^import type \{ InductionModuleCategory \}" services/inductionModules/moduleCatalogue.ts \
  || fail "moduleCatalogue imports Prisma as a VALUE - a client component reads this table"
# --- A PRODUCTION UNDER WAY IS LOADED, RENDERED AND DISCARDABLE -------------
VIS_SUITE=scripts/library_production_visibility_verify.ts
test -f "$VIS_SUITE" || fail "the production-visibility suite is missing"
grep -qF "productions: DetailProduction[]" "$DETAILSVC" \
  || fail "the detail loader no longer exposes productions - the asset looks idle while wedged"
grep -qF 'where: { libraryAssetId: assetId, status: { not: '"'"'PUBLISHED'"'"' } }' "$DETAILSVC" \
  || fail "in-flight is no longer 'not published' - the page would show a narrower set than the refusal counts"
grep -qF "versionMayBeDeleted({" "$DETAILSVC" \
  || fail "the page restates 'may this be deleted' instead of asking the service's predicate"
grep -qF "asset.productions" "$DETAIL" \
  || fail "the asset page does not render the productions it is given - that IS the defect"
grep -qE '\{underWay\.length > 0 && \(' "$DETAIL" \
  || fail "the Under way section is not mounted"
# MULTILINE, so not grep: the disabled expression is wrapped across three lines and a
# line-based match can never see it. The first version of this assert failed in the dry
# run for exactly that reason. Scoped to the `disabled` prop, because a bare match on
# `underWay.length > 0` finds the warning paragraph above the button and SURVIVED the
# mutation that deleted the guard.
python3 - "$DETAIL" <<'PYGUARD' || fail "Produce is not blocked while one is under way - it walks into a refusal the panel explains"
import re, sys
src = open(sys.argv[1]).read()
sys.exit(0 if re.search(r'disabled=\{[^}]*underWay\.length > 0', src) else 1)
PYGUARD
grep -qF "action: 'discardProduction'" "$DETAIL" \
  || fail "there is no way to discard a production from the asset page"
grep -qF 'video.libraryAssetId !== assetId' services/inductionVideo/libraryActions.ts \
  || fail "discardProduction does not check the video belongs to THIS asset - it would delete any video by id"
grep -qF 'Under way' "$CVS" \
  || fail "the refusal no longer says where the blocking production is"
# --- NO SCREEN BUILDS A URL OUT OF A NULL SITE ------------------------------
for P in "app/platform/dashboard/induction-videos/[videoId]/page.tsx" \
         "app/admin/(dashboard)/induction-videos/[videoId]/page.tsx"; do
  test -f "$P" || fail "missing: $P"
  grep -qF '${video.jobSiteId}' "$P" \
    && fail "$P interpolates jobSiteId into a URL - a company video has none, so this builds /null/"
  grep -qF "videoOwnerHref(" "$P" || fail "$P does not ask videoOwnerHref where the version belongs"
done
grep -q "export function videoOwnerHref" "$OWN" \
  || fail "the shared owner-href helper is gone - both tiers would interpolate a null again"
grep -qF "libraryAsset: { select: { id: true, title: true } }" services/inductionVideo/inductionVideoService.ts \
  || fail "getVideo no longer loads the library asset - a company version cannot be named"
grep -qF "'Only a Director or Site Manager may delete an induction script version.'" services/inductionVideo/inductionVideoService.ts \
  || fail "the site-induction delete message changed - check the company one too"
grep -qF "may discard a company video production." services/inductionVideo/inductionVideoService.ts \
  || fail "a Site Manager is told Site Managers may discard a company production, while being refused"
# --- THE PAGE UPDATES ITSELF, AND THE POLL IS CHEAP ------------------------
PROG=services/inductionVideo/progressService.ts
POLLER=components/inductionVideo/RefreshWhileWorking.tsx
PRIO=services/inductionVideo/childPriority.ts
for f in "$PROG" "$POLLER" "$PRIO" scripts/video_progress_verify.ts; do
  test -f "$f" || fail "missing: $f"
done
for R in "app/api/platform/induction-video/[videoId]/status/route.ts" \
         "app/api/admin/induction-video/[videoId]/status/route.ts" \
         "app/api/platform/sites/[id]/induction-video/status/route.ts" \
         "app/api/admin/sites/[id]/induction-video/status/route.ts"; do
  test -f "$R" || fail "missing status route: $R"
  grep -q "export async function GET" "$R" || fail "$R is not a GET"
  grep -qE "videoProgress\(|siteProgress\(" "$R" \
    || fail "$R computes its own answer instead of asking the shared service"
done
# A POLL MUST NOT GROW INTO A PAGE RENDER. This is the whole fix; anything on this
# list appearing here puts the load back.
for HEAVY in "getVideo(" viewsForVideo spendForVideo overriddenRevisionIds \
             estimateNarration manifestForSite; do
  grep -qF "$HEAVY" "$PROG" && fail "the status poll calls $HEAVY - that is the load that crashed it"
done
grep -qE "^\s*events:" "$PROG" && fail "the status poll selects audit events"
grep -qF "video.scenes.map((s) => \`\${s.id}:\${s.audioDurationMs ?? ''}\`)" "$PROG" \
  || fail "the fingerprint no longer covers per-scene narration - a scene landing would be invisible"
grep -qF "video.jobs.map((j)" "$PROG" \
  || fail "the fingerprint no longer covers job rows - a failure would wait for a status nobody writes"
grep -qF "video.jobSiteId === null ? actor.canManage : actor.maySite(video.jobSiteId)" "$PROG" \
  || fail "the poll no longer asks the same authority question the page asked"
# REFRESH ONLY ON CHANGE, scoped to the guard: a bare grep for the comparison would
# pass with the guard deleted.
grep -qF "if (changed && !refreshing.current) {" "$POLLER" \
  || fail "the poller refreshes without checking whether anything changed"
grep -qF "fetch(statusHref" "$POLLER" || fail "the poller no longer asks the cheap endpoint"
grep -qF "statusHref: string;" "$POLLER" \
  || fail "statusHref became optional - a caller could silently keep whole-page polling"
python3 - "$POLLER" <<'PYPOLL' || fail "a successful poll with nothing changed still re-renders the page"
import sys
src = open(sys.argv[1]).read()
start = src.index("failures.current = 0;")
end = src.index("} catch {")
body = src[start:end]
ok = ("if (changed" in body
      and body.index("if (changed") < body.index("router.refresh()")
      and body.count("router.refresh()") == 1)
sys.exit(0 if ok else 1)
PYPOLL
grep -qE "setInterval\(" "$POLLER" \
  && fail "the fixed-interval timer is back - its body was a whole-page render"
grep -q "export function workPollDelayMs" services/inductionVideo/videoProgress.ts \
  || fail "the poll back-off is gone"
# EVERY SCREEN THAT POLLS PASSES AN ENDPOINT.
for M in components/inductionVideo/VideoVersionSurface.tsx \
         "app/platform/dashboard/sites/[id]/induction-video/page.tsx" \
         "app/admin/(dashboard)/induction-videos/projects/[id]/page.tsx"; do
  python3 - "$M" <<'PYMOUNT' || fail "$M mounts RefreshWhileWorking without a statusHref"
import re, sys
src = open(sys.argv[1]).read()
sys.exit(0 if re.search(r'<RefreshWhileWorking[\s\S]{0,300}?statusHref=', src) else 1)
PYMOUNT
done
# THE ENCODE YIELDS.
grep -qF "deprioritiseEncode(child.pid)" services/inductionVideo/ffmpegRenderer.ts \
  || fail "the renderer no longer yields CPU to the page"
grep -qF "deprioritiseEncode(child.pid)" services/inductionVideo/libraryNormaliser.ts \
  || fail "the normaliser no longer yields CPU to the page"
grep -q "PRIORITY_LOW" "$PRIO" || fail "the encode priority is no longer the lowest"
# NOBODY IS TOLD TO REFRESH.
for F in components/platform/RenderPanel.tsx components/platform/NarrationPanel.tsx; do
  grep -qi "refresh to see" "$F" \
    && fail "$F still tells the user to refresh - that instruction led to a reload mid-render"
done
# --- MODULES: A LIST, AND A PAGE PER MODULE -------------------------------
IDX=components/inductionModules/ModulesIndex.tsx
MDET=components/inductionModules/ModuleDetail.tsx
MROWS=services/inductionModules/moduleRows.ts
MDETSVC=services/inductionModules/moduleDetail.ts
MUSE=services/inductionModules/moduleUsage.ts
MSTAT=services/inductionModules/moduleStatus.ts
for f in "$IDX" "$MDET" "$MROWS" "$MDETSVC" "$MUSE" "$MSTAT" \
         scripts/module_master_detail_verify.ts; do
  test -f "$f" || fail "missing: $f"
done
test -f components/platform/InductionModulesSection.tsx \
  && fail "the old inline-everything component is back - it is what printed 2,400 words on the landing page"
# THE LIST CARRIES NO WORDING. This is the whole change; a row shape that grows a
# narration field puts the clutter straight back.
grep -qE "^\s*narration[?]?:" "$MROWS" \
  && fail "the module row shape carries narration again"
grep -qE "^\s*heading[?]?:" "$MROWS" \
  && fail "the module row shape carries a heading again"
grep -q "export async function moduleRowsForIndex" "$MROWS" \
  || fail "the list loader is gone or renamed"
grep -q "getModule(" "$MROWS" \
  && fail "the list loader calls getModule again - that was one query PER module, for text it does not show"
# ONE INCLUSION RULE.
grep -q "export function moduleReachesSite" services/inductionModules/inductionModuleService.ts \
  || fail "the shared inclusion predicate is gone"
grep -qF "moduleReachesSite(m, decision ?? null)" services/inductionModules/inductionModuleService.ts \
  || fail "resolveModulesForSite no longer asks the shared predicate"
grep -qF "moduleReachesSite(m, decision)" "$MUSE" \
  || fail "the usage counter restates the inclusion rule instead of asking it"
grep -qF "status: 'ACTIVE'" "$MUSE" \
  || fail "usage counts closed or archived projects"
# DERIVED STATUS, RETIRED FIRST.
grep -q "export function moduleStatus" "$MSTAT" || fail "the derived module status is gone"
grep -q "LIVE_WITH_DRAFT" "$MSTAT" \
  || fail "live-with-a-draft is not a state again; it needed two places on the page to read"
python3 - "$MSTAT" <<'PYSTAT' || fail "moduleStatus checks revisions before activity - a retired module would read as live"
import sys
src = open(sys.argv[1]).read()
sys.exit(0 if src.index('!input.active') < src.index('input.issued && input.draft') else 1)
PYSTAT
grep -qE "status\s+ModuleStatus" prisma/schema.prisma \
  && fail "a status column appeared - a stored status is a second source of truth"
# A PAGE PER MODULE, IN BOTH TIERS.
for P in "app/platform/dashboard/induction-videos/modules/[moduleId]/page.tsx" \
         "app/admin/(dashboard)/induction-videos/modules/[moduleId]/page.tsx"; do
  test -f "$P" || fail "missing module detail route: $P"
  grep -q "<ModuleDetail" "$P" || fail "$P does not render the shared detail component"
  grep -qF "moduleDetail(params.moduleId)" "$P" || fail "$P does not use the shared loader"
  grep -qE "useState|<textarea" "$P" \
    && fail "$P builds its own editor - two copies of this page would drift"
done
for P in "app/platform/dashboard/induction-videos/modules/page.tsx" \
         "app/admin/(dashboard)/induction-videos/modules/page.tsx"; do
  grep -q "<ModulesIndex" "$P" || fail "$P does not render the shared list"
  grep -qF "moduleRowsForIndex()" "$P" || fail "$P does not use the shared row builder"
  grep -q "basePath=" "$P" || fail "$P does not tell the list where module pages live"
  grep -qF 'basePath={(' "$P" \
    && fail "$P passes basePath as a callback - a function prop cannot cross the boundary"
done
# THE EDITOR AND THE LIST BOTH TAKE THEIR ENDPOINT.
for F in "$IDX" "$MDET"; do
  grep -qF "endpoint: string;" "$F" || fail "$F hard-codes its tier instead of taking an endpoint"
  grep -qE "fetch\('/api/" "$F" && fail "$F hard-codes an API path"
done
grep -qF "const missing = MODULE_CATALOGUE.filter(" "$IDX" \
  || fail "the missing-module prompt is gone - a catalogue seeded earlier could never gain a new standard module"
grep -qF "issueConsequence" "$MDET" \
  || fail "issuing no longer says what it will do before the button"
grep -qF "retireConsequence" "$MDET" \
  || fail "retiring no longer says what it will do first"
# --- THE ATTENTION SUMMARY ------------------------------------------------
ATTSVC=services/inductionVideo/attentionService.ts
ATTUI=components/inductionVideo/AttentionSummary.tsx
for f in "$ATTSVC" "$ATTUI" scripts/attention_summary_verify.ts; do
  test -f "$f" || fail "missing: $f"
done
# NO THIRD OPINION. The strip must not decide for itself what reaches anybody.
grep -qF "moduleStatus({" "$ATTSVC" \
  || fail "the summary no longer asks moduleStatus whether a module reaches anybody"
grep -qF "libraryStatus({" "$ATTSVC" \
  || fail "the summary no longer asks libraryStatus whether a video reaches anybody"
# PER BRANCH, not "somewhere in the file". A bare grep for `detail: status.detail,`
# SURVIVED mutating the module branch, because the two asset branches still matched.
python3 - "$ATTSVC" <<'PYDETAIL' || fail "a branch of the summary writes its own wording instead of the status derivation's - it would contradict the row beneath it"
import re, sys
src = open(sys.argv[1]).read()
# Every items.push whose severity comes from a status must take that status's sentence.
blocks = re.findall(r'items\.push\(\{[\s\S]*?\}\);', src)
using_status = [b for b in blocks if 'status.detail' in b or 'status.key' in b]
if len(using_status) < 3:
    sys.exit(1)
# and no status-derived block may hand-write a detail string
for b in blocks:
    if ('reaches nobody' in b or 'not in any induction' in b) and 'detail: status.detail' not in b:
        sys.exit(1)
sys.exit(0)
PYDETAIL
# NO URLS IN THE SERVICE: tier-agnostic, and no function prop to make it so.
grep -qE "'/(platform|admin)" "$ATTSVC" \
  && fail "the attention service builds tier-specific URLs - that is the component's job"
grep -qF "modulesBasePath: string;" "$ATTUI" \
  || fail "the summary no longer takes base paths - a link builder would be a function prop"
# ONE PRODUCTION, ONE ITEM.
python3 - "$ATTSVC" <<'PYONE' || fail "a mismatched production also gets the generic unfinished item - two rows about one thing"
import sys
src = open(sys.argv[1]).read()
i = src.find("video:${p.id}:mismatched")
j = src.find("video:${p.id}:unfinished")
sys.exit(0 if i != -1 and j != -1 and "continue;" in src[i:j] else 1)
PYONE
# IT DISAPPEARS WHEN QUIET, AND IS CAPPED.
grep -qF "if (attention.items.length === 0) return null;" "$ATTUI" \
  || fail "the summary renders an all-clear panel - a strip that is always there stops being read"
# THE CLOSED LINE IS COUNTS. The cap is deliberately gone: behind a disclosure the
# items cost nothing until asked for, so what has to stay small is the SUMMARY line.
grep -q "attention.counts.map" "$ATTUI" \
  || fail "the summary line no longer shows counts - it is back to a row per item"
python3 - "$ATTUI" <<'PYSUMMARY' || fail "an item title is rendered on the closed summary line - that is the height the page costs when nothing is wrong"
import sys
src = open(sys.argv[1]).read()
i, j = src.index('<summary'), src.index('</summary>')
line = src[i:j]
# The closed line may show counts and the headline; never an item's own fields.
bad = [t for t in ('item.title', 'item.detail', 'item.action', 'attention.items.map') if t in line]
sys.exit(1 if bad else 0)
PYSUMMARY
grep -qF "<details" "$ATTUI" \
  || fail "the expansion is no longer a native disclosure - a useState toggle makes this a client bundle"
grep -q "export type AttentionCategory" "$ATTSVC" \
  || fail "items are no longer categorised, so nothing can be counted"
grep -q "counts: AttentionCount\[\]" "$ATTSVC" \
  || fail "the service no longer returns counts"
# THE LABEL CARRIES LIVE/NOT-LIVE, AND NOTHING REPEATS IT.
grep -qF "not live" services/inductionModules/moduleStatus.ts \
  || fail "the module label no longer says whether anybody hears it"
grep -qF "'Not started'" services/inductionModules/moduleStatus.ts \
  || fail "the 'Nothing written' wording is back - it was not the Library's word for the same state"
# COMMENTS ARE PROSE. A bare grep for "reaches nobody" matched the comments
# EXPLAINING its removal, so the gate failed on correct code - the same trap that has
# bitten a bare /role/, a "Videos" in a sentence and an `adminReadOnly` in a comment.
# Strip comments, then look at what is actually rendered.
python3 - <<'PYCOPY' || fail "a screen repeats 'reaches nobody' in rendered copy - the status label already says it"
import re, sys
files = ['components/inductionModules/ModulesIndex.tsx',
         'components/inductionVideo/LibrarySection.tsx',
         'components/inductionModules/ModuleDetail.tsx']
for f in files:
    src = open(f).read()
    src = re.sub(r'/\*[\s\S]*?\*/', '', src)            # block comments
    src = re.sub(r'\{/\*[\s\S]*?\*/\}', '', src)       # JSX comments
    src = re.sub(r'^\s*//.*$', '', src, flags=re.M)      # line comments
    if re.search(r'reaches nobody', src, re.I):
        sys.exit(1)
sys.exit(0)
PYCOPY
# THE LIBRARY IS ONE LIST, NOT THREE CARDS.
grep -qF 'className="overflow-hidden rounded-xl border border-line bg-surface shadow-card"' \
  components/inductionVideo/LibrarySection.tsx \
  || fail "the Library's bands are separate cards again - three bordered cards read as three documents"
python3 - components/inductionVideo/LibrarySection.tsx <<'PYBANDS' || fail "a band renders its own card again"
import sys
src = open(sys.argv[1]).read()
i = src.index('{BANDS.map(')
sys.exit(0 if '<section key={band.key}' not in src[i:] else 1)
PYBANDS
grep -qF "'use client'" "$ATTUI" \
  && fail "the summary became a client component - it has no state and nothing to ship"
# MOUNTED ON ALL FOUR LIST PAGES, LOADED IN PARALLEL.
for P in "app/platform/dashboard/induction-videos/modules/page.tsx" \
         "app/admin/(dashboard)/induction-videos/modules/page.tsx" \
         "app/platform/dashboard/induction-videos/library/page.tsx" \
         "app/admin/(dashboard)/induction-videos/library/page.tsx"; do
  grep -q "<AttentionSummary" "$P" || fail "$P does not show the attention summary"
  grep -qF "attentionItems()" "$P" || fail "$P does not load the attention items"
  grep -qF "Promise.all([" "$P" \
    || fail "$P awaits the summary in series with its rows - an extra round trip on every load"
done
echo "  ok   source asserts pass (193)"

if [ -z "$DRY" ]; then
  DB="$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='DATABASE_URL'].value" 2>/dev/null)"
  [ -n "$DB" ] || fail "could not read DATABASE_URL"
  export PGCONNECT_TIMEOUT=10
  FW_RULE=devvm-compactdeploy; FW_IP=144.6.132.237; FW_OPENED=""
  cleanup_fw() {
    if [ -n "$FW_OPENED" ]; then
      az postgres flexible-server firewall-rule delete -g "$RG" -s sitecomply-pg \
        -n "$FW_RULE" --yes -o none 2>/dev/null && echo "      firewall rule removed." \
        || echo "      WARNING: remove ${FW_RULE} by hand"
    fi
  }
  trap cleanup_fw EXIT
  if ! psql "$DB" -q -c 'SELECT 1' >/dev/null 2>&1; then
    az postgres flexible-server firewall-rule create -g "$RG" -s sitecomply-pg \
      -n "$FW_RULE" --start-ip-address "$FW_IP" --end-ip-address "$FW_IP" -o none \
      || fail "could not open the firewall rule"
    FW_OPENED=yes
    for _ in $(seq 1 12); do psql "$DB" -q -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 5; done
  fi
  COLS=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name='InductionVideo' AND column_name IN ('scope','libraryAssetId','sourceModuleRevisionId')" 2>/dev/null)
  [ "$COLS" = "3" ] || fail "production has $COLS of the 3 company-video columns - run ~/company_video_migrate.sh first"
  NULLABLE=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT is_nullable FROM information_schema.columns WHERE table_name='InductionVideo' AND column_name='jobSiteId'" 2>/dev/null)
  [ "$NULLABLE" = "YES" ] || fail "jobSiteId is still NOT NULL in production - a company video cannot be created"
  ORPHANS=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT count(*) FROM \"InductionVideo\" WHERE scope='SITE' AND \"jobSiteId\" IS NULL" 2>/dev/null)
  [ "$ORPHANS" = "0" ] || fail "$ORPHANS site inductions lost their project - stop and investigate"
  # And RECORDED, not just applied: that distinction is what docs/MIGRATIONS.md exists for.
  UNREC=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT $(ls -1 prisma/migrations | grep -vc migration_lock) - count(*) FROM _prisma_migrations" 2>/dev/null)
  [ "$UNREC" = "0" ] || fail "$UNREC migration(s) are applied but unrecorded in production - see docs/MIGRATIONS.md"
  echo "  ok   production has the columns, and every migration is recorded"
  cleanup_fw; FW_OPENED=""
fi

if [ -n "$DRY" ]; then
  echo; echo "DRY RUN COMPLETE: ${DRY_FAILED:-0} assert(s) failed."
  exit $([ "${DRY_FAILED:-0}" = "0" ] && echo 0 || echo 1)
fi

echo "[4/7] Running the verification suites..."
export FFMPEG_PATH="$PWD/vendor/ffmpeg/ffmpeg"
# library_render_verify ACTUALLY RENDERS the index to HTML. Every other suite reads
# source or calls a service, and that gap cost twice in one day: a function prop that
# threw before rendering, and a page whose whole new structure was gated on having
# assets so an empty library looked untouched. Both passed every string assertion.
for S in attention_summary_verify module_master_detail_verify video_progress_verify library_production_visibility_verify cscs_enforcement_verify cscs_access_gate_verify cscs_exempt_verify brand_motion_verify company_video_verify library_render_verify library_ia_verify library_pipeline_verify library_audiospec_verify \
         inductionvideo_library_verify inductionvideo_verify inductionvideo_e2e_verify \
         setup_video_readiness_verify cpp_completion_verify site_rules_verify; do
  SRC="scripts/$S.ts"; [ -f "$SRC" ] || SRC="scripts/$S.tsx"
  OUT=$(npx tsx "$SRC" 2>&1) || { echo "$OUT" | tail -20; fail "$S failed"; }
  echo "$OUT" | grep -qE "(^| )0 failed" || { echo "$OUT" | tail -20; fail "$S did not report 0 failed"; }
  echo "  ok   $S"
done
echo "  ok   suites green"

echo "[5/7] Type-checking and building..."
npx tsc --noEmit || fail "tsc failed"
rm -rf .next
npx next build >/tmp/compact_build.log 2>&1 || { tail -30 /tmp/compact_build.log; fail "next build failed"; }
NEW=$(cat .next/BUILD_ID); echo "      new build id: $NEW"

echo "[6/7] Confirming the BUILD, not just the source..."
for S in "Where will the video come from?" \
         "Where this video is used" "Company standards" "SiteComply produces it" \
         "Produce the video from this module" "standard module is missing" \
         "Under way" "Discard it" "produced from the wrong module" \
         "is already being produced" "updates on its own as each step finishes" \
         "appears here as it is recorded" "Where this module is used" \
         "Reaches nobody" "Reusable company footage every project" \
         "Worth knowing" "Show detail" "not live" "Not started"; do
  grep -rqF "$S" .next/server 2>/dev/null || fail "\"$S\" is not in the build"
done
echo "  ok   the new Library screens are in the build"

echo "[7/7] Packaging, deploying, cutting over..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*' 2>/dev/null || true
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
# A non-zero exit is a signal to LOOK: az has returned 504 while Kudu carried on.
if ! az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --async false; then
  echo "      the CLI returned non-zero - waiting up to 10 minutes for the cutover"
  CUT=""
  for _ in $(seq 1 20); do
    [ "$(served_buildid)" = "$NEW" ] && { CUT=yes; break; }
    sleep 30
  done
  [ -n "$CUT" ] || fail "production never cut over to $NEW - check the deployments endpoint"
  echo "      it cut over on its own - the 504 was the CLI, not the deployment"
fi
for i in $(seq 1 10); do
  H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$HEALTH" 2>/dev/null)
  echo "      [$i] health: HTTP $H"; [ "$H" = "200" ] && break; sleep 20
done
SERVED=$(served_buildid); echo "      served build id: $SERVED"
[ "$SERVED" = "$NEW" ] || fail "prod is serving $SERVED, not $NEW"
echo "      route smoke test:"
for R in / /check-in; do
  H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "${BASE}${R}")
  echo "        $R -> HTTP $H"
  [ "$H" = "200" ] || fail "$R returned HTTP $H"
done
# A 307 here is the login redirect and proves NOTHING about whether the page renders.
# Say so rather than printing it as though it were a pass.
for R in /platform/dashboard/induction-videos/library /admin/induction-videos/library; do
  H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "${BASE}${R}")
  echo "        $R -> HTTP $H (auth redirect expected; NOT a render check)"
  case "$H" in
    307|302) ;;
    500|502|503) fail "$R returned HTTP $H before any redirect - it is failing outright" ;;
    *) echo "        note: expected a redirect, got $H" ;;
  esac
done
echo
echo "      UNVERIFIED BY THIS GATE: whether these pages RENDER for a signed-in user."
echo "      Nothing here can log in, so a render-time failure - a function prop across"
echo "      the server/client boundary, a null a component does not expect - reaches"
echo "      production looking exactly like a pass. Open the Library and look."
echo
echo "DEPLOYED: $PREV -> $NEW"
