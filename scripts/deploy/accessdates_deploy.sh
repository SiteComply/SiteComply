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
ZIP=/tmp/accessdates_deploy.zip
DEPLOYED=8111dbd
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

echo "== ACCESS DATES DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/8] SOURCE guards..."
EXPECTED="app/api/platform/sites/[id]/worker-access/export/route.ts
app/api/platform/sites/[id]/worker-access/route.ts
app/platform/dashboard/sites/[id]/workers/page.tsx
components/platform/WorkerAssignmentActions.tsx
scripts/deploy/accessdates_deploy.sh
scripts/inviteflow_verify.ts
services/workerAccess/workerAssignmentService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the gate, its UI, two status labels and the backfill." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- The worker ROLE is gone from everything user-facing.
ACT='components/platform/WorkerAssignmentActions.tsx'
# Comment-stripped: these files DOCUMENT the removal, and a comment saying
# "Role & dates" is not a button still saying it. An earlier guard failed on
# exactly that.
code "$ACT" | grep -qw "Role" && die "the rail still offers a Role field"
code "$ACT" | grep -q "Role & dates" && die "the control is still called Role & dates"
code "app/platform/dashboard/sites/[id]/workers/page.tsx" | grep -q "Role on site" \
  && die "the rail still shows Role on site"
code "app/api/platform/sites/[id]/worker-access/route.ts" | grep -q "body.role" \
  && die "the API still accepts a role"
code "$SVC" | grep -q "role: existing.role" && die "a transfer still copies the role"
code "$SVC" | grep -qE "data: \{ role" && die "something still writes the role column"
grep -q "'Role'," "app/api/platform/sites/[id]/worker-access/export/route.ts" \
  && die "the CSV export still has a Role column"
echo "      no role in the rail, the API, the export, or on transfer."

# --- ...but the column and enum are KEPT, as agreed.
grep -q "role WorkerSiteRole?" prisma/schema.prisma || die "the role column was dropped; that needs a migration"
grep -q "enum WorkerSiteRole" prisma/schema.prisma || die "the role enum was dropped"
echo "      the column and enum remain in the schema, unwritten."

# --- Access dates are KEPT and still gate access.
code "$SVC" | grep -q "windowState(assignment.startDate, assignment.endDate)" \
  || die "the access window no longer gates check-in"
code "$SVC" | grep -q "Access starts" || die "the future-start refusal is gone"
code "$SVC" | grep -q "Access ended" || die "the expired refusal is gone"
code "$SVC" | grep -q "startDate, endDate" || die "setAssignmentDetails no longer writes the dates"
code "$ACT" | grep -q "'Access dates'" || die "the Access dates control is missing"
echo "      access dates still gate check-in and are still editable."

# --- Transfer is a top-level action.
code "$ACT" | grep -q "panel === 'transfer' ? 'Close' : 'Transfer'" \
  || die "Transfer is not a top-level action"
code "$ACT" | grep -q "panel === 'dates'" || die "the dates panel is missing"
echo "      Transfer and Access dates are separate top-level actions."

# --- Nothing that grants access changed.
code "$SVC" | grep -q "short: 'Not invited'" || die "an unassigned worker is no longer refused"
echo "      invitation is still required everywhere."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
echo "[4/8] Building..."; npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
grep -rq "Access dates" .next/static/chunks/ || die "the Access dates label is not in the client bundle"
grep -rq "Role & dates" .next/static/chunks/ .next/server/ && die "the old grouped control is still shipped"
echo "      the new control shipped and the old one is gone."

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
echo "   REMINDER: scripts/backfill_assignments_from_checkins.ts --apply is the ONE"
echo "   remaining manual step. Without it, workers with check-ins but no assignment"
echo "   are refused at the gate. The acceptance backfill is no longer needed at all."
echo "== ACCESS DATES DEPLOY COMPLETE =="
