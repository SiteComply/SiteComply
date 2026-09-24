#!/usr/bin/env bash
# INDUCTION VIDEOS, PHASE 2 (SPEECH) — narration, captions, transcript, private
# media and range-served playback.
#
# MIGRATION FIRST. This build reads seven new columns and two new statuses; the
# pre-flight refuses to deploy against a database that lacks them, and refuses
# equally when it cannot ask. Run ~/induction_narration_run.sh first.
#
# THE FEATURE IS INERT WITHOUT A SPEECH RESOURCE. With SPEECH_KEY unset the
# version page says narration is not configured and nothing else changes - but a
# deploy that MEANT to enable it and forgot the setting would look identical, so
# the settings are asserted rather than assumed.
#
# NOTHING RUNS ON ITS OWN. Narration is queued by a manager and drained by the
# existing scheduler tick; there is no second worker and no automatic spend.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
BASE="https://${APP}.azurewebsites.net"
HEALTH="${BASE}/api/health"
ZIP=/tmp/inductionspeech_deploy.zip

fail() { echo "  FAIL $1"; exit 1; }
served_buildid() {
  curl -s --max-time 25 "${BASE}/" 2>/dev/null \
    | grep -o 'buildId\\":\\"[^\\]*' | head -1 | sed 's/.*buildId\\":\\"//'
}

echo "[1/8] Current prod build id:"
PREV=$(served_buildid); echo "      ${PREV:-<unreadable>}"
[ -n "$PREV" ] || fail "cannot read the current prod build id - refusing to deploy blind"

echo "[2/8] Asserting a committed tree..."
git diff --quiet HEAD -- prisma/schema.prisma app components services lib scripts \
  || fail "there are uncommitted changes - the zip is the working tree, so deploy what is committed"
echo "  ok   tree committed"

echo "[3/8] Asserting the migration and the speech settings are in PRODUCTION..."
DB="$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[?name=='DATABASE_URL'].value" 2>/dev/null)"
[ -n "$DB" ] || fail "could not read DATABASE_URL"
COLS=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('InductionVideo','InductionVideoScene') AND column_name IN ('voice','narrationAt','narrationDurationMs','narrationHash','captionsBlobPath','transcriptBlobPath','audioHash')" 2>/dev/null)
LABELS=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -c "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='InductionVideoStatus' AND e.enumlabel IN ('NARRATION_GENERATING','NARRATION_READY')" 2>/dev/null)
[ -n "$COLS" ] && [ -n "$LABELS" ] || fail "could not check the production schema (firewall rule?) - refusing to deploy blind"
[ "$COLS" = "7" ] || fail "production has $COLS of the 7 narration columns - run ~/induction_narration_run.sh first"
[ "$LABELS" = "2" ] || fail "production is missing the narration statuses - run ~/induction_narration_run.sh first"
echo "  ok   production has all seven columns and both statuses"

SETTINGS=$(az webapp config appsettings list -g "$RG" -n "$APP" -o tsv --query "[].name" 2>/dev/null)
for s in SPEECH_KEY SPEECH_REGION; do
  echo "$SETTINGS" | grep -qx "$s" || fail "app setting $s is not set - narration would ship inert"
done
echo "  ok   the speech settings are present"

echo "[4/8] Asserting the source invariants..."
grep -q "escapeXml(text.trim()" services/inductionVideo/speechSynthesiser.ts \
  || fail "narration is no longer escaped before it enters the SSML document"
grep -q "Only an approved script can be narrated" services/inductionVideo/narrationService.ts \
  || fail "narration no longer requires an approved script"
grep -q "await ports.exists(path)" services/inductionVideo/narrationService.ts \
  || fail "audio reuse no longer checks that the blob exists"
grep -q "speechChars: charsBilled" services/inductionVideo/narrationService.ts \
  || fail "the narration spend is no longer recorded"
grep -q "buildVtt(captionScenes)" services/inductionVideo/narrationService.ts \
  || fail "captions are no longer built with the narration"
grep -q "runQueuedNarrationJobs()" app/api/system/compliance/tick/route.ts \
  || fail "narration jobs are not drained by the scheduler"
grep -q "audioHash: null," services/inductionVideo/inductionVideoService.ts \
  || fail "editing a scene no longer clears its audio"
grep -q "'Accept-Ranges': 'bytes'" services/inductionVideo/mediaResponse.ts \
  || fail "media is no longer range-served"
grep -q "MAX_SAS_MINUTES = 120" services/inductionVideo/mediaStorage.ts \
  || fail "the SAS lifetime cap changed"
grep -qE "access:\s*'(blob|container)'" services/inductionVideo/mediaStorage.ts \
  && fail "the media container would be created with PUBLIC access"
grep -q "height: 1920" services/inductionVideo/videoFormat.ts \
  || fail "portrait is no longer the primary format"
# Phase 1's own guarantees, still standing.
grep -q "canGenerate: missing.length === 0," services/inductionVideo/sceneRules.ts \
  || fail "missing information no longer blocks generation"
grep -q "runQueuedScriptJobs()" app/api/system/compliance/tick/route.ts \
  || fail "script jobs are not drained by the scheduler"
echo "  ok   source asserts pass"

echo "[5/8] Running the verification suites..."
# Output is CAPTURED before it is checked: piping into `grep -q` closes the pipe
# and a suite still logging its cleanup dies of EPIPE, which reads as a failure.
suite() {  # suite <script> <pattern>
  local out; out=$(npx tsx "scripts/$1.ts" 2>&1)
  echo "$out" | grep -qE "$2" || { echo "$out" | tail -15; fail "$1 has failures"; }
  echo "  ok   $1: $(echo "$out" | grep -oE '([0-9]+ passed, )?0 failed' | tail -1)"
}
# THIS PHASE'S OWN SUITES FIRST. Two earlier deploys silently omitted the suite
# for the very feature they were shipping; they go at the top where an omission
# is obvious.
suite inductionvideo_speech_verify "== [0-9]+ passed, 0 failed =="
suite inductionvideo_speech_e2e    "0 failed"
suite inductionvideo_verify        "== [0-9]+ passed, 0 failed =="
suite inductionvideo_e2e_verify    "0 failed"
suite permits_default_verify       "== [0-9]+ passed, 0 failed =="
suite rams_company_verify          "== [0-9]+ passed, 0 failed =="
suite induction_briefing_verify    ", 0 failed"
suite accesswindow_visibility_verify "== [0-9]+ passed, 0 failed =="
suite cscs_scheme_notlisted_verify "== [0-9]+ passed, 0 failed =="
suite worker_name_verify           ", 0 failed"
suite inviteflow_verify            "== [0-9]+ passed, 0 failed =="
suite smartcheck_mapping_verify    ", 0 failed"
suite smartcheck_auth_verify       "== [0-9]+ passed, 0 failed =="
echo "  ok   suites green"
echo "      (scripts/inductionvideo_speech_live.ts is NOT in this gate: it calls"
echo "       Azure Speech for real and costs money. Run it by hand when the"
echo "       speech resource or the voice changes.)"

echo "[6/8] Type-checking and building..."
npx prisma generate >/dev/null 2>&1 || fail "prisma generate failed"
npx tsc --noEmit || fail "typecheck failed"
npx next build >/tmp/inductionspeech_build.log 2>&1 || {
  tail -30 /tmp/inductionspeech_build.log; fail "build failed";
}
NEW_BUILD=$(cat .next/BUILD_ID)
echo "      new build id: ${NEW_BUILD}"
[ "$NEW_BUILD" != "$PREV" ] || fail "new build id equals the deployed one"

echo "[7/8] Confirming the BUILD, not just the source..."
for t in "Generate narration" "Download the transcript" "Subtitles (WebVTT)" "Narration is not configured on this deployment" "being narrated" "Induction videos" "Approve script"; do
  grep -rqF "$t" .next/server 2>/dev/null || fail "missing from the build: $t"
done
grep -rqF "Generate narration" .next/static 2>/dev/null \
  || fail "the narration panel is not in the client bundle"
for r in "app/api/platform/induction-video/[videoId]/audio/[sceneId]/route.js" \
         "app/api/platform/induction-video/[videoId]/captions/route.js" \
         "app/api/platform/induction-video/[videoId]/transcript/route.js"; do
  test -f ".next/server/$r" || fail "the media route did not build: $r"
done
echo "  ok   the narration panel, the media routes and the earlier work are in the build"

echo "[8/8] Packaging, deploying, cutting over..."
rm -f "$ZIP"
zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

sleep 60
az webapp stop  -g "$RG" -n "$APP" -o none
az webapp start -g "$RG" -n "$APP" -o none
CODE=""
for i in $(seq 1 24); do
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

echo "      the media routes must be GATED, not broken (401/403/404 expected):"
for p in "audio/x" "captions" "transcript"; do
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 \
        "${BASE}/api/platform/induction-video/x/${p}" || echo 000)
  echo "        /api/platform/induction-video/x/${p} -> HTTP ${C}"
  case "$C" in 401|403|404) ;; *) fail "the media route returned ${C}, expected 401/403/404" ;; esac
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
