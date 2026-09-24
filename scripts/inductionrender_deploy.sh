#!/usr/bin/env bash
# INDUCTION VIDEOS, PHASE 3 — rendering, publication, operative playback,
# completion records, retention, spend cap and immediate job starts.
#
# MIGRATION FIRST (~/induction_render_run.sh). This build reads six new columns,
# one new table and one new site flag.
#
# IT SHIPS ITS OWN ENCODER. Rendering needs an ffmpeg binary with libass; the
# App Service image has none, so a static build is vendored into the package.
# It is NOT in git - the script fetches it and verifies it before packaging, so
# the repository stays a repository.
#
# EVERYTHING ELSE STILL WORKS WITHOUT IT. With FFMPEG_PATH unset the version page
# says rendering is unavailable and the script, narration, captions and
# transcript are untouched.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/inductionrender_deploy.zip
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
VENDOR=vendor/ffmpeg

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/9] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/9] Asserting a committed tree..."
git diff --quiet HEAD -- prisma/schema.prisma app components services lib scripts \
  || fail "there are uncommitted changes - the zip is the working tree"
echo "  ok   tree committed"

echo "[3/9] Asserting the migration is in PRODUCTION..."
DB="$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='DATABASE_URL'].value" 2>/dev/null)"
[ -n "$DB" ] || fail "could not read DATABASE_URL"
COLS=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name='InductionVideo' AND column_name IN ('videoBlobPath','videoDurationMs','videoSizeBytes','renderEngine','renderedAt','renderHash')" 2>/dev/null)
VIEWS=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT to_regclass('\"InductionVideoView\"') IS NOT NULL" 2>/dev/null)
FLAG=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name='SiteInductionConfig' AND column_name='inductionVideoRequired'" 2>/dev/null)
[ -n "$COLS" ] && [ -n "$VIEWS" ] && [ -n "$FLAG" ] || fail "could not check the production schema (firewall rule?) - refusing to deploy blind"
[ "$COLS" = "6" ] || fail "production has $COLS of the 6 render columns - run ~/induction_render_run.sh first"
[ "$VIEWS" = "t" ] || fail "production has no InductionVideoView table - run ~/induction_render_run.sh first"
[ "$FLAG" = "1" ] || fail "production has no inductionVideoRequired flag - run ~/induction_render_run.sh first"
echo "  ok   production has the render columns, the view table and the site flag"

echo "[4/9] Asserting the source invariants..."
grep -q "if (!wrapped) continue; // too long for the frame: left to the voice" services/inductionVideo/sceneVisual.ts \
  || fail "a sentence too long for the frame is no longer left whole to the voice"
grep -q "\[{}\]/g, '('" services/inductionVideo/assDocument.ts \
  || fail "narration is no longer escaped before it enters the text layer"
grep -q "Only a rendered version can be published" services/inductionVideo/renderService.ts \
  || fail "publication no longer requires a rendered version"
grep -q "may publish an induction video" services/inductionVideo/renderService.ts \
  || fail "publication is no longer restricted to Directors and Site Managers"
grep -q "Render it again first" services/inductionVideo/renderService.ts \
  || fail "a stale render can now be published"
grep -q "Math.max(existing?.furthestMs ?? 0, position)" services/inductionVideo/operativeVideoService.ts \
  || fail "watching progress can now go backwards"
grep -q "views: { none: {} }" services/inductionVideo/retentionService.ts \
  || fail "retention can now remove a video somebody watched"
grep -q "status: { not: InductionVideoStatus.PUBLISHED }" services/inductionVideo/retentionService.ts \
  || fail "retention can now remove a published video"
grep -q "refuseIfOverBudget" services/inductionVideo/renderService.ts \
  || fail "rendering no longer answers to the daily cap"
grep -q "publishedVideoForSite(params.siteId)" "app/api/worker/induction-video/[siteId]/stream/route.ts" \
  || fail "an operative's stream is no longer resolved from the site"
echo "  ok   source asserts pass"

echo "[5/9] Vendoring the encoder..."
if [ ! -x "${VENDOR}/ffmpeg" ]; then
  mkdir -p "$VENDOR"
  echo "      fetching a static build (about 40 MB)…"
  curl -sL --max-time 600 -o /tmp/ffmpeg-static.tar.xz "$FFMPEG_URL" || fail "could not download ffmpeg"
  tar -xf /tmp/ffmpeg-static.tar.xz -C /tmp || fail "could not unpack ffmpeg"
  SRC=$(ls -d /tmp/ffmpeg-*-amd64-static | tail -1)
  cp "${SRC}/ffmpeg" "${SRC}/ffprobe" "$VENDOR/" || fail "could not vendor ffmpeg"
  chmod +x "${VENDOR}/ffmpeg" "${VENDOR}/ffprobe"
fi
# CAPTURE, THEN CHECK. Piping into `grep -q` closes the pipe at the first match,
# ffmpeg dies of SIGPIPE, and `pipefail` reports the whole pipeline as failed -
# so a perfectly good binary read as "no libass". The same trap that once made a
# passing test suite look like a failing one; the same fix.
FILTERS=$("${VENDOR}/ffmpeg" -hide_banner -filters 2>/dev/null)
echo "$FILTERS" | grep -qw ass \
  || fail "the vendored ffmpeg has no libass - the frames would have no text"
VER=$("${VENDOR}/ffmpeg" -hide_banner -version 2>/dev/null | head -1)
echo "  ok   $(du -sh "$VENDOR" | cut -f1) vendored, with libass — ${VER}"

echo "[6/9] Running the verification suites..."
# THE SUITES RENDER WITH THE BINARY THIS DEPLOY IS ABOUT TO SHIP, not with
# whatever happens to be on the developer's PATH. If the vendored encoder cannot
# produce a video here, it will not produce one in production either, and the
# end-to-end suite is the place to find that out.
export FFMPEG_PATH="${PWD}/${VENDOR}/ffmpeg"
suite() {  # suite <script> <pattern>
  local out; out=$(npx tsx "scripts/$1.ts" 2>&1)
  echo "$out" | grep -qE "$2" || { echo "$out" | tail -15; fail "$1 has failures"; }
  echo "  ok   $1: $(echo "$out" | grep -oE '([0-9]+ passed, )?0 failed' | tail -1)"
}
# This phase's own suites first, where an omission is obvious.
suite inductionvideo_render_verify  "== [0-9]+ passed, 0 failed =="
suite inductionvideo_render_e2e     "0 failed"
suite inductionvideo_speech_verify  "== [0-9]+ passed, 0 failed =="
suite inductionvideo_speech_e2e     "0 failed"
suite inductionvideo_verify         "== [0-9]+ passed, 0 failed =="
suite inductionvideo_e2e_verify     "0 failed"
suite induction_grouping_verify     "== [0-9]+ passed, 0 failed =="
suite induction_briefing_verify     ", 0 failed"
suite permits_default_verify        "== [0-9]+ passed, 0 failed =="
suite rams_company_verify           "== [0-9]+ passed, 0 failed =="
suite accesswindow_visibility_verify "== [0-9]+ passed, 0 failed =="
suite worker_name_verify            ", 0 failed"
suite inviteflow_verify             "== [0-9]+ passed, 0 failed =="
suite smartcheck_mapping_verify     ", 0 failed"
echo "  ok   suites green"

echo "[7/9] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/inductionrender_build.log 2>&1 || {
  tail -30 /tmp/inductionrender_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[8/9] Confirming the BUILD, not just the source..."
for t in "Publish to operatives" "Render video" "Your site induction" "Read it instead" \
         "Require the induction video to be watched" "Who has watched this version" \
         "Generate narration" "Induction videos"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "Publish to operatives" .next/static 2>/dev/null || fail "the render panel is not in the client bundle"
grep -rqF "Read it instead" .next/static 2>/dev/null || fail "the operative's player is not in the client bundle"
for r in "app/api/worker/induction-video/[siteId]/stream/route.js" \
         "app/api/worker/induction-video/[siteId]/progress/route.js" \
         "app/api/worker/induction-video/[siteId]/captions/route.js" \
         "app/api/platform/induction-video/[videoId]/video/route.js"; do
  test -f ".next/server/$r" || fail "route did not build: $r"
done
echo "  ok   the render panel, the player, the site flag and the media routes are in the build"

echo "[9/9] Packaging, deploying, cutting over..."
rm -f "$ZIP"
# vendor/ IS included: it is the encoder. scripts/ is not - it never runs in prod.
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

sleep 60
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 30); do
  sleep 15
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"
  [ "$CODE" = "200" ] && break
done
[ "$CODE" = "200" ] || fail "health never returned 200"

SERVED=""
for i in $(seq 1 10); do
  SERVED=$(served_buildid); echo "      served build id: ${SERVED:-<unreadable>}"
  [ "$SERVED" = "$NEW_BUILD" ] && break
  sleep 15
done
[ "$SERVED" = "$NEW_BUILD" ] || fail "prod is serving ${SERVED:-<unreadable>}, not ${NEW_BUILD}"

echo "      the operative's media routes must be GATED, not broken:"
for p in "stream" "captions" "progress"; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "${BASE}/api/worker/induction-video/x/${p}" || echo 000)
  echo "        /api/worker/induction-video/x/${p} -> HTTP ${C}"
  case "$C" in 401|403|404|405) ;; *) fail "returned ${C}, expected 401/403/404/405" ;; esac
done

echo "      route smoke test (3xx = correctly gated, 5xx = broken):"
SMOKE_FAIL=""
for path in / /check-in /platform/dashboard/sites /platform/dashboard/induction-videos /worker/dashboard ; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo 000)
  echo "        ${path} -> HTTP ${C}"
  case "$C" in 5*|000) SMOKE_FAIL=yes ;; esac
done
[ -z "$SMOKE_FAIL" ] || fail "a route returned 5xx on the new build"

echo
echo "DEPLOYED: ${PREV} -> ${NEW_BUILD}"
echo "Set FFMPEG_PATH=/home/site/wwwroot/vendor/ffmpeg/ffmpeg to enable rendering."
