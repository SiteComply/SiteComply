#!/usr/bin/env bash
# SC-017 FOLLOW-UP — production CODE deploy.
#
#   1. The annotation link is finally recorded (both evidence routes imported
#      parseAnnotationMeta and never called it).
#   2. An annotated photo's original is superseded: retained, but out of normal
#      viewing and out of the close-out pack, its share link and its ZIP.
#   3. Photos can be added and annotated while a finding is being written.
#
# CODE ONLY: no schema change, no migration, no seed, no backfill. Historical
# pairs are deliberately left alone — they have no stored link and guessing at
# one after the fact would be guesswork about audit evidence.
#
# Rollback is a redeploy of the previous commit; nothing here is destructive.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply

RG=rgSiteComply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sc017followup_deploy.zip
FIND_ROUTE='app/api/platform/audit-findings/[findingId]/evidence/route.ts'
ACT_ROUTE='app/api/platform/actions/[id]/evidence/route.ts'
GALLERY=components/platform/EvidenceGallery.tsx
PANEL=components/platform/AuditFindingsPanel.tsx

kudu_buildid() {
  local tok
  tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" \
    "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'
}

echo "== SC-017 FOLLOW-UP — CODE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/8] Current prod build id:"
OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] Asserting the fix, and the things it must not have changed..."

# THE ROOT CAUSE. Importing the parser and never calling it is exactly how this
# shipped broken for months, so the assertion is on the CALL, with comments
# stripped — the explaining comment names the function, and a plain grep would
# match the prose and pass while the call was missing again.
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
for(const [f,fn] of [['$FIND_ROUTE','addFindingEvidence'],['$ACT_ROUTE','addActionEvidence']]){
  const s=strip(f);
  if(!/parseAnnotationMeta\(\s*form\s*\)/.test(s)){
    console.error('ERROR: '+f+' does not CALL parseAnnotationMeta — the annotation link would go unrecorded again');process.exit(1);
  }
  // and the parsed value must actually reach the service.
  const call=s.slice(s.indexOf(fn+'('));
  if(!/annotation\s*,?\s*\)/.test(call.slice(0,400))){
    console.error('ERROR: '+f+' parses the annotation but never passes it to '+fn);process.exit(1);
  }
}
console.log('      confirmed: both evidence routes record the annotation link.');
" || exit 1

# The rule that decides which photo IS the evidence, and its checks.
[ -f services/annotations/supersededEvidence.ts ] \
  && [ -f services/annotations/supersededEvidenceQuery.ts ] \
  || { echo "ERROR: the superseded-original rule is missing — aborting"; exit 1; }
npx tsx --tsconfig scripts/tsconfig.navcheck.json scripts/sc017followup_check.ts >/dev/null 2>&1 \
  || { echo "ERROR: superseded-original rule checks failed — aborting"; exit 1; }

# Both galleries must be handed the tag, or the original quietly reappears.
grep -q 'markSuperseded' services/audits/findingEvidenceService.ts \
  && grep -q 'markSuperseded' services/actions/actionEvidenceService.ts \
  || { echo "ERROR: an evidence service stopped tagging superseded originals — aborting"; exit 1; }

# REPORTING. All three pack surfaces must exclude superseded originals, and must
# do it in the query — after the PHOTO_LIMIT cap it would silently shrink packs.
node -e "
const fs=require('fs');
for(const f of ['services/closeOut/closeOutService.ts','services/closeOut/closeOutArchive.ts']){
  const s=fs.readFileSync(f,'utf8');
  const uses=(s.match(/excludeIds\(/g)||[]).length;
  const want=f.endsWith('closeOutService.ts')?4:2; // count + list, two tables each
  if(uses<want){console.error('ERROR: '+f+' has '+uses+' exclusions, expected at least '+want);process.exit(1);}
}
console.log('      confirmed: pack count, printed list and ZIP all exclude superseded originals.');
" || exit 1

# PRESENTATION. The annotated photo is what is shown; the original stays reachable
# behind a disclosure rather than being deleted or dropped from the record.
grep -qF 'Original photo (kept for audit)' "$GALLERY" \
  || { echo "ERROR: the original is no longer reachable for audit — aborting"; exit 1; }
grep -qF 'item={g.annotated ?? g.original}' "$GALLERY" \
  || { echo "ERROR: the gallery is not presenting the annotated photo as the evidence — aborting"; exit 1; }

# THE SINGLE WORKFLOW, and its ordering: the finding must exist before anything
# is attached, or an abandoned form leaves orphaned evidence.
grep -q '<PendingPhotos' "$PANEL" \
  || { echo "ERROR: photos can no longer be added while creating a finding — aborting"; exit 1; }
node -e "
const s=require('fs').readFileSync('$PANEL','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const created=s.indexOf('const findingId = data.id');
const upload=s.indexOf('uploadAnnotatedPair(');
if(created<0||upload<0||created>upload){console.error('ERROR: evidence is no longer uploaded after the finding is created');process.exit(1);}
" || exit 1

# NOTHING IS DELETED. The follow-up hides an original; it must never remove one.
#
# Asserted STRUCTURALLY, not by scanning for words like "delete": the module's
# own documentation explains what happens when someone deletes the annotated
# copy, so a word blacklist matches the explanation and fails a correct file.
# It did exactly that while this script was being written — the third time this
# repo has been bitten by an assertion matching its own prose. A pure module
# with no database client cannot delete anything, and that is checkable without
# reading a single sentence.
node -e "
const s=require('fs').readFileSync('services/annotations/supersededEvidence.ts','utf8');
if(/from '@\/lib\/prisma'|@prisma\/client/.test(s)){
  console.error('ERROR: the superseded rule now has a database client — it must stay a pure tagging rule');process.exit(1);
}
const exported=[...s.matchAll(/export function (\w+)/g)].map(m=>m[1]).sort().join(',');
if(exported!=='markSuperseded,supersededOriginalIds'){
  console.error('ERROR: the superseded rule exports changed: '+exported);process.exit(1);
}
" || exit 1
# THE ANNOTATOR MUST HAVE A PAINTABLE IMAGE BEFORE IT DRAWS.
#
# `onload` means the bytes arrived, not that a frame exists to paint. Revoking
# the object URL at that moment is a pattern WebKit is known to fail on, and
# `drawImage` does not throw when it has nothing to paint — it draws nothing, so
# the annotator opens blank AND Save flattens that blank canvas into the stored
# evidence photo. Order asserted on code with comments stripped: decode first,
# revoke last.
node -e "
const raw=require('fs').readFileSync('lib/imagePrep.ts','utf8');
const s=raw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const decode=s.indexOf('image.decode()');
const revoke=s.indexOf('revokeObjectURL');
if(decode<0){console.error('ERROR: loadImage no longer waits for the image to decode — aborting');process.exit(1);}
if(revoke<0||revoke<decode){console.error('ERROR: the object URL is revoked before the image is decoded — aborting');process.exit(1);}
if(/onload\s*=\s*\(\)\s*=>\s*\{[^}]*revokeObjectURL/.test(s)){
  console.error('ERROR: the URL is being revoked inside onload again — aborting');process.exit(1);
}
" || exit 1
# Save must refuse an image with no frame rather than store a blank photo.
grep -qF 'The photo is still loading. Please try again in a moment.' components/platform/PhotoAnnotator.tsx \
  || { echo "ERROR: the annotator would save an unpainted photo — aborting"; exit 1; }

# AN ANNOTATED PHOTO IS EXPORTED AS JPEG, WHICH HAS NO ALPHA.
#
# A part-transparent PNG — a screenshot, an exported diagram — drawn onto a bare
# canvas leaves those pixels transparent, and JPEG encodes transparent as BLACK.
# It looked correct while editing, because the light panel behind the canvas
# showed through, and saved as a black image. Both the editor and the export must
# paint an opaque backdrop first, from the SAME function, or the two drift apart
# again and the screen stops telling the truth about the file.
node -e "
const fs=require('fs');
const strip=(f)=>fs.readFileSync(f,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*\$/gm,'');
const render=strip('lib/annotationRender.ts');
if(!/export function drawPhoto/.test(render)){
  console.error('ERROR: the shared photo backdrop helper is gone — aborting');process.exit(1);}
if(!/fillRect\(0, 0, width, height\)/.test(render)){
  console.error('ERROR: drawPhoto no longer paints an opaque backdrop — a transparent PNG would save black');process.exit(1);}
// flatten must go through it, not draw the image bare.
const flat=render.slice(render.indexOf('export function flatten'));
if(!/drawPhoto\(ctx, image, width, height\)/.test(flat)){
  console.error('ERROR: flatten no longer paints the backdrop — saved photos would be black');process.exit(1);}
if(/ctx\.drawImage\(image, 0, 0, width, height\)/.test(flat)){
  console.error('ERROR: flatten draws the image bare again, bypassing the backdrop');process.exit(1);}
// and the editor must use the same helper, so preview matches the file.
const annot=strip('components/platform/PhotoAnnotator.tsx');
if(!/drawPhoto\(ctx, image, width, height\)/.test(annot)){
  console.error('ERROR: the editor no longer previews what will be saved');process.exit(1);}
" || exit 1
echo "      confirmed: link recorded, rule + checks present, pack de-duplicated,"
echo "                 original retained and reachable, nothing deleted,"
echo "                 image decoded before the URL is revoked, blank saves refused."

echo "[3/8] Generating Prisma client..."
npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."
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

echo "== DEPLOY SUMMARY =="
echo "   old build: ${OLD_BUILD:-<unknown>}"
echo "   new build: ${NEW_BUILD}"
echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== SC-017 FOLLOW-UP DEPLOYED ==" || echo "== HEALTH NOT 200 — investigate =="
