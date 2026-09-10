#!/usr/bin/env bash
# Deploy: every site requires an invitation; shorter worker statuses.
#
# This one CHANGES WHO CAN CHECK IN. The guards therefore care most about two
# things: that the gate really is unconditional, and that the lock-out guard the
# old switch carried has a replacement rather than simply being gone.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/alwaysinvited_deploy.zip
DEPLOYED=b10b2c4
SVC='services/workerAccess/workerAssignmentService.ts'
die() { echo "ERROR: $1. Aborting"; exit 1; }
kudu_buildid() { local tok v i
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
sys.stdout.write(s)
DOCPY
}

echo "== ALWAYS-INVITED DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/8] SOURCE guards..."
EXPECTED="app/api/platform/sites/[id]/worker-access/route.ts
app/platform/dashboard/sites/[id]/workers/page.tsx
app/platform/dashboard/submissions/page.tsx
components/attendance/AttendanceUI.tsx
components/platform/WorkerAccessManager.tsx
scripts/backfill_assignments_from_checkins.ts
scripts/deploy/alwaysinvited_deploy.sh
scripts/inviteflow_verify.ts
services/workerAccess/workerAssignmentService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the gate, its UI, two status labels and the backfill." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- The gate is unconditional.
code "$SVC" | grep -qE "siteEnforced|site\.workerAccessEnforced" \
  && die "the per-site enforcement flag is still read"
code "$SVC" | grep -q "export async function setSiteEnforcement" \
  && die "the enforcement setter survived"
python3 - <<'PY' || exit 1
import re, sys
s = open('services/workerAccess/workerAssignmentService.ts', encoding='utf-8').read()
m = re.search(r'export function evaluateAssignmentGate\(([^)]*)\)', s, re.S)
if not m: print('ERROR: evaluateAssignmentGate is gone. Aborting'); sys.exit(1)
params = m.group(1)
if 'siteEnforced' in params or 'invitedWorkersOnly' in params:
    print('ERROR: the gate still takes an enforcement flag. Aborting'); sys.exit(1)
if 'assignment' not in params:
    print('ERROR: the gate no longer takes the assignment. Aborting'); sys.exit(1)
print('      the gate takes only the assignment — enforcement cannot be switched off.')
PY
code "$SVC" | grep -q "short: 'Not invited'" || die "an unassigned worker is no longer refused"
echo "      an unassigned worker is refused everywhere."

# --- The lock-out guard has a replacement.
[ -f scripts/backfill_assignments_from_checkins.ts ] || die "the lock-out backfill is missing"
grep -q "WorkerAssignmentStatus.ACTIVE" scripts/backfill_assignments_from_checkins.ts \
  || die "the backfill does not create ACTIVE assignments"
grep -q "acceptedAt" scripts/backfill_assignments_from_checkins.ts \
  || die "the backfill would leave backfilled workers reading Invited"
grep -q -- "--apply" scripts/backfill_assignments_from_checkins.ts \
  || die "the backfill is not dry-run by default"
echo "      a backfill exists to keep already-working people from being locked out."

# --- The UI is gone.
for w in "Controlled access" "Switch on" "Switch off" "setEnforcement" "Only a Director"; do
  code components/platform/WorkerAccessManager.tsx | grep -q "$w" \
    && die "the settings panel still carries \"$w\""
done
code "app/api/platform/sites/[id]/worker-access/route.ts" | grep -q "setEnforcement" \
  && die "the API still accepts setEnforcement"
grep -q "Requirements before a worker can check in" components/platform/WorkerAccessManager.tsx \
  || die "the requirements were lost with the toggle"
echo "      no toggle, no messaging, no API action; the requirements survived."

# --- Terminology, scoped to per-worker STATUS.
grep -q "'on-site': 'On site'," "app/platform/dashboard/sites/[id]/workers/page.tsx" || die "roster on-site label not updated"
grep -q "assigned: 'Off site'," "app/platform/dashboard/sites/[id]/workers/page.tsx" || die "roster assigned label not updated"
grep -q "Assigned, not present" -r app components 2>/dev/null && die "the old assigned wording survives somewhere"
# The COUNT labels must NOT have been swept up — one of them is a CSV header.
grep -q "'Site', 'Check-ins', 'Active workers', 'On site now', 'Compliance %'" \
  "app/api/platform/reports/org-overview/export/route.ts" \
  || die "the org-overview CSV header changed; that would break saved spreadsheets"
grep -q "label: 'On site now'" components/admin/AdminNav.tsx || die "the Admin nav label changed"
echo "      per-worker statuses shortened; the count labels and CSV header untouched."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
echo "[4/8] Building..."; npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
grep -rq "Off site" .next/static/chunks/ .next/server/ || die "the Off site label is not in the build"
grep -rq "Controlled access" .next/static/chunks/ && die "the controlled-access messaging is still shipped"
echo "      the new labels shipped and the toggle messaging is gone."

echo "[5/8] Packaging zip..."
rm -f "$ZIP"; zip -qr "$ZIP" .next public package.json package-lock.json node_modules prisma next.config.js -x "node_modules/.cache/*" || die "zip failed"
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Deploying (async — a synchronous wait 504s on this app)..."
az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --async true || die "deploy failed"

echo "[7/8] Waiting for BUILD_ID $NEW_BUILD..."
for i in $(seq 1 40); do
  CUR=$(kudu_buildid); echo "      [$i] prod build id now: ${CUR:-<none>}"
  [ "$CUR" = "$NEW_BUILD" ] && { echo "      new build landed."; break; }; sleep 15
done
[ "$(kudu_buildid)" = "$NEW_BUILD" ] || die "the new build never landed"

echo "[8/8] Restarting so the running process picks it up..."
az webapp restart -g "$RG" -n "$APP" -o none || die "restart failed"
for i in $(seq 1 30); do H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH"); echo "      [$i] health: HTTP $H"; [ "$H" = "200" ] && break; sleep 10; done

echo "== DEPLOY SUMMARY =="
echo "   old build: $OLD_BUILD"
echo "   new build: $NEW_BUILD"
echo "   health:    HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH")"
echo "   REMINDER: run scripts/backfill_assignments_from_checkins.ts --apply against"
echo "   production, or workers with check-ins but no assignment are locked out."
echo "== ALWAYS-INVITED DEPLOY COMPLETE =="
