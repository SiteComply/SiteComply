#!/usr/bin/env bash
# THE MODULE PAGE LEADS WITH THE WORKFLOW (owner's layout redesign, 2026-09-30).
#
# The stepper shipped FIFTH on the page: below the header, the usage figures and a
# 200-line wording panel, with all nine sections wearing identical card chrome. The one
# question a user lands with - what stage am I at, what do I press - was answered below
# the fold.
#
# WHAT MUST BE TRUE:
#   THE WORKFLOW IS FIRST     identity, stage and next action are ONE card, before the
#                             wording, the history and the usage figures.
#   ONE PRIMARY WEIGHT        exactly one card carries border-2. Nine equal cards is
#                             the same as no hierarchy.
#   PROGRESSIVE DISCLOSURE    wording open at steps 1-2 (it is the job), folded from 3;
#                             usage, revisions and settings folded always. Native
#                             <details>, so it costs no JavaScript.
#   NOTHING LOST TO TIDINESS  the module's own state is still a sentence, not just a chip.
#   READABLE ON A PHONE       eight labels become a bar under sm; the action stays above
#                             the fold.
#
# (Inherited: the module-anchored workflow gate.)
#
# A COMPANY MODULE VIDEO IS MADE FROM THE MODULE PAGE (owner's redesign, 2026-09-30).
#
# BEFORE: five pages, three objects the user had no reason to know about, and a flow
# that COULD NOT BE FINISHED - revisionReadiness asked for an uploaded file a generated
# video never has, so the last step refused with "This revision still needs a video
# file". Proven by running the real services end to end.
#
# WHAT MUST BE TRUE:
#   THE BLOCKER STAYS FIXED  a generated revision's render counts as its footage, and
#                            company_video_verify completes produce -> publish -> ISSUE.
#   ONE DERIVED STAGE        moduleVideoStage maps four status vocabularies onto eight
#                            steps with ONE next action. Derived, never stored.
#   THE EIGHT ARE THE OWNER'S write / issue / narrate / review / video / preview /
#                            publish & issue / live.
#   NO DEAD END              every stage but LIVE offers a next action.
#   THE ASSET IS INVISIBLE   provisioned in the background, in the COMPANY_BAND at the
#                            module's own order, and the panel never names assets,
#                            productions or revisions to the user.
#   BOTH TIERS CAN WATCH     the shared panels follow apiBase, and the admin tier has
#                            the four media routes it was missing.
#   SCOPE-AWARE WORDING      a company video is not "published to operatives".
#
# (Inherited: the per-draft discard gate.)
#
# A BAD DRAFT IS UNDONE WITHOUT RESETTING ANYTHING (owner's follow-up, 2026-09-30).
#
# The Library could discard a single revision; a module could not discard a single
# draft, so the only way to undo an editing mistake was Start again - which clears
# every revision and everything generated from them.
#
# WHAT MUST BE TRUE:
#   DRAFT ONLY          discardModuleDraft refuses anything not DRAFT, so an issued
#                       revision can never be removed by this path.
#   NOTHING ELSE MOVES  it deletes ONE revision row: no module column, no per-site
#                       decision, no video, no scene, no library asset.
#   NO FLAG NEEDED      a draft is unreachable (resolveModulesForSite and
#                       startCompanyVideo both require ISSUED), so this is not
#                       gated on the build phase - it is ordinary editing.
#   THE DRAFTER'S       canDraft, not canIssue: saveDraft has no author check, so a
#                       Site Manager can already overwrite every word of it.
#   DEFENSIVE, NOT BLIND if a draft ever IS carried by a video, it REFUSES rather
#                       than deleting what proves the bug.
#
# (Inherited: the Library parity gate.)
#
# THE SAME START-AGAIN MODEL ON BOTH SIDES (owner's follow-up, 2026-09-30).
#
# The module page was fixed first, leaving the Library page still offering Delete as
# a peer button beside Start again - the framing the owner objected to.
#
# WHAT MUST BE TRUE:
#   RESET KEEPS THE WIRING   resetLibraryAsset writes no LibraryAsset column and no
#                            SiteLibraryAsset row, so slug, category, placement,
#                            running order, inclusion rules, the module linkage and
#                            every project decision survive by construction.
#   TWO PREDICATES, ONE LINE assetReset and assetDeletion share ONE evidence
#                            refusal, but only the delete carries the mandatory rule.
#                            They were one function, and the mandatory refusal then
#                            blocked the Start again it recommends.
#   MANDATORY IS PROTECTED   an ACTIVE mandatory video cannot be deleted; making it
#                            optional is the escape hatch, as it is for retiring.
#   BOTH PAGES READ ALIKE    reset panel first, delete inside a <details>.
#
# (Inherited: the module reset gate.)
#
# RESETTING A MODULE IS NOT DELETING IT (owner's correction, 2026-09-30).
#
# The first cut gave a module page only "Delete permanently", so the only way to
# reach a clean state was to destroy a permanent company subject. Wrong verb for the
# intent, and irreversible.
#
# FOUR ACTIONS, ONE VIEW:
#   START AGAIN  clears revisions + productions generated from them. KEEPS the
#                module, its subject, category, running order, inclusion rules and
#                EVERY project's decision about it. The primary restart.
#   RETIRE       the company has stopped briefing on this subject; all history kept.
#   ARCHIVE      not an action - it is where retired modules are listed.
#   DELETE       only when the SUBJECT itself is unwanted. Refused outright on an
#                ACTIVE standard subject; retiring first is the escape hatch.
#
# WHAT MUST BE TRUE:
#   RESET KEEPS THE ROW      resetModule touches no InductionModule column and no
#                            SiteInductionModule row.
#   RESET IS NOT A BYPASS    it asks moduleConsumption before anything, so it cannot
#                            clear content an operative has seen.
#   A JOB IN FLIGHT BLOCKS   no flag relaxes it; the production row is the job's lock.
#   STANDARD SUBJECTS STAY   MODULE_CATALOGUE slugs cannot be deleted while active.
#   DELETE IS SECONDARY      behind a <details>, labelled by meaning, pointing back
#                            at Start again.
#   THE SILENT DROP IS SAID  a module with no issued revision reaches nobody
#                            (resolveModulesForSite: `if (!issued) continue`), so
#                            the page warns before the press.
#
# (Inherited: the build-phase reset gate.)
#
# CONTENT CAN BE RESET, DELETED AND STARTED AGAIN DURING THE BUILD PHASE.
#
# THE ONE IDEA: there are two reasons the lifecycle refuses a delete, and only one of
# them is about the record.
#
#   EVIDENCE      published to operatives, or watched by one. Never deletable, in
#                 either mode, by anybody. `consumption.ts` is the only definition.
#   HOUSEKEEPING  superseded, approved-but-unpublished, issued-but-never-carried.
#                 Version discipline, not evidence. INDUCTION_CONTENT_RESET_ENABLED=1
#                 stands these down while the platform is still being built.
#
# WHAT MUST BE TRUE:
#   ONE DEFINITION        consumption.ts answers "has a real person had this", and
#                         every delete asks it rather than rolling its own test.
#   FAIL-CLOSED FLAG      exactly "1"; anything else, including "true", is off.
#   EVIDENCE IS OUTSIDE   the published and watched refusals are checked BEFORE the
#                         flag is consulted, so no flag can reach them.
#   THE CASCADE IS GUARDED  LibraryAsset -> InductionVideo -> InductionVideoView are
#                         all onDelete: Cascade, so a bare libraryAsset.delete()
#                         destroys operative viewing records and reports success.
#                         assetDeletion is the only thing that refuses it.
#   THE SHARED BLOB LIVES  a company production's MP4 is what the library revision
#                         serves, so a delete must not take a file still in use.
#   RESET IS NOT A BYPASS  resetLibraryAsset asks the same predicate as the delete.
#   THE UI CANNOT LIE     versionMayBeDeleted follows the same flag as the service.
#   DELETE IS A DIRECTOR'S  every new path checks canIssue.
#
# (Inherited: the modules archive gate.)
#
# RETIRED MODULES LIVE IN AN ARCHIVE, NOT IN COMPANY MODULES.
#
# WHAT MUST BE TRUE:
#   THE LOADER SPLITS       moduleRowsForIndex returns ACTIVE rows + retired metadata,
#                           so the primary page cannot render a retired module at all.
#   NO "SHOW RETIRED"       the checkbox is gone; the archive is a place.
#   ARCHIVED != MISSING     a retired standard module is not offered for creation.
#   THE ARCHIVE EXISTS      modules/archive in BOTH tiers, one shared component.
#   NO INVENTED DATE        retirement is not recorded, so none is shown.
#   NO RETIRED+MANDATORY    restoring one would force it onto every site.
#
# (Inherited: the module reduction gate.)
#
# THE STANDARD COMPANY MODULE SET IS THREE (owner's decision, 2026-09-30).
#
# WHAT MUST BE TRUE:
#   THREE STANDARD MODULES   intro, behaviour, accident — and no more.
#   THE RETIRED ARE RECORDED with what covers each, so a re-add is argued for.
#   AN OPTIONAL TIER EXISTS  manual handling: never seeded, never "missing", off by
#                            default — and creatable, because seeding is the ONLY way
#                            a module can come into being.
#   COVERAGE STILL HOLDS     site PPE still gates video; the housekeeping rules and
#                            the ENVIRONMENTAL scene still exist.
#
# THE PRODUCTION FLAGS ARE NOT CHANGED BY THIS DEPLOY. seedModuleCatalogue skips any
# slug that already exists, so live rows keep their flags: run
# scripts/module_catalogue_reduce.sh (DRY_RUN=1 first).
#
# (Inherited: the compact attention gate.)
#
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
#   (that gate capped the rows at four; the cap is gone now - see the top block)
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
ZIP=/tmp/modules_archive_deploy.zip
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

# ── THE COPY STEP 6 LOOKS FOR IN THE BUILD ────────────────────────────────
#
# Declared HERE, not inside step 6, because DRY_RUN stops after step 3 and therefore
# never exercised this list. TWICE in one day a deploy failed at step 6 on a string
# the same change had deliberately REWORDED - "Reusable company footage that every
# project", then "Reaches nobody" - each costing a full build to discover. Step 3 now
# proves every entry still exists in the SOURCE, so a string I have invalidated fails
# in the dry run instead of twenty minutes later.
BUILD_STRINGS=(
  "Where will the video come from?"
  "Where this video is used"
  "Company standards"
  "SiteComply produces it"
  "Produce the video from this module"
  "standard module is missing"
  "Under way"
  "Discard it"
  "produced from the wrong module"
  "is already being produced"
  "updates on its own as each step finishes"
  "appears here as it is recorded"
  "Where this module is used"
  "Reusable company footage every project"
  "Worth knowing"
  "Show detail"
  "not live"
  "Not started"
  "Retired modules"
  "Nothing is retired"
  "Delete permanently"
  "Discard this revision"
  "build phase"
  "will stop standing in for this"
  "Clear the content and start again"
  "This subject is no longer wanted"
  "Keeps the module itself"
  "use Start again above"
  "standard company subject"
  "is not cleared here"
  "Clear the footage and start again"
  "This video should not exist at all"
  "Keeps this video itself"
  "the company module it stands in for"
  "required on every project"
  "Discard this draft"
  "the issued revision stays in force"
  "leaves this module with nothing written"
  "Turn it into a video by reading it aloud first"
  "This page updates itself"
  "Watch it through before it goes live"
  "Review narration"
  "Preview video"
  "Publish into the Library"
  "Where this module is used"
)

echo "[3/7] Asserting the source, the history and the database..."
python3 - "${BUILD_STRINGS[@]}" <<'PYSTRINGS' || fail "the build check wants copy that is in no source file - reworded copy, stale assert"
import re, sys, pathlib
wanted = sys.argv[1:]
blob = []
for root in ('app', 'components', 'services'):
    for f in pathlib.Path(root).rglob('*'):
        if f.suffix not in ('.ts', '.tsx') or not f.is_file():
            continue
        src = f.read_text()
        src = re.sub(r'/\*[\s\S]*?\*/', '', src)
        src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
        blob.append(src)
joined = '\n'.join(blob)
missing = [w for w in wanted if w not in joined]
for w in missing:
    print(f'      MISSING FROM SOURCE: "{w}"')
sys.exit(1 if missing else 0)
PYSTRINGS
for f in "$STATUS" "$TAX" "$USAGE" "$DETAILSVC" "$SVC" "$INDEX" "$DETAIL" "$PP" "$AP"; do
  test -f "$f" || fail "missing: $f"
done

bash scripts/check_migration_drift.sh || fail "the migration history cannot rebuild the schema"

# ════════════════════════════════════════════════════════════════════════════
# BUILD-PHASE RESET: THE LINE BETWEEN EVIDENCE AND HOUSEKEEPING
# ════════════════════════════════════════════════════════════════════════════
BP=services/inductionContent/buildPhase.ts
CONS=services/inductionContent/consumption.ts
MODSVC=services/inductionModules/inductionModuleService.ts
VIDSVC=services/inductionVideo/inductionVideoService.ts

for f in "$BP" "$CONS"; do test -f "$f" || fail "missing: $f"; done

# --- THE FLAG IS FAIL-CLOSED AND NAMED ONCE ---
grep -qF "INDUCTION_CONTENT_RESET_ENABLED === '1'" "$BP" \
  || fail "the flag is not compared to exactly \"1\" - a truthy check would let \"false\" enable it"
OTHER=$(grep -rl "INDUCTION_CONTENT_RESET_ENABLED" app components services lib 2>/dev/null \
        | grep -v "^$BP$" || true)
[ -z "$OTHER" ] \
  || fail "the env var is read outside buildPhase.ts ($OTHER) - one reader, or the modes drift"

# --- ONE DEFINITION OF CONSUMPTION ---
for FN in videoConsumption moduleConsumption assetConsumption blobServedByLibrary; do
  grep -q "export async function $FN" "$CONS" || fail "$FN is gone from the consumption module"
done
# Both carriers of module content, neither of which is a foreign key. Asking only
# about scenes would call a module unconsumed while a published company video was
# produced from it.
grep -q "moduleRevisionId: { in: revisionIds }" "$CONS" \
  || fail "consumption does not ask about scenes carrying the module"
grep -q "sourceModuleRevisionId: { in: revisionIds }" "$CONS" \
  || fail "consumption does not ask about company videos produced from the module"
grep -q "libraryRevisionId: { in: revisionIds }" "$CONS" \
  || fail "consumption does not ask about inductions that spliced the asset's footage"
grep -qF "libraryAssetId: assetId" "$CONS" \
  || fail "consumption does not ask about the asset's own productions - the cascading ones"

# --- EVIDENCE IS CHECKED BEFORE THE FLAG IS EVER CONSULTED ---
# Line numbers, not just presence: if the published or watched refusal ever moved
# INSIDE the flag block, the flag would start deleting operative records.
python3 - "$VIDSVC" <<'PYORDER' || fail "an evidence refusal is gated on the build-phase flag"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)

MARKERS = {
    'published': 'video.publishedAt || video.status === InductionVideoStatus.PUBLISHED',
    'watched': 'video._count.views > 0',
}
flag = src.find('if (!contentResetEnabled())')
if flag < 0:
    print('      the build-phase block is gone entirely')
    sys.exit(1)

bad = False
for name, marker in MARKERS.items():
    at = src.find(marker)
    if at < 0:
        print(f'      NOT FOUND: the {name} refusal')
        bad = True
        continue
    # POSITION IS NOT ENOUGH. A mutation that leaves the refusal where it is but wraps
    # it in `if (!contentResetEnabled() && (...))` keeps the original ordering intact
    # and passed an earlier version of this assert. So the enclosing condition itself
    # is read: walk back to the `if (` that opens it and require the flag to be absent
    # from it.
    opener = src.rfind('if (', 0, at)
    if opener < 0:
        print(f'      the {name} refusal is not inside an if at all')
        bad = True
        continue
    condition = src[opener:at + len(marker)]
    if 'contentResetEnabled' in condition:
        print(f'      the {name} refusal IS GATED ON THE FLAG: {condition.strip()[:120]}')
        bad = True
        continue
    if at > flag:
        print(f'      the {name} refusal sits after the flag block at {flag}')
        bad = True
sys.exit(1 if bad else 0)
PYORDER

# The two that DO move, and the one that does not.
grep -qF "if (video.supersededAt)" "$VIDSVC" || fail "the superseded refusal is gone entirely"
grep -qF "DELETABLE as string[]).includes(video.status)" "$VIDSVC" \
  || fail "the approved-status refusal is gone entirely"
grep -qF "j.status === 'QUEUED' || j.status === 'RUNNING'" "$VIDSVC" \
  || fail "the in-flight-job refusal is gone - a delete mid-render orphans the runner"

# --- THE UI PREDICATE FOLLOWS THE SAME FLAG ---
grep -qF "if (contentResetEnabled()) return true;" "$VIDSVC" \
  || fail "versionMayBeDeleted does not follow the flag - a button offered then refused"

# --- THE CASCADE TRAP IS GUARDED, AND NOTHING DELETES AN ASSET BARE ---
grep -qF "const deletion = await assetDeletion(assetId);" "$SVC" \
  || fail "deleteLibraryAsset does not ask assetDeletion"
grep -qF "const reset = await assetReset(assetId);" "$SVC" \
  || fail "resetLibraryAsset does not ask assetReset"
# The evidence fact is reported SEPARATELY from `deletable`, because a per-revision
# decision needs it on its own. Expressed as `consumed: state.consumed` since the
# predicates were split; the old grep looked for the literal `consumed: true`.
grep -qF "consumed: state.consumed" "$SVC" \
  || fail "assetDeletion no longer reports the evidence fact separately"

# --- TWO PREDICATES, ONE EVIDENCE REFUSAL, AND ONLY DELETE CARRIES `mandatory` ---
python3 - "$SVC" <<'PYSPLIT' || fail "the reset and delete predicates have drifted or re-merged"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)

def body(name, src=src):
    at = src.find(f'export async function {name}(')
    if at < 0:
        at = src.find(f'function {name}(')
    if at < 0:
        return ''
    rest = src[at:]
    nxt = rest.find('\nexport ', 1)
    return rest[:nxt] if nxt > 0 else rest

shared = body('sharedContentRefusal')
reset = body('assetReset')
delete = body('assetDeletion')
bad = []
if not shared:
    bad.append('sharedContentRefusal is gone - the two predicates no longer share an evidence rule')
else:
    if 'state.consumed' not in shared:
        bad.append('the shared refusal does not check consumption')
    if shared.index('state.consumed') > shared.index('contentResetEnabled()'):
        bad.append('the shared refusal consults the flag before evidence')
for name, b in (('assetReset', reset), ('assetDeletion', delete)):
    if not b:
        bad.append(f'{name} is gone')
    elif 'sharedContentRefusal(state)' not in b:
        bad.append(f'{name} no longer asks the shared evidence refusal')
# THE BUG: the mandatory rule must live in the DELETE only. In the reset it blocks
# the very action its own refusal text recommends.
if reset and 'state.mandatory' in reset:
    bad.append('assetReset checks `mandatory` - that blocks the Start again the delete refusal recommends')
# ...and it must not hide in the SHARED refusal either, which assetReset calls. That
# mutation slipped past this assert until the shared body was checked too; only the
# behavioural suite caught it.
if shared and 'state.mandatory' in shared:
    bad.append('sharedContentRefusal checks `mandatory` - assetReset calls it, so the reset is blocked too')
if delete and 'state.mandatory' not in delete:
    bad.append('assetDeletion lost the mandatory guard')
for x in bad:
    print(f'      {x}')
sys.exit(1 if bad else 0)
PYSPLIT

# --- RESET MUST NOT TOUCH THE ASSET ROW OR THE PROJECT DECISIONS ---
python3 - "$SVC" <<'PYASSETRESET' || fail "resetLibraryAsset writes something it is supposed to keep"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
at = src.find('export async function resetLibraryAsset(')
if at < 0:
    print('      resetLibraryAsset not found')
    sys.exit(1)
rest = src[at:]
nxt = rest.find('\nexport ', 1)
b = rest[:nxt] if nxt > 0 else rest
bad = []
if 'libraryAsset.update' in b or 'prisma.libraryAsset.delete' in b:
    bad.append('it writes the LibraryAsset row - slug, category, placement and the module link must survive')
if 'siteLibraryAsset' in b:
    bad.append('it touches SiteLibraryAsset - the project decisions are the point of reset')
if 'libraryAssetRevision.deleteMany' not in b:
    bad.append('it does not clear the revisions')
if 'inductionVideo.deleteMany' not in b:
    bad.append('it does not clear the productions')
for x in bad: print(f'      {x}')
sys.exit(1 if bad else 0)
PYASSETRESET

# --- THE ASSET PAGE READS LIKE THE MODULE PAGE ---
grep -qF "Clear the footage and start again" "$DETAIL" \
  || fail "the asset page does not offer Start again"
grep -qF "This video should not exist at all" "$DETAIL" \
  || fail "asset delete is not behind a meaning-first disclosure"
python3 - "$DETAIL" <<'PYASSETUI' || fail "asset delete is rendered before Start again"
import sys
src = open(sys.argv[1]).read()
r = src.find('Clear the footage and start again')
d = src.find('This video should not exist at all')
if r < 0 or d < 0:
    print('      one of the two panels is missing')
    sys.exit(1)
sys.exit(0 if r < d else 1)
PYASSETUI
grep -qF "asset.reset.resettable" "$DETAIL" \
  || fail "the asset page asks the DELETE predicate for its reset panel - a mandatory video would be refused"
# Exactly one libraryAsset.delete, in deleteLibraryAsset, and counted against
# COMMENT-STRIPPED source: the doc comment above it quotes
# `prisma.libraryAsset.delete()` while explaining why it is dangerous, so a plain
# grep counts the warning as a second call site. (The same trap cost a build on the
# archive deploy, where a removed phrase survived in the comment explaining its
# removal.)
python3 - "$SVC" <<'PYONEDEL' || fail "libraryAsset.delete appears more than once in real code - each is a cascade into view rows"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
n = src.count('prisma.libraryAsset.delete(')
if n != 1:
    print(f'      found {n} real libraryAsset.delete call(s), expected exactly 1')
sys.exit(0 if n == 1 else 1)
PYONEDEL

# --- THE SHARED BLOB IS NOT PULLED OUT FROM UNDER THE LIBRARY ---
grep -qF "blobServedByLibrary(video.videoBlobPath)" "$VIDSVC" \
  || fail "the video delete does not check whether a library revision serves its MP4"
grep -qF "function ownsBlob" "$SVC" \
  || fail "the library delete no longer distinguishes blobs it owns from ones it serves"

# --- DELETE IS A DIRECTOR'S, EVERYWHERE ---
for PAIR in "$MODSVC:deleteModule" "$SVC:deleteLibraryAsset" "$SVC:resetLibraryAsset" \
            "$SVC:discardLibraryRevision"; do
  F="${PAIR%%:*}"; FN="${PAIR##*:}"
  python3 - "$F" "$FN" <<'PYAUTH' || fail "$FN does not check canIssue before anything else"
import re, sys
src = open(sys.argv[1]).read()
fn = sys.argv[2]
at = src.find(f'export async function {fn}(')
if at < 0:
    print(f'      {fn} not found')
    sys.exit(1)
body = src[at:at + 1200]
sys.exit(0 if 'actor.canIssue' in body else 1)
PYAUTH
done

# --- A CONSUMED MODULE IS REFUSED REGARDLESS OF THE FLAG ---
python3 - "$MODSVC" <<'PYMOD' || fail "moduleDeletion consults the flag before consumption"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
at = src.find('export async function moduleDeletion(')
body = src[at:src.find('export async function deleteModule(')]
cons = body.find('consumption.consumed')
flag = body.find('contentResetEnabled()')
if cons < 0 or flag < 0:
    print('      one of the two checks is missing')
    sys.exit(1)
sys.exit(0 if cons < flag else 1)
PYMOD

# --- THE DISPATCHERS EXPOSE THEM, BOTH TIERS SHARE THEM ---
grep -qF "case 'deleteModule'" services/inductionModules/moduleActions.ts \
  || fail "the module dispatcher does not expose deleteModule"
for A in discardRevision resetAsset deleteAsset; do
  grep -qF "case '$A'" services/inductionVideo/libraryActions.ts \
    || fail "the library dispatcher does not expose $A"
done

# --- THE ARCHIVE STAYS A SERVER COMPONENT ---
# Deleting happens on the module's own page, where the consequence is in front of the
# person pressing. A row-level button would also mean shipping JS to this page.
grep -q "'use client'" components/inductionModules/ModulesArchive.tsx \
  && fail "the archive became a client component - deleting belongs on the module page"

# --- THE CAPABILITY IS NEVER SILENT ---
grep -qF "BUILD_PHASE_NOTICE" "$BP" || fail "the build-phase notice is gone"
grep -qF "buildPhaseNotice" services/inductionModules/moduleDetail.ts \
  || fail "the module page cannot say the platform is in its build phase"
grep -qF "buildPhaseNotice" "$DETAILSVC" \
  || fail "the asset page cannot say the platform is in its build phase"
for C in components/inductionModules/ModuleDetail.tsx "$DETAIL"; do
  grep -qF "buildPhaseNotice" "$C" || fail "$C does not render the notice"
done
echo "  ok   build-phase reset: evidence is outside the flag, the cascade is guarded"

# ════════════════════════════════════════════════════════════════════════════
# RESET IS NOT DELETE
# ════════════════════════════════════════════════════════════════════════════
MDETAIL=components/inductionModules/ModuleDetail.tsx

for FN in moduleReset resetModule; do
  grep -q "export async function $FN" "$MODSVC" || fail "$FN is gone - clearing content would mean deleting the subject again"
done

# --- RESET MUST NOT TOUCH THE MODULE ROW OR THE PROJECT DECISIONS ---
# The whole distinction. Read the function body rather than the file, because
# `setModuleActive` and `updateModuleSettings` legitimately update the module row.
python3 - "$MODSVC" <<'PYRESET' || fail "resetModule writes something it is supposed to keep"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
at = src.find('export async function resetModule(')
if at < 0:
    print('      resetModule not found')
    sys.exit(1)
body = src[at:]
nxt = body.find('\nexport ', 1)
if nxt > 0:
    body = body[:nxt]
bad = []
# The subject itself, and every project's decision about it, must survive.
if 'inductionModule.update' in body or 'inductionModule.delete' in body:
    bad.append('it writes the InductionModule row')
if 'siteInductionModule' in body:
    bad.append('it touches SiteInductionModule - the decisions are the point of reset')
if 'libraryAsset' in body and 'libraryAssetRevision' in body:
    bad.append('it clears Library footage - that belongs to the asset\'s own page')
# And it must actually clear the revisions.
if 'inductionModuleRevision.deleteMany' not in body:
    bad.append('it does not clear the revisions')
for b in bad:
    print(f'      {b}')
sys.exit(1 if bad else 0)
PYRESET

# --- RESET ASKS CONSUMPTION FIRST, AND A JOB IN FLIGHT IS NOT RELAXED ---
python3 - "$MODSVC" <<'PYRESETGUARD' || fail "moduleReset consults the flag before evidence, or lost the in-flight check"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
at = src.find('export async function moduleReset(')
body = src[at:src.find('export async function resetModule(')]
cons = body.find('consumption.consumed')
flag = body.find('contentResetEnabled()')
job = body.find("j.status === 'QUEUED' || j.status === 'RUNNING'")
bad = []
if cons < 0: bad.append('moduleReset does not ask about consumption')
if flag < 0: bad.append('moduleReset does not consult the flag at all')
if job < 0: bad.append('moduleReset lost the in-flight-job check')
if cons >= 0 and flag >= 0 and cons > flag:
    bad.append('the flag is consulted BEFORE evidence')
if cons >= 0 and job >= 0 and job < cons:
    bad.append('the job check precedes the evidence check - evidence comes first')
for b in bad: print(f'      {b}')
sys.exit(1 if bad else 0)
PYRESETGUARD

# --- A STANDARD SUBJECT IS NOT DELETED TO RESTART IT ---
# THE WHOLE CONDITION, PINNED. A substring grep cannot see a neutralised guard:
# `if (false && module.active && MODULE_CATALOGUE.some(...))` still contains
# "module.active && MODULE_CATALOGUE.some", and that mutation survived this assert
# until the condition itself was matched end to end.
python3 - "$MODSVC" <<'PYSTANDARD' || fail "the standard-subject delete guard is gone, neutralised or reworded"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
want = re.compile(
    r'^\s*if \(module\.active && MODULE_CATALOGUE\.some\(\(c\) => c\.slug === module\.slug\)\) \{$',
    re.M,
)
if not want.search(src):
    print('      the guard is not exactly `if (module.active && MODULE_CATALOGUE.some((c) => c.slug === module.slug)) {`')
    for line in src.splitlines():
        if 'MODULE_CATALOGUE.some' in line:
            print(f'      found instead: {line.strip()}')
    sys.exit(1)
sys.exit(0)
PYSTANDARD
# deleteModule delegates entirely, which is why the suite does not call it against
# the real seeded row (a mutation run would then delete Company Introduction - it did).
python3 - "$MODSVC" <<'PYDELEGATE' || fail "deleteModule does not delegate to moduleDeletion"
import re, sys
src = open(sys.argv[1]).read()
at = src.find('export async function deleteModule(')
body = src[at:at + 1600]
sys.exit(0 if 'await moduleDeletion(moduleId)' in body and '!deletion.deletable' in body else 1)
PYDELEGATE

# --- THE PAGE LEADS WITH RESET AND HIDES DELETE ---
grep -qF "Clear the content and start again" "$MDETAIL" \
  || fail "the module page does not offer Start again"
grep -qF "This subject is no longer wanted" "$MDETAIL" \
  || fail "delete is not behind a meaning-first disclosure"
grep -qF "<details" "$MDETAIL" \
  || fail "delete is not in a <details> - a delete button beside a reset invites the wrong press"
# Reset must come FIRST on the page: it is the ordinary action.
python3 - "$MDETAIL" <<'PYORDERUI' || fail "delete is rendered before Start again"
import sys
src = open(sys.argv[1]).read()
r = src.find('Clear the content and start again')
d = src.find('This subject is no longer wanted')
if r < 0 or d < 0:
    print('      one of the two panels is missing')
    sys.exit(1)
sys.exit(0 if r < d else 1)
PYORDERUI
grep -qF "will not appear in any" "$MDETAIL" \
  || fail "the page does not warn that clearing the wording drops the subject from inductions"
grep -qF "case 'resetModule'" services/inductionModules/moduleActions.ts \
  || fail "the dispatcher does not expose resetModule"
echo "  ok   reset keeps the subject; delete is secondary and guarded on standard subjects"

# ════════════════════════════════════════════════════════════════════════════
# ONE DRAFT CAN BE DISCARDED WITHOUT RESETTING ANYTHING
# ════════════════════════════════════════════════════════════════════════════
grep -q "export async function discardModuleDraft" "$MODSVC" \
  || fail "discardModuleDraft is gone - undoing a bad draft would need a full reset again"

python3 - "$MODSVC" <<'PYDRAFT' || fail "discardModuleDraft touches more than the one draft, or lost a guard"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
at = src.find('export async function discardModuleDraft(')
if at < 0:
    print('      discardModuleDraft not found')
    sys.exit(1)
rest = src[at:]
nxt = rest.find('\nexport ', 1)
body = rest[:nxt] if nxt > 0 else rest

bad = []
# DRAFT ONLY. Without this the path could remove an issued revision - the one thing
# the whole lifecycle exists to keep.
# THE EXACT CONDITION, not merely the presence of the enum. `DRAFT` also appears
# further down in the `stillIssued` count, so a presence check passed while the guard
# itself was neutralised to `if (false)` - the third time in this file that a
# substring assert could not see disabled logic.
if not re.search(
    r'if \(revision\.status !== InductionModuleRevisionStatus\.DRAFT\) \{',
    body,
):
    bad.append('the DRAFT-only guard is gone, neutralised or reworded')
# The drafter's, not the issuer's.
if 'actor.canDraft' not in body:
    bad.append('it does not check canDraft')
if 'actor.canIssue' in body:
    bad.append('it checks canIssue - the drafter who wrote it may throw it away')
# Ownership, or the endpoint discards any draft of any module by id.
if "revision.moduleId !== moduleId" not in body:
    bad.append('it does not verify the revision belongs to this module')
# The defensive check that a draft has not somehow reached a video.
if 'moduleRevisionId: revisionId' not in body or 'sourceModuleRevisionId: revisionId' not in body:
    bad.append('it no longer checks both carriers before deleting')
# EXACTLY ONE ROW GOES. Anything else here is a reset wearing a smaller label.
if 'inductionModuleRevision.delete(' not in body:
    bad.append('it does not delete the revision')
for forbidden, why in (
    ('inductionModuleRevision.deleteMany', 'deleteMany would take more than this draft'),
    ('inductionModule.update', 'it writes the module row'),
    ('inductionModule.delete', 'it deletes the module'),
    ('siteInductionModule', 'it touches a per-project decision'),
    ('inductionVideo.delete', 'it deletes a video'),
    ('inductionVideoScene.update', 'it rewrites a scene'),
    ('libraryAsset', 'it reaches a library asset'),
    ('deleteMedia', 'it deletes media - a draft has none'),
):
    if forbidden in body:
        bad.append(f'{why} ({forbidden})')
# NOT gated on the build phase: a draft reached nobody, so this is ordinary editing.
if 'contentResetEnabled' in body:
    bad.append('it is gated on the build-phase flag - undoing a draft is ordinary editing')
for x in bad:
    print(f'      {x}')
sys.exit(1 if bad else 0)
PYDRAFT

grep -qF "case 'discardDraft'" services/inductionModules/moduleActions.ts \
  || fail "the dispatcher does not expose discardDraft"
grep -qF "detail.draftDiscard" "$MDETAIL" \
  || fail "the module page does not offer the per-draft discard"
grep -qF "setEditing(false)" "$MDETAIL" \
  || fail "the editor is not closed after a discard - the next save would post to a dead revision"
# The routine undo must sit ABOVE the big hammer.
python3 - "$MDETAIL" <<'PYDRAFTORDER' || fail "Start again is offered before the per-draft discard"
import sys
src = open(sys.argv[1]).read()
d = src.find('Discard this draft')
r = src.find('Clear the content and start again')
if d < 0 or r < 0:
    print('      one of the two controls is missing')
    sys.exit(1)
sys.exit(0 if d < r else 1)
PYDRAFTORDER
echo "  ok   a bad draft is undone on its own, and nothing live moves"

# ════════════════════════════════════════════════════════════════════════════
# THE MODULE PAGE OWNS THE VIDEO WORKFLOW
# ════════════════════════════════════════════════════════════════════════════
STAGE=services/inductionVideo/moduleVideoStage.ts
SHAPE=services/inductionVideo/videoStageShape.ts
PANEL=components/inductionModules/ModuleWorkflowCard.tsx
STEPPER=components/inductionVideo/VideoStepper.tsx

for f in "$STAGE" "$SHAPE" "$PANEL" "$STEPPER"; do test -f "$f" || fail "missing: $f"; done

# --- THE SHARED VOCABULARY STAYS FREE OF THE SERVER ---
# The stepper imports the step names. When they lived beside the queries, that dragged
# the Prisma client into the browser bundle - caught by the leak check below the first
# time this gate ran. Keep them apart.
grep -qE "from '@prisma/client'|@/lib/prisma" "$SHAPE" \
  && fail "$SHAPE imports the server - the stepper would pull Prisma into the bundle"
grep -qF "videoStageShape" "$STEPPER" \
  || fail "the stepper no longer takes its vocabulary from the pure module"

# --- THE BLOCKER THAT MADE THE WHOLE FLOW IMPOSSIBLE ---
# A generated revision has no uploaded source; its render IS its footage. Pinned as the
# exact expression, because a substring check cannot see it narrowed back.
grep -qF "Boolean(rev.sourceBlobPath || rev.normalisedBlobPath)" "$SVC" \
  || fail "revisionReadiness is back to requiring an upload - no generated video could be issued"

# --- ONE DERIVED STAGE, NEVER STORED ---
grep -qE "videoStage\s+String|videoStep\s+Int" prisma/schema.prisma \
  && fail "a stage column appeared - a stored stage is a fifth source of truth"
grep -q "export async function moduleVideoStage" "$STAGE" || fail "the derived stage is gone"

# --- THE EIGHT STEPS ARE THE OWNER'S, IN ORDER ---
python3 - "$SHAPE" <<'PYSTEPS' || fail "the eight steps are not the ones the owner specified"
import re, sys
src = open(sys.argv[1]).read()
m = re.search(r'export const VIDEO_STEPS = \[(.*?)\] as const;', src, re.S)
if not m:
    print('      VIDEO_STEPS is gone')
    sys.exit(1)
got = re.findall(r"'([^']+)'", m.group(1))
want = ['Write wording', 'Issue wording', 'Generate narration', 'Review narration',
        'Generate video', 'Preview video', 'Publish & issue', 'Live']
if got != want:
    print(f'      got:  {got}')
    print(f'      want: {want}')
    sys.exit(1)
sys.exit(0)
PYSTEPS

# --- NO DEAD END: every stage that is not LIVE and not mid-job offers an action ---
python3 - "$STAGE" <<'PYNODEAD' || fail "a stage returns no next action and is not LIVE or a wait"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)

def args_of(text, at):
    """The top-level arguments of the call whose '(' is at `at`. A window-based regex
    read into the NEXT stageOf call and mis-flagged LIVE_WORDING_MOVED_ON, which does
    offer an action — so the parentheses are actually counted."""
    depth, start, out = 0, at + 1, []
    i = at
    while i < len(text):
        c = text[i]
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
            if depth == 0:
                out.append(text[start:i].strip())
                return out
        elif c == ',' and depth == 1:
            out.append(text[start:i].strip())
            start = i + 1
        i += 1
    return out

# A stage may legitimately have nothing to press: it is finished, or a job is running,
# or the module does not exist.
ALLOWED_NULL = {'LIVE', 'NARRATING', 'RENDERING', 'NO_WORDING'}
bad = []
for m in re.finditer(r"stageOf\(", src):
    a = args_of(src, m.end() - 1)
    if len(a) < 4:
        continue
    key = a[0].strip().strip("'")
    if a[3].strip() == 'null' and key not in ALLOWED_NULL:
        bad.append(key)
for b in sorted(set(bad)):
    print(f'      {b} offers no next action but is not LIVE or a wait')
sys.exit(1 if bad else 0)
PYNODEAD

# --- THE ASSET IS PROVISIONED, AND INVISIBLE ---
grep -q "export async function ensureGeneratedAssetForModule" \
  services/inductionVideo/companyVideoService.ts \
  || fail "the asset is no longer provisioned - the user is back to creating one by hand"
grep -qF "LibraryPlacement.COMPANY_BAND" services/inductionVideo/companyVideoService.ts \
  || fail "the provisioned asset is not in the company band - it would move the running order"
grep -qF "order: module.order" services/inductionVideo/companyVideoService.ts \
  || fail "the provisioned asset does not take the module's own order"
# The words the redesign exists to keep off the page.
python3 - "$PANEL" <<'PYHIDDEN' || fail "the panel names an internal concept to the user"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'\{/\*[\s\S]*?\*/\}', '', src)
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
bad = [w for w in ('LibraryAsset', 'revision', 'production', 'asset')
       if re.search(r'>[^<{}]*\b' + w, src, re.I)]
for w in bad:
    print(f'      the panel says "{w}" in visible text')
sys.exit(1 if bad else 0)
PYHIDDEN

# --- THE THREE ACTIONS, AND THE PAGE THAT MOUNTS THEM ---
for A in generateNarration generateVideo publishAndIssue; do
  grep -qF "case '$A'" services/inductionModules/moduleActions.ts \
    || fail "the dispatcher does not expose $A"
done
grep -qF "<ModuleWorkflowCard" "$MDETAIL" || fail "the module page does not mount the video panel"
grep -qF "detail.video" "$MDETAIL" || fail "the module page does not pass the derived stage"
grep -qF "m.video.step" components/inductionModules/ModulesIndex.tsx \
  || fail "the index lost its Video column - the workflow state is invisible from the list"

# --- BOTH TIERS CAN ACTUALLY WATCH IT ---
for R in video captions transcript "audio/[sceneId]"; do
  test -f "app/api/admin/induction-video/[videoId]/$R/route.ts" \
    || fail "admin media route missing: $R"
done
for C in components/platform/NarrationPanel.tsx components/platform/RenderPanel.tsx; do
  grep -qF "/api/platform/induction-video" "$C" \
    && fail "$C hard-codes the platform API again - the Admin Centre would 401 on media"
done
grep -qF "isCompany" components/platform/RenderPanel.tsx \
  || fail "RenderPanel is not scope-aware - it would tell a company video it reaches operatives"
grep -qF "Publish into the Library" components/platform/RenderPanel.tsx \
  || fail "the company publish label is gone"
echo "  ok   the module page owns the workflow, and the blocker stays fixed"

# ════════════════════════════════════════════════════════════════════════════
# THE PAGE LEADS WITH THE WORKFLOW
# ════════════════════════════════════════════════════════════════════════════
CARD=components/inductionModules/ModuleWorkflowCard.tsx
test -f "$CARD" || fail "missing: $CARD"

# --- ORDER: the workflow card is rendered before every other section ---
python3 - "$MDETAIL" <<'PYORDER2' || fail "the workflow is no longer first on the module page"
import re, sys
src = open(sys.argv[1]).read()
card = src.find('<ModuleWorkflowCard')
if card < 0:
    print('      the workflow card is not mounted')
    sys.exit(1)
bad = []
for label, needle in (
    ('the wording', 'What it will say'),
    ('the usage figures', 'Where this module is used'),
    ('the revision history', '>Revisions<'),
):
    at = src.find(needle)
    if at < 0:
        continue
    if at < card:
        bad.append(f'{label} is rendered before the workflow card')
for b in bad:
    print(f'      {b}')
sys.exit(1 if bad else 0)
PYORDER2

# --- ONE PRIMARY WEIGHT ---
# `border-2` is a SUBSTRING of `border-200`, which every quiet card uses
# (border-brand-200, border-safe-200, border-danger-200) - so a plain grep found the
# secondary cards and called them primary. Matched with a boundary instead.
grep -qE '\bborder-2( |"|\x27)' "$CARD" \
  || fail "the workflow card is no longer visually primary"
grep -qE '\bborder-2( |"|\x27)' "$MDETAIL" \
  && fail "a second card on the module page claims primary weight"
# One shell for everything secondary, rather than the class repeated per section.
grep -qF "const SECONDARY =" "$MDETAIL" \
  || fail "the secondary shell is back to being spelled out per section"
grep -qF 'rounded-xl border border-line bg-surface p-4 shadow-card' "$MDETAIL" \
  && fail "a section still hard-codes the old identical chrome"

# --- PROGRESSIVE DISCLOSURE, DRIVEN BY THE STAGE ---
grep -qF "const wordingIsPrimary" "$MDETAIL" \
  || fail "the wording no longer opens and closes with the stage"
grep -qF "detail.video.step <= 2" "$MDETAIL" \
  || fail "the wording's open state is not derived from the step any more"
[ "$(grep -c '<details' "$MDETAIL")" -ge 4 ] \
  || fail "the secondary sections are not folded - they compete with the workflow again"

# --- NOTHING LOST TO TIDINESS ---
grep -qF "statusDetail" "$CARD" \
  || fail "the module's own state is a chip again - 'Live' does not distinguish live-with-a-draft"

# --- READABLE ON A PHONE ---
grep -qF "sm:hidden" components/inductionVideo/VideoStepper.tsx \
  || fail "the stepper has no narrow form - eight labels push the action below the fold"
grep -qF "hidden flex-wrap" components/inductionVideo/VideoStepper.tsx \
  || fail "the labelled stepper is no longer the wide-screen form"
echo "  ok   the workflow leads the page, and everything else is folded behind it"

# --- A FOLDED PANEL MUST LOOK FOLDABLE ---
# `display:flex` on a <summary> removes its list-item marker, so three of the four
# panels shipped with no disclosure triangle and no hint they opened. Measured on a
# real headless render, not guessed. Wrap the content in a span instead of flexing the
# summary itself.
grep -qE '<summary className="flex ' "$MDETAIL" \
  && fail "a <summary> is display:flex again - it loses its disclosure marker"

# --- THE PRIMARY ACTION IS ABOVE THE FOLD ---
# The preview card holds a PORTRAIT 1080x1920 player. At max-w-xs that is 569px tall,
# which put "Publish & issue" at 685px against a 640px viewport on a 1366x768 laptop.
# Capped by height and paired with the note instead.
grep -qF "max-h-48 w-auto" "$CARD" \
  || fail "the preview player is not height-capped - a portrait video pushes the action below the fold"
grep -qF "video.stage !== 'PREVIEW'" "$CARD" \
  || fail "the generic action block renders at PREVIEW too - the publish button would appear twice"
echo "  ok   folded panels look foldable, and the action stays above the fold"

# ════════════════════════════════════════════════════════════════════════════
# THE GENERATED VIDEO IS THE CUSTOMER'S, AND LEGIBLE
# ════════════════════════════════════════════════════════════════════════════
VIS=services/inductionVideo/sceneVisual.ts
ASS=services/inductionVideo/assDocument.ts

# --- THE CUSTOMER'S LOGO, NOT THE VENDOR'S ---
# Every operative on every site watched an induction badged with the SOFTWARE
# VENDOR's mark while CompanyConfig.logoBlobPath sat in storage, already used by the
# CPP's PDF.
grep -qF "brandLogo" services/inductionVideo/videoRenderer.ts \
  || fail "RenderRequest no longer carries the customer's logo"
grep -qF "request.brandLogo" services/inductionVideo/ffmpegRenderer.ts \
  || fail "the renderer ignores the customer's logo again"
grep -qF "companyLogoForVideo" services/inductionVideo/renderService.ts \
  || fail "renderService no longer fetches the company logo"

# --- THE FOOTER IS READABLE ---
# It was drawn in `rule`, the ACCENT colour: bright red on dark maroon, and on a real
# rendered frame it was barely there. Every palette carries its own muted footer now.
grep -qF "palette.footer" "$ASS" \
  || fail "the footer is drawn in the accent colour again - it was unreadable"
[ "$(grep -c 'footer:' "$VIS")" -ge 4 ] \
  || fail "a palette lost its footer colour"

# --- A SENTENCE ARRIVES WHOLE ---
# The staggered reveal stepped per WRAPPED LINE, so a sentence landed in halves.
grep -qF "lineGroups" "$VIS" || fail "sentence grouping is gone from the visual"
grep -qF "visual.lineGroups" "$ASS" \
  || fail "the stagger is back to stepping per wrapped line, splitting sentences"

# --- THE FRAME IS FILLED, AND BIG ENOUGH TO READ AT A GATE ---
python3 - "$ASS" "$VIS" <<'PYSIZES' || fail "the video type is back to the small, sparse sizes"
import re, sys
ass, vis = open(sys.argv[1]).read(), open(sys.argv[2]).read()
def num(src, name):
    m = re.search(rf'const {name} = (\d+);', src)
    return int(m.group(1)) if m else -1
bad = []
for src, name, floor in ((ass,'HEADING_SIZE',80),(ass,'BODY_SIZE',56),(ass,'BODY_LINE_STEP',88)):
    v = num(src, name)
    if v < floor:
        bad.append(f'{name} is {v}, below {floor}')
chars = num(vis, 'BODY_CHARS_PER_LINE')
if chars > 28:
    bad.append(f'BODY_CHARS_PER_LINE is {chars}: long lines leave the frame empty')
lines = num(vis, 'MAX_BODY_LINES')
if lines < 6:
    bad.append(f'MAX_BODY_LINES is {lines}: too few to fill a portrait frame')
for b in bad: print(f'      {b}')
sys.exit(1 if bad else 0)
PYSIZES
echo "  ok   the video carries the customer's mark, and the frame is legible"

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
# --- THE STANDARD SET IS THREE --------------------------------------------
CAT=services/inductionModules/moduleCatalogue.ts
python3 - "$CAT" <<'PYCAT' || fail "the standard module catalogue is not the agreed three"
import re, sys
src = open(sys.argv[1]).read()
std = src[src.index('export const MODULE_CATALOGUE'):src.index('export const OPTIONAL_MODULE_CATALOGUE')]
slugs = re.findall(r"slug: '([A-Z_]+)'", std)
expected = ['COMPANY_INTRODUCTION', 'BEHAVIOURAL_STANDARDS', 'ACCIDENT_REPORTING']
sys.exit(0 if sorted(slugs) == sorted(expected) else 1)
PYCAT
for GONE in PPE_EXPECTATIONS HOUSEKEEPING ENVIRONMENTAL_AWARENESS; do
  grep -q "'$GONE'," "$CAT" \
    || fail "$GONE is not recorded in RETIRED_STANDARD_SLUGS - the reasoning would be lost"
done
grep -q "export const RETIRED_STANDARD_SLUGS" "$CAT" \
  || fail "the retirement record is gone"
grep -q "export const OPTIONAL_MODULE_CATALOGUE" "$CAT" \
  || fail "the optional tier is gone - manual handling would be uncreatable"
python3 - "$CAT" <<'PYOPT' || fail "manual handling is not an optional, off-by-default entry"
import re, sys
src = open(sys.argv[1]).read()
opt = src[src.index('export const OPTIONAL_MODULE_CATALOGUE'):src.index('export const ALL_CATALOGUE_MODULES')]
sys.exit(0 if "slug: 'MANUAL_HANDLING'" in opt and 'defaultIncluded: false' in opt
         and 'mandatory: false' in opt else 1)
PYOPT
# THE ONE UNIVERSAL MODULE IS ON.
python3 - "$CAT" <<'PYINTRO' || fail "company introduction is not mandatory and on by default - it was the one universal module switched off"
import sys
src = open(sys.argv[1]).read()
i = src.index("slug: 'COMPANY_INTRODUCTION'")
block = src[i:src.index('heading:', i)]
sys.exit(0 if 'mandatory: true' in block and 'defaultIncluded: true' in block else 1)
PYINTRO
# THE COVERAGE THE RETIREMENTS DEPEND ON MUST STILL EXIST.
grep -qE "of: 'ppeItems'[^}]*gates: 'VIDEO'" services/sites/siteSetupCompletion.ts \
  || fail "site PPE no longer gates video generation - the PPE retirement depended on every video having a PPE scene"
grep -qF "Keep walkways, access routes and fire exits clear" services/checklists/ukSiteRulesLibrary.ts \
  || fail "the housekeeping site rule is gone - the retirement depended on it"
grep -qF "Keep your work area clean and tidy" services/checklists/ukSiteRulesLibrary.ts \
  || fail "the second housekeeping site rule is gone"
grep -qF "optional('ENVIRONMENTAL'" services/inductionVideo/sceneRules.ts \
  || fail "the site ENVIRONMENTAL scene is gone - the retirement depended on it"
grep -qF "optional('INCIDENT_REPORTING'" services/inductionVideo/sceneRules.ts \
  || fail "the scene accident reporting steps aside for is gone"
# THE ONLY ROUTE TO A MODULE OUTSIDE THE SET.
grep -q "export async function addCatalogueModule" services/inductionModules/inductionModuleService.ts \
  || fail "addCatalogueModule is gone - nothing could create the optional module"
grep -qF "case 'addCatalogueModule':" services/inductionModules/moduleActions.ts \
  || fail "the dispatcher cannot add a catalogue module"
grep -qF "action: 'addCatalogueModule'" components/inductionModules/ModulesIndex.tsx \
  || fail "the list offers no way to add the optional module"
# --- RETIRED MODULES ARE ARCHIVED, NOT LISTED ------------------------------
ARCH=components/inductionModules/ModulesArchive.tsx
test -f "$ARCH" || fail "the archive component is missing"
grep -q "export interface ModuleIndex" "$MROWS" \
  || fail "the loader no longer separates active rows from retired metadata"
grep -qF "rows: summaries.filter((m) => m.active).map(toRow)," "$MROWS" \
  || fail "the primary page is being given retired rows again - a component filter is one boolean from showing them"
grep -q "export async function retiredModuleRows" "$MROWS" \
  || fail "the archive loader is gone"
grep -qF "showRetired" "$IDX" \
  && fail "the Show retired checkbox is back - retired content is a place, not a toggle"
grep -qF "retired.slugs.includes(c.slug)" "$IDX" \
  || fail "an archived standard module would read as MISSING and be offered for creation, quietly un-retiring it"
grep -qF "/archive" "$IDX" || fail "the list does not link to the archive"
for P in "app/platform/dashboard/induction-videos/modules/archive/page.tsx" \
         "app/admin/(dashboard)/induction-videos/modules/archive/page.tsx"; do
  test -f "$P" || fail "missing archive route: $P"
  grep -q "<ModulesArchive" "$P" || fail "$P does not render the shared archive component"
  grep -qF "retiredModuleRows()" "$P" || fail "$P does not use the archive loader"
done
grep -qF "'use client'" "$ARCH" \
  && fail "the archive became a client component - it has no state and no handlers"
python3 - "$ARCH" <<'PYDATE' || fail "the archive shows a retirement date, which is not recorded anywhere"
import re, sys
src = open(sys.argv[1]).read()
src = re.sub(r'/\*[\s\S]*?\*/', '', src)
src = re.sub(r'\{/\*[\s\S]*?\*/\}', '', src)
sys.exit(1 if re.search(r'retiredOn|Retired on|retiredAt', src) else 0)
PYDATE
grep -qF "Every site, immediately" "$ARCH" \
  || fail "the archive no longer warns when restoring a module would force it onto every site"
echo "  ok   source asserts pass (224)"

if [ -z "$DRY" ]; then
  DB="$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='DATABASE_URL'].value" 2>/dev/null)"
  [ -n "$DB" ] || fail "could not read DATABASE_URL"
  export PGCONNECT_TIMEOUT=10
  FW_RULE=devvm-archdeploy; FW_IP=144.6.132.237; FW_OPENED=""
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
# ELEVEN SUITES WERE ADDED HERE ON 2026-09-30, and the reason is worth keeping: the
# induction-module suites were NOT in any gate, so two of them went stale without
# anybody noticing. `induction_modules_verify` still expected SIX standard modules and
# PPE_EXPECTATIONS to be mandatory - both changed when the owner reduced the catalogue
# - and it crashed on an undefined property rather than reporting a legible failure.
# `inductionvideo_liveupdate_verify` still expected `clearInterval`, left behind by the
# polling rewrite. A suite nobody runs is not a test; it is a file that looks like one.
# library_render_verify ACTUALLY RENDERS the index to HTML. Every other suite reads
# source or calls a service, and that gap cost twice in one day: a function prop that
# threw before rendering, and a page whose whole new structure was gated on having
# assets so an empty library looked untouched. Both passed every string assertion.
for S in module_video_flow_verify inductionvideo_render_verify content_reset_verify inductionvideo_delete_verify module_catalogue_reduction_verify attention_summary_verify module_master_detail_verify video_progress_verify library_production_visibility_verify cscs_enforcement_verify cscs_access_gate_verify cscs_exempt_verify brand_motion_verify company_video_verify library_render_verify library_ia_verify library_pipeline_verify library_audiospec_verify \
         inductionvideo_library_verify inductionvideo_verify inductionvideo_e2e_verify \
         setup_video_readiness_verify cpp_completion_verify site_rules_verify \
         induction_modules_verify induction_modules_phaseb_verify \
         induction_modules_phasec_verify induction_modules_realm_verify \
         induction_modules_ia_verify induction_modules_admin_ia_verify \
         induction_briefing_verify induction_grouping_verify \
         inductionvideo_liveupdate_verify inductionvideo_realm_verify \
         inductionvalidity_verify; do
  SRC="scripts/$S.ts"; [ -f "$SRC" ] || SRC="scripts/$S.tsx"
  OUT=$(npx tsx "$SRC" 2>&1) || { echo "$OUT" | tail -20; fail "$S failed"; }
  echo "$OUT" | grep -qE "(^| )0 failed" || { echo "$OUT" | tail -20; fail "$S did not report 0 failed"; }
  echo "  ok   $S"
done
echo "  ok   suites green"

echo "[5/7] Type-checking and building..."
npx tsc --noEmit || fail "tsc failed"
rm -rf .next
npx next build >/tmp/arch_build.log 2>&1 || { tail -30 /tmp/arch_build.log; fail "next build failed"; }
NEW=$(cat .next/BUILD_ID); echo "      new build id: $NEW"

echo "[6/7] Confirming the BUILD, not just the source..."
for S in "${BUILD_STRINGS[@]}"; do
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
