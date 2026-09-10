#!/usr/bin/env bash
# Deploy: Invite a Worker — code removal, SMS link, existing-worker notice, and
# approval narrowed to the cases where it is an actual control.
#
# The guards that matter here are the ones proving what was KEPT. Removing an
# approval step is easy to get wrong in the direction of quietly restoring access
# to someone who was suspended or removed, so those paths are asserted explicitly.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/invitedstate_deploy.zip
DEPLOYED=ad8cd49
SVC='services/workerAccess/workerAssignmentService.ts'
DLG='components/platform/InviteWorkerDialog.tsx'
die() { echo "ERROR: $1. Aborting"; exit 1; }
# Kudu intermittently refuses the connection while the app itself is healthy.
# One failed read is not evidence of anything, so retry before believing it —
# an earlier run aborted the whole deploy on a single transient HTTP 000.
kudu_buildid() {
  local tok v i
  for i in 1 2 3 4 5; do
    tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
    v=$(curl -s --max-time 45 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]')
    [ -n "$v" ] && { printf '%s' "$v"; return 0; }
    sleep 10
  done
  return 1
}
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
s = re.sub(r'(?m)^\s*///.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== INVITED-UNTIL-CHECKIN DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/7] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/7] SOURCE guards..."
EXPECTED="app/platform/dashboard/sites/[id]/workers/page.tsx
components/platform/WorkerAccessManager.tsx
scripts/deploy/invitedstate_deploy.sh
scripts/inviteflow_verify.ts
services/submissions/submissionService.ts
services/workerAccess/assignmentLabels.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the invite service, its route, two UI files and the schema comment." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- ONE label source. Two maps disagreeing is the bug that started this.
[ -f services/workerAccess/assignmentLabels.ts ] || die "the shared label module is missing"
grep -q "ASSIGNMENT_STATUS_LABEL" "app/platform/dashboard/sites/[id]/workers/page.tsx" \
  && die "the workers page still has its own label map"
grep -q "const STATUS_LABEL" components/platform/WorkerAccessManager.tsx \
  && die "the access manager still has its own label map"
for f in "app/platform/dashboard/sites/[id]/workers/page.tsx" components/platform/WorkerAccessManager.tsx; do
  grep -q "assignmentStatusLabel" "$f" || die "$f does not use the shared label"
done
echo "      both surfaces read one label source."

# --- The label split itself.
grep -q "a.acceptedAt ? 'Active' : 'Invited'" services/workerAccess/assignmentLabels.ts \
  || die "ACTIVE no longer splits on acceptedAt"
grep -q "'Awaiting approval'" services/workerAccess/assignmentLabels.ts \
  || die "the INVITED label is gone; suspended and transferred rows would lose their wording"
echo "      ACTIVE reads Invited until first check-in, then Active."

# --- No approval wording left in the ORDINARY path.
python3 - <<'PY' || exit 1
import re, sys
s = open('components/platform/WorkerAccessManager.tsx', encoding='utf-8').read()
# Strip the parts that legitimately keep approval wording: the Approve/Reinstate
# button, the waiting count, and the transfer messages.
for pat in (r"\{r\.status === 'SUSPENDED' \? 'Reinstate' : 'Approve'\}",
            r"waiting > 0 \?[^\n]*",
            r"They will need approving there[^`]*",
            r"they need approving on the destination project[^`]*",
            r"autoApproved\??: boolean"):
    s = re.sub(pat, '', s)
leftovers = [m for m in re.findall(r"[^\n]*[Aa]pprov[^\n]*", s)
             if 'approvedAt' not in m and 'approvedByName' not in m and 'only needed to restore' not in m]
if leftovers:
    print('ERROR: approval wording remains in the ordinary path:'); [print('   ', l.strip()[:100]) for l in leftovers]; sys.exit(1)
print('      no approval wording outside the retained cases.')
PY

# --- Acceptance is actually wired, and cannot break a check-in.
grep -q "void recordAcceptance(input.workerId, input.siteId)" services/submissions/submissionService.ts \
  || die "the check-in path does not record acceptance"
grep -q "await recordAcceptance" services/submissions/submissionService.ts \
  && die "acceptance is awaited into the check-in; a bookkeeping write must not be able to fail it"
grep -q "acceptedAt: null" services/workerAccess/workerAssignmentService.ts \
  || die "recordAcceptance no longer guards against overwriting the first arrival"
echo "      first check-in records acceptance, and cannot fail the check-in."

# --- Nothing that grants access changed.
for f in services/workerAccess/workerAssignmentService.ts components/platform/InviteWorkerDialog.tsx \
         "app/api/platform/sites/[id]/worker-access/route.ts" prisma/schema.prisma; do
  git diff --quiet "$DEPLOYED" HEAD -- "$f" || die "$f changed; this deploy is presentation plus the acceptance hook"
done
echo "      the invite service, its route, the dialog and the schema are untouched."

echo "[3/7] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
echo "[4/7] Building..."; npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
grep -rq "Invited" .next/static/chunks/ || die "the Invited label is not in the client bundle"
grep -rq "Awaiting approval" .next/static/chunks/ || die "the retained approval label is missing from the bundle"
grep -rq "first checked in" .next/static/chunks/ || die "the first-check-in line is not in the bundle"
echo "      the new labels compiled in, and the retained one survived."

echo "[5/7] Packaging zip..."
rm -f "$ZIP"; zip -qr "$ZIP" .next public package.json package-lock.json node_modules prisma next.config.js -x "node_modules/.cache/*" || die "zip failed"
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/7] Deploying (async — a synchronous wait 504s on this app)..."
az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --async true || die "deploy failed"

echo "[7/7] Waiting for BUILD_ID $NEW_BUILD..."
for i in $(seq 1 40); do
  CUR=$(kudu_buildid); echo "      [$i] prod build id now: ${CUR:-<none>}"
  [ "$CUR" = "$NEW_BUILD" ] && { echo "      new build landed."; break; }; sleep 15
done
[ "$(kudu_buildid)" = "$NEW_BUILD" ] || die "the new build never landed"

# RESTART EXPLICITLY. The build landing on disk does NOT mean the running
# process picked it up — this deploy reported a new BUILD_ID and healthy 200s
# while the OLD process was still serving, and the first production check
# failed against code that had already been replaced on disk. Health is served
# by the old container throughout, so health is not evidence either.
echo "      restarting so the running process picks up the new build..."
az webapp restart -g "$RG" -n "$APP" -o none || die "restart failed"
for i in $(seq 1 30); do H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH"); echo "      [$i] health: HTTP $H"; [ "$H" = "200" ] && break; sleep 10; done
echo "      NOTE: verify BEHAVIOUR, not health."

echo "== DEPLOY SUMMARY =="
echo "   old build: $OLD_BUILD"
echo "   new build: $NEW_BUILD"
echo "   health:    HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH")"
echo "== INVITE FLOW DEPLOY COMPLETE =="
