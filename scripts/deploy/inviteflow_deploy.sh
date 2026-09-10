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
ZIP=/tmp/inviteflow_deploy.zip
DEPLOYED=5a16415
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

echo "== INVITE A WORKER DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/7] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/7] SOURCE guards..."
EXPECTED="app/api/platform/sites/[id]/worker-access/route.ts
app/platform/dashboard/sites/[id]/workers/page.tsx
components/platform/InviteWorkerDialog.tsx
components/platform/WorkerAccessManager.tsx
prisma/schema.prisma
scripts/deploy/inviteflow_deploy.sh
scripts/inviteflow_verify.ts
services/workerAccess/workerAssignmentService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the invite service, its route, two UI files and the schema comment." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- The code is gone from everything except the retired column.
for f in "$SVC" "$DLG" components/platform/WorkerAccessManager.tsx \
         "app/platform/dashboard/sites/[id]/workers/page.tsx" \
         "app/api/platform/sites/[id]/worker-access/route.ts"; do
  code "$f" | grep -q 'invitationCode' && die "$f still references invitationCode"
done
code "$SVC" | grep -q 'makeInvitationCode' && die "the code generator survived"
grep -q 'invitationCode String?' prisma/schema.prisma || die "the column was dropped; that needs a hand-applied migration"
echo "      no code is generated, stored, sent or displayed; the column remains unwritten."

# --- The SMS.
code "$SVC" | grep -qi 'invitation code is' && die "the SMS still quotes a code"
code "$SVC" | grep -q 'Sign in at ${appUrl()}' || die "the SMS no longer builds a URL"
code "$SVC" | grep -q "process.env.APP_BASE_URL" || die "appUrl does not read APP_BASE_URL"
code "$SVC" | grep -q "app.sitecomply.co.uk" || die "there is no URL fallback"
code "$SVC" | grep -q 'NEXT_PUBLIC_APP_URL' && die "the unset variable is still being read"
echo "      the SMS carries a real link and no code."

# --- The existing worker is still PROTECTED, and now reported.
code "$SVC" | grep -q 'update: {},' || die "the worker upsert no longer protects an existing record"
code "$SVC" | grep -q 'existingWorker: { fullName: priorWorker.fullName, company: priorWorker.company }' \
  || die "the existing worker's details are not returned to the dialog"
code "$DLG" | grep -q 'This worker was already on SiteComply' || die "the dialog does not warn"
code "$DLG" | grep -q 'not the ones you entered' || die "the warning does not say which details win"
echo "      an existing record is still protected, and the manager is told."

# --- APPROVAL: the two cases that must keep it.
code "$SVC" | grep -q 'WorkerAssignmentStatus.SUSPENDED' || die "SUSPENDED is not handled"
code "$SVC" | grep -q 'WorkerAssignmentStatus.REMOVED' || die "REMOVED is not handled"
python3 - <<'PY' || exit 1
import re, sys
s = open('services/workerAccess/workerAssignmentService.ts', encoding='utf-8').read()
m = re.search(r'const needsExplicitApproval\s*=\s*(.*?);', s, re.S)
if not m:
    print("ERROR: needsExplicitApproval is gone — every re-invitation would auto-approve. Aborting"); sys.exit(1)
cond = m.group(1)
for want in ('SUSPENDED', 'REMOVED'):
    if want not in cond:
        print(f"ERROR: {want} is not in the approval condition. Aborting"); sys.exit(1)
if 'INVITED' in cond or 'ACTIVE' in cond:
    print("ERROR: the approval condition names a status it should not. Aborting"); sys.exit(1)
print("      re-approval is required for SUSPENDED and REMOVED, and nothing else.")
PY
# Transfers keep their approval regardless.
python3 - <<'PY' || exit 1
import re, sys
s = open('services/workerAccess/workerAssignmentService.ts', encoding='utf-8').read()
i = s.find('export async function transferAssignment')
if i < 0: i = s.find('transferAssignment')
seg = s[i:i+4000]
if 'WorkerAssignmentStatus.INVITED' not in seg:
    print("ERROR: a transfer no longer lands as INVITED — the receiving site would lose its say. Aborting"); sys.exit(1)
if 'autoApproved: false' not in seg:
    print("ERROR: a transfer no longer reports itself as needing approval. Aborting"); sys.exit(1)
print("      a transfer still requires the receiving site to approve.")
PY

# --- Safety: the requirements gate is untouched.
git diff --quiet "$DEPLOYED" HEAD -- services/workerAccess/workerAccessRules.ts 2>/dev/null || true
code "$SVC" | grep -q 'evaluateRequirements(workerId, siteId)' \
  || die "canWorkerCheckIn no longer evaluates competency and induction"
code "$SVC" | grep -q 'gate.requirementsPending' || die "the requirements gate is bypassed"
echo "      competency and induction are still evaluated after the assignment gate."

# --- Audit trail.
code "$SVC" | grep -q "'APPROVED'," || die "auto-approval is not recorded as an event"
echo "      an auto-approval is recorded in the history."

echo "[3/7] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
echo "[4/7] Building..."; npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
grep -rq 'This worker was already on SiteComply' .next/static/chunks/ || die "the new warning is not in the client bundle"
grep -rq 'Invitation code' .next/static/chunks/ && die "the old code label is still in the client bundle"
grep -rq 'Read this to the worker' .next/static/chunks/ && die "the old read-it-out instruction is still shipped"
grep -rq 'app.sitecomply.co.uk' .next/server/ || die "the SMS URL is not in the server build"
echo "      the new copy shipped and both old strings are gone."

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
for i in $(seq 1 30); do H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH"); echo "      [$i] health: HTTP $H"; [ "$H" = "200" ] && break; sleep 10; done

echo "== DEPLOY SUMMARY =="
echo "   old build: $OLD_BUILD"
echo "   new build: $NEW_BUILD"
echo "   health:    HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH")"
echo "== INVITE FLOW DEPLOY COMPLETE =="
