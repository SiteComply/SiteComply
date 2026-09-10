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
ZIP=/tmp/derivedactive_deploy.zip
DEPLOYED=e83b406
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

echo "== DERIVED-ACTIVE DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/8] SOURCE guards..."
EXPECTED="app/api/platform/auth-settings/route.ts
app/platform/dashboard/sites/[id]/workers/page.tsx
components/platform/AuthAccessSettings.tsx
scripts/backfill_assignment_acceptance.ts
scripts/backfill_assignments_from_checkins.ts
scripts/deploy/derivedactive_deploy.sh
scripts/inviteflow_verify.ts
services/submissions/submissionService.ts
services/workerAccess/assignmentLabels.ts
services/workerAccess/workerAssignmentService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the gate, its UI, two status labels and the backfill." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- Active is DERIVED, and nothing writes the retired column.
grep -q "prisma.submission.groupBy" "$SVC" || die "arrival is no longer derived from attendance history"
grep -q "_min: { checkedInAt: true }" "$SVC" || die "the derivation does not take the FIRST check-in"
grep -q "arrivedAt" services/workerAccess/assignmentLabels.ts || die "the label does not read the derived value"
code "$SVC" | grep -q "data: { acceptedAt" && die "something still writes the retired acceptance column"
code "$SVC" | grep -q "export async function recordAcceptance" && die "recordAcceptance survived"
code services/submissions/submissionService.ts | grep -q "recordAcceptance" \
  && die "the check-in path still writes acceptance bookkeeping"
[ -f scripts/backfill_assignment_acceptance.ts ] && die "the acceptance backfill should be deleted, not kept"
echo "      Active is derived from the first check-in; nothing stores or backfills it."

# --- The two dead settings are gone from the UI and the API.
for w in "Access controls" "Invited workers only" "Require an active site assignment"; do
  code components/platform/AuthAccessSettings.tsx | grep -q "$w" \
    && die "the settings page still shows \"$w\""
done
code app/api/platform/auth-settings/route.ts | grep -qE "invitedWorkersOnly|requireActiveSiteAssignment" \
  && die "the API still accepts a setting that cannot change anything"
# ...but the REST of that page must survive.
grep -q "Panel" components/platform/AuthAccessSettings.tsx || die "the settings page lost its other panels"
echo "      the two dead settings are gone from the UI and the API."

# --- The gate is still unconditional, and the one real backfill is still there.
code "$SVC" | grep -qE "siteEnforced|site\.workerAccessEnforced" && die "the per-site flag came back"
code "$SVC" | grep -q "short: 'Not invited'" || die "an unassigned worker is no longer refused"
[ -f scripts/backfill_assignments_from_checkins.ts ] || die "the lock-out backfill is missing"
grep -q "acceptedAt" scripts/backfill_assignments_from_checkins.ts \
  && die "the lock-out backfill still writes the retired column"
echo "      invitation still required everywhere; the one-time assignment backfill remains."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
echo "[4/8] Building..."; npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
grep -rq "Off site" .next/static/chunks/ .next/server/ || die "the status labels are not in the build"
grep -rq "Invited workers only" .next/ 2>/dev/null && die "the removed setting is still shipped"
echo "      the labels shipped and the dead setting is not in the build."

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
echo "== DERIVED-ACTIVE DEPLOY COMPLETE =="
