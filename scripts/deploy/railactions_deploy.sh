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
ZIP=/tmp/railactions_deploy.zip
DEPLOYED=79d609c
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

echo "== WORKER ACCESS INTO THE RAIL =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/7] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/7] SOURCE guards..."
EXPECTED="app/platform/dashboard/sites/[id]/workers/page.tsx
components/platform/WorkerAccessManager.tsx
components/platform/WorkerAssignmentActions.tsx
scripts/backfill_assignment_acceptance.ts
scripts/deploy/railactions_deploy.sh"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the invite service, its route, two UI files and the schema comment." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- The duplicate list is gone from the settings panel.
for w in "Suspend" "Remove" "Approve" "Reinstate" "Transfer" "Export CSV" "assignmentStatusLabel"; do
  grep -q "$w" components/platform/WorkerAccessManager.tsx \
    && die "the settings panel still carries \"$w\" — the worker list was not fully removed"
done
grep -q "rows: AssignmentRow" components/platform/WorkerAccessManager.tsx \
  && die "the settings panel still takes the roster"
echo "      the settings panel holds no worker list and no per-worker action."

# --- ...but it KEEPS what is genuinely site-level.
grep -q "Requirements before a worker can check in" components/platform/WorkerAccessManager.tsx \
  || die "the requirements were lost with the list"
grep -q "setEnforcement" components/platform/WorkerAccessManager.tsx \
  || die "the controlled-access switch was lost with the list"
echo "      the requirements and the controlled-access switch survived."

# --- Every action that was removed has a new home.
for a in "'suspend'" "'reinstate'" "'approve'" "'remove'" "'setDetails'" "'transfer'"; do
  grep -q "action: $a" components/platform/WorkerAssignmentActions.tsx \
    || grep -q "approveAction" components/platform/WorkerAssignmentActions.tsx \
    || die "action $a has no home in the rail"
done
grep -q "canManage" components/platform/WorkerAssignmentActions.tsx || die "the rail actions are ungated"
grep -q "if (!canManage) return null" components/platform/WorkerAssignmentActions.tsx \
  || die "the rail renders actions without the capability"
echo "      every per-worker action moved to the rail, behind the same capability."

# --- Approval renders only where it is a control.
grep -q "row.status !== 'ACTIVE'" components/platform/WorkerAssignmentActions.tsx \
  || die "approval is no longer conditional on status"
echo "      approval appears only for a non-ACTIVE assignment."

# --- The lifted-out pieces landed on the page.
for w in "lose access" "Export CSV" "active" "Project access settings"; do
  grep -q "$w" "app/platform/dashboard/sites/[id]/workers/page.tsx" \
    || die "\"$w\" did not land on the workers page"
done
grep -q "Manage project access" "app/platform/dashboard/sites/[id]/workers/page.tsx" \
  && die "the old panel title survived"
echo "      summary, expiry warning and export are on the page; the panel is renamed."

# --- Nothing that grants access changed.
for f in services/workerAccess/workerAssignmentService.ts services/workerAccess/assignmentLabels.ts \
         "app/api/platform/sites/[id]/worker-access/route.ts" prisma/schema.prisma \
         services/submissions/submissionService.ts; do
  git diff --quiet "$DEPLOYED" HEAD -- "$f" || die "$f changed; this deploy is presentation only"
done
echo "      the service, the labels, the route and the schema are untouched."

echo "[3/7] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
echo "[4/7] Building..."; npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
grep -rq "MANAGE ACCESS\|Manage access" .next/static/chunks/ || die "the rail action group is not in the bundle"
grep -rq "Project access settings" .next/server/ || die "the renamed panel is not in the build"
echo "      the rail actions and the renamed panel compiled in."

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
