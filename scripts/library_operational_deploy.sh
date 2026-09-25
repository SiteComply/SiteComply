#!/usr/bin/env bash
# THE LIBRARY, MADE OPERATIONAL.
#
# NO MIGRATION. Every change is code; the library tables already exist.
#
# WHAT MUST BE TRUE:
#   ONE AUDIO SPEC   both encoders call audioEncodeArgs(). The join is `-c copy`
#                    and cannot reconcile two channel layouts - it mislabels the
#                    track instead of failing, which is why this needs an assert
#                    and not a code review.
#   ONE AUDIO STREAM the silent filler is an input only when the source has none.
#   THE QUEUE RUNS   attachUpload kicks, jobKicker drains normalise, and the tick
#                    does it in its own try.
#   NOTHING STICKS   the claim is atomic and a stale RUNNING job is reclaimed.
#   CEILINGS         a size and a duration, enforced against storage.
#   NO PRISMA IN     the editor value-imports libraryLimits and nothing else from
#   THE BROWSER      services/ - tsc cannot see this one.
#   CORS             the upload is browser-to-blob, so without a rule on the
#                    storage account nothing can be uploaded at all.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
ACCT=scdocsuk
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/library_operational_deploy.zip
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

FMT=services/inductionVideo/videoFormat.ts
NORM=services/inductionVideo/libraryNormaliser.ts
REND=services/inductionVideo/ffmpegRenderer.ts
SVC=services/inductionVideo/libraryAssetService.ts
KICK=services/inductionVideo/jobKicker.ts
TICK=app/api/system/compliance/tick/route.ts
LIM=services/inductionVideo/libraryLimits.ts
UI=components/inductionVideo/LibrarySection.tsx
STORE=services/inductionVideo/mediaStorage.ts

if [ -z "$DRY" ]; then
  echo "[1/7] Current prod build id:"
  PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
  [ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"
  echo "[2/7] Asserting a committed tree and no migration..."
  git diff --quiet HEAD -- prisma app components services lib scripts \
    || fail "there are uncommitted changes - the zip is the working tree"
  git diff --quiet HEAD~1 HEAD -- prisma/schema.prisma prisma/migrations \
    || fail "this deploy carries a schema change it claims not to"
  echo "  ok   tree committed, schema untouched"
else
  echo "DRY RUN: asserts only, nothing is built or deployed."
  PREV="(dry run)"
fi

echo "[3/7] Asserting the source, and the storage account..."
for f in "$FMT" "$NORM" "$REND" "$SVC" "$KICK" "$TICK" "$LIM" "$UI" "$STORE"; do
  test -f "$f" || fail "missing: $f"
done

# --- ONE AUDIO SPEC --------------------------------------------------------
grep -q "export const AUDIO_FORMAT" "$FMT" || fail "there is no shared audio spec"
grep -q "export function audioEncodeArgs" "$FMT" || fail "the shared encoder flags are gone"
grep -qF "'-ac', String(AUDIO_FORMAT.channels)" "$FMT" \
  || fail "the shared flags do not set -ac - a generated scene would inherit the narration's mono"
for f in "$NORM" "$REND"; do
  grep -q "audioEncodeArgs()" "$f" || fail "$f does not use the shared audio spec"
  grep -qE "'-ac', *'[0-9]'" "$f" \
    && fail "$f still hard-codes a channel count - that is how the two drifted"
done

# --- ONE AUDIO STREAM ------------------------------------------------------
grep -qF "probe.hasAudio ? [] : silentFiller" "$NORM" \
  || fail "the silent filler is not conditional - every real upload would get two audio tracks"
grep -qF "'-map', '0:a?'" "$NORM" \
  && fail "the optional source map is back alongside the mandatory filler map"
grep -q "hasAudio: boolean" "$NORM" || fail "the probe no longer reports whether there is audio"

# --- THE QUEUE RUNS -------------------------------------------------------
grep -q "kickInductionJobs();" "$SVC" || fail "attachUpload does not start the transcode"
grep -q "await kickInductionJobs" "$SVC" \
  && fail "the kick is awaited - a transcode would sit inside the operator's upload request"
grep -q "import { runQueuedNormaliseJobs }" "$KICK" \
  || fail "the kicker cannot drain normalise jobs"
grep -q "runQueuedNormaliseJobs(1)" "$KICK" || fail "the kicker does not drain normalise jobs"
python3 - <<'PYCHK' || fail "the tick drains the library queue inside the renders' try - one failing render would starve it"
s = open('app/api/system/compliance/tick/route.ts').read()
r = s.index('runQueuedRenderJobs()')
n = s.index('runQueuedNormaliseJobs(1)')
# There must be a catch BETWEEN them: separate try blocks, not one shared.
raise SystemExit(0 if 'catch' in s[r:n] else 1)
PYCHK

# --- NOTHING STICKS -------------------------------------------------------
grep -qF "where: { id: job.id, status: job.status, startedAt: job.startedAt }" "$SVC" \
  || fail "the normalise claim is not atomic - two passes could encode the same file"
grep -q "if (claimed.count === 0) continue;" "$SVC" || fail "a losing claim does not stand down"
grep -q "NORMALISE_STALE_AFTER_MS" "$SVC" || fail "there is no stale-job reclaim"
grep -qF "status: InductionVideoJobStatus.RUNNING, startedAt: { lt: staleBefore }" "$SVC" \
  || fail "an abandoned RUNNING job is invisible again - the revision would never finish"
grep -q "job.attempts + 1 > NORMALISE_MAX_ATTEMPTS" "$SVC" \
  || fail "the attempt ceiling is not read - a crash loop would be unbounded"
python3 - <<'PYCHK' || fail "the stale threshold is not longer than the ffmpeg timeout - a live encode could be stolen"
import re
s = open('services/inductionVideo/libraryAssetService.ts').read()
m = re.search(r'LIBRARY_NORMALISE_STALE_MS \?\? (\d+) \* 60 \* 1000', s)
raise SystemExit(0 if m and int(m.group(1)) > 15 else 1)
PYCHK

# --- CEILINGS, AND NO PRISMA IN THE BROWSER -------------------------------
grep -q "MAX_LIBRARY_VIDEO_BYTES" "$LIM" || fail "the size ceiling is gone"
grep -q "MAX_LIBRARY_VIDEO_MS" "$LIM" || fail "the duration ceiling is gone"
grep -qE "prisma|PrismaClient" "$LIM" \
  && fail "libraryLimits imports Prisma - the editor would ship it to the browser"
grep -qF "const props = await mediaProperties(input.blobPath)" "$SVC" \
  || fail "the upload is not verified against storage"
grep -q "sourceBytes: trueBytes" "$SVC" || fail "the recorded size is the browser's claim again"
grep -q "durationMs > MAX_LIBRARY_VIDEO_MS" "$SVC" || fail "the duration ceiling is not enforced"
grep -qF "file.size > MAX_LIBRARY_VIDEO_BYTES" "$UI" \
  || fail "the editor does not refuse a huge file before uploading it"
python3 - <<'PYCHK' || fail "the editor value-imports a service other than libraryLimits - Prisma would reach the browser"
import re
s = open('components/inductionVideo/LibrarySection.tsx').read()
bad = [l for l in re.findall(r"^import (?!type )\{[^}]*\} from '@/services/[^']+';$", s, re.M)
       if 'libraryLimits' not in l]
raise SystemExit(1 if bad else 0)
PYCHK

# --- STREAMING ------------------------------------------------------------
grep -q "export async function downloadMediaToFile" "$STORE" || fail "storage cannot stream to a file"
grep -q "export async function uploadMediaFromFile" "$STORE" || fail "storage cannot stream from a file"
grep -qF "downloadMediaToFile(rev.sourceBlobPath!, destination)" "$SVC" \
  || fail "the transcode still buffers the source"
grep -qF "uploadMediaFromFile(path, outputPath, 'video/mp4')" "$SVC" \
  || fail "the transcode still buffers the output"
grep -q "output: Buffer;" "$NORM" && fail "the normaliser returns the bytes again"
echo "  ok   source asserts pass (33)"

# --- CAN THE MIGRATION HISTORY REBUILD THE DATABASE? ----------------------
# It could not, for months, and nothing said so: five enums, five tables and three
# columns lived only in schema.prisma because the features that needed them were
# applied to production by hand. Production was fine; a new developer, a staging
# instance and a disaster-recovery rebuild were not. Repaired 2026-09-25; this
# keeps it repaired.
bash scripts/check_migration_drift.sh || fail "the migration history cannot rebuild the schema"


# --- THE STORAGE ACCOUNT ITSELF -------------------------------------------
# The upload is a browser PUT straight to blob storage. Without a CORS rule the
# preflight fails and NOTHING can be uploaded - the state this account was in
# until 2026-09-25, which no amount of correct code would have fixed.
CORS=$(az storage cors list --services b --account-name "$ACCT" -o json 2>/dev/null)
echo "$CORS" | grep -q '"AllowedMethods"' \
  || fail "no blob CORS rule on ${ACCT} - the browser cannot upload at all"
echo "$CORS" | grep -q 'PUT' || fail "the CORS rule does not allow PUT"
echo "$CORS" | grep -q 'x-ms-blob-type' \
  || fail "the CORS rule does not allow x-ms-blob-type, which every block-blob PUT sends"
for O in app.sitecomply.co.uk sitecomply-web.azurewebsites.net; do
  echo "$CORS" | grep -q "$O" || fail "the CORS rule does not allow https://$O"
done
echo "  ok   blob CORS allows the browser upload"
if [ -z "$DRY" ]; then
  FF=$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='FFMPEG_PATH'].name" 2>/dev/null)
  [ "$FF" = "FFMPEG_PATH" ] || fail "FFMPEG_PATH is not set on the App Service - every transcode would fail"
  SS=$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='SCHEDULER_SECRET'].name" 2>/dev/null)
  [ "$SS" = "SCHEDULER_SECRET" ] || fail "SCHEDULER_SECRET is not set - the hourly safety net is disabled"
  echo "  ok   FFMPEG_PATH and SCHEDULER_SECRET are set (names only; values not read)"
fi

if [ -n "$DRY" ]; then
  echo; echo "DRY RUN COMPLETE: ${DRY_FAILED:-0} assert(s) failed."
  exit $([ "${DRY_FAILED:-0}" = "0" ] && echo 0 || echo 1)
fi

echo "[4/7] Running the verification suites..."
export FFMPEG_PATH="$PWD/vendor/ffmpeg/ffmpeg"
for S in library_audiospec_verify library_pipeline_verify inductionvideo_library_verify \
         inductionvideo_verify inductionvideo_e2e_verify setup_video_readiness_verify \
         cpp_completion_verify site_rules_verify; do
  OUT=$(npx tsx "scripts/$S.ts" 2>&1) || { echo "$OUT" | tail -20; fail "$S failed"; }
  echo "$OUT" | grep -qE "(^| )0 failed" || { echo "$OUT" | tail -20; fail "$S did not report 0 failed"; }
  echo "  ok   $S: $(echo "$OUT" | grep -oE '[0-9]+ passed, 0 failed|0 failed' | tail -1)"
done
echo "  ok   suites green"

echo "[5/7] Type-checking and building..."
npx tsc --noEmit || fail "tsc failed"
rm -rf .next
npx next build >/tmp/library_build.log 2>&1 || { tail -30 /tmp/library_build.log; fail "next build failed"; }
NEW=$(cat .next/BUILD_ID); echo "      new build id: $NEW"

echo "[6/7] Confirming the BUILD, not just the source..."
grep -rqF "export it at a lower bitrate" .next 2>/dev/null \
  || fail "the size-limit message is not in the build - the editor guard did not compile"
# THE PRISMA CHECK, AND WHY IT IS NOT A grep OF .next/static.
#
# It was `grep PrismaClient .next/static`, and that failed this deploy on a false
# positive: what it found was Prisma's own BROWSER STUB, the 88 KB module whose
# whole job is to throw "PrismaClientKnownRequestError is unable to run in this
# browser". That stub has been in the client bundle for a long time, pulled in by
# pre-existing components whose helper modules import Prisma ENUMS, and it cannot
# connect to anything. The string cannot tell it apart from a real leak.
#
# What actually matters is narrower: no client component may reach the
# INSTANTIATED client at @/lib/prisma through a chain of value imports. That is
# checked at source, transitively, by the script below, and it is the mistake tsc
# cannot see, because a type-only import is erased and a value import is not.
python3 scripts/check_client_prisma_leak.py \
  || fail "a client component value-imports the Prisma CLIENT - it would ship to the browser"
echo "  ok   the editor guard shipped and no client component reaches the Prisma client"

echo "[7/7] Packaging, deploying, cutting over..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*' 2>/dev/null || true
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
# A non-zero exit here is a signal to LOOK, not a verdict: az has returned 504
# while Kudu carried on and production cut over minutes later. Retrying would race
# a live deployment.
if ! az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --async false; then
  echo "      the CLI returned non-zero - waiting up to 10 minutes for the cutover"
  CUT=""
  for _ in $(seq 1 20); do
    [ "$(served_buildid)" = "$NEW" ] && { CUT=yes; break; }
    sleep 30
  done
  [ -n "$CUT" ] || fail "production never cut over to $NEW - check the deployments endpoint before redeploying"
  echo "      it cut over on its own - the 504 was the CLI, not the deployment"
fi
for i in $(seq 1 10); do
  H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$HEALTH" 2>/dev/null)
  echo "      [$i] health: HTTP $H"
  [ "$H" = "200" ] && break
  sleep 20
done
SERVED=$(served_buildid); echo "      served build id: $SERVED"
[ "$SERVED" = "$NEW" ] || fail "prod is serving $SERVED, not $NEW"
echo "      route smoke test:"
for R in / /platform/dashboard/induction-videos/library /admin/induction-videos/library; do
  echo "        $R -> HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "${BASE}${R}")"
done
echo
echo "DEPLOYED: $PREV -> $NEW"
