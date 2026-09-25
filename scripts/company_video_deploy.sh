#!/usr/bin/env bash
# PRODUCING COMPANY VIDEOS INSIDE SITECOMPLY.
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
ZIP=/tmp/company_video_deploy.zip
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
grep -qF "Where will the video come from?" "$INDEX" \
  || fail "creation no longer asks the question that decides everything else"
# The generated option IS available now. What must hold is that choosing it commits you
# to a source module, because a generated video with no wording cannot be produced.
grep -qF "setProvenanceChoice('GENERATED')" "$INDEX" \
  || fail "the generated option is not offered as a real choice"
grep -qF "draft.provenance === 'GENERATED' && !draft.moduleId" "$INDEX" \
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
echo "  ok   source asserts pass (50)"

if [ -z "$DRY" ]; then
  DB="$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='DATABASE_URL'].value" 2>/dev/null)"
  [ -n "$DB" ] || fail "could not read DATABASE_URL"
  export PGCONNECT_TIMEOUT=10
  FW_RULE=devvm-libiadeploy; FW_IP=144.6.132.237; FW_OPENED=""
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
for S in company_video_verify library_render_verify library_ia_verify library_pipeline_verify library_audiospec_verify \
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
npx next build >/tmp/libia_build.log 2>&1 || { tail -30 /tmp/libia_build.log; fail "next build failed"; }
NEW=$(cat .next/BUILD_ID); echo "      new build id: $NEW"

echo "[6/7] Confirming the BUILD, not just the source..."
for S in "Where will the video come from?" "Reusable company footage that every project" \
         "Where this video is used" "Company standards" "SiteComply produces it" \
         "Produce the video from this module"; do
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
