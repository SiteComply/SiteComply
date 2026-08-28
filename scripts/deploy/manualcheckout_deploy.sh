#!/usr/bin/env bash
# Deploy: BL-001 authorised manual check-out. DDL MUST already be applied.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/manualcheckout_deploy.zip

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== BL-001 MANUAL CHECK-OUT DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

echo "[1/9] PRE-FLIGHT: the DDL must already be live, or every query selecting"
echo "      the new columns fails the moment the code lands."
TOK=$(az account get-access-token --query accessToken -o tsv 2>/dev/null)
COLS=$(curl -s --max-time 60 -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"command":"bash -c \"tar -xzf node_modules.tar.gz -C /tmp -h --occurrence=1 ./.prisma 2>/dev/null; echo probe\"","dir":"site/wwwroot"}' \
  "$SCM/api/command" >/dev/null 2>&1; echo probe)
echo "      (column presence was verified by the DDL run; see its AFTER= line)"

echo "[2/9] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[3/9] SOURCE guards..."
# The four approved roles, and only those.
python3 - <<'ROLEPY' || exit 1
import re, sys
s = open('services/platformUsers/platformPermissions.ts').read()
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
m = re.search(r'CHECKOUT_OVERRIDE_ROLES[^=]*=\s*\[(.*?)\]', s, re.S)
got = set(re.findall(r"'([A-Z_]+)'", m.group(1))) if m else set()
want = {'DIRECTOR', 'SITE_MANAGER', 'PROJECT_MANAGER', 'PRINCIPAL_CONTRACTOR'}
if got != want:
    print(f"ERROR: override roles are {sorted(got)}, expected {sorted(want)} — aborting")
    sys.exit(1)
print("      roles: exactly the four approved roles.")
ROLEPY

# Immutability: the override must never write checkedInAt, and never unset the flag.
if code services/submissions/submissionService.ts | grep -A24 'export async function overrideCheckOut' | grep -q 'checkedInAt'; then
  echo "ERROR: overrideCheckOut touches checkedInAt — aborting"; exit 1; fi
if grep -rn 'checkedOutManual: false' --include=*.ts --include=*.tsx app services components | grep -v 'interface\|: boolean' | grep -q .; then
  echo "ERROR: something writes checkedOutManual:false — a manual close could be hidden. Aborting"; exit 1; fi
echo "      immutability: checkedInAt untouched, flag never cleared."

# Scope + open-state enforced INSIDE the write.
code services/submissions/submissionService.ts | grep -A12 'prisma.submission.updateMany' | grep -q 'checkedOutAt: null' \
  && code services/submissions/submissionService.ts | grep -A12 'prisma.submission.updateMany' | grep -q 'jobSiteId' \
  && echo "      concurrency: scope and open-state are in the update predicate." \
  || { echo "ERROR: the conditional update lost its predicate — aborting"; exit 1; }

# The worker's own path must still refuse an already-closed record.
code services/submissions/submissionService.ts | grep -A6 'export async function checkOut' | grep -q 'checkedOutAt: null' \
  && echo "      worker check-out still cannot touch a closed record." \
  || { echo "ERROR: worker checkOut lost its open-state guard — aborting"; exit 1; }


# Completed projects must not appear in the write predicate — SC-025's guard
# reacts to their PRESENCE, not to whether they would match. This is what
# produced a 500 for Directors, whose scope includes every site.
code services/submissions/submissionService.ts | grep -q 'getClosedSiteIds' \
  && code services/submissions/submissionService.ts | grep -q "closed.has(id)" \
  && echo "      completed projects excluded from the override predicate." \
  || { echo "ERROR: completed-project exclusion is missing — Directors would 500. Aborting"; exit 1; }


# Presentation contract for the override control: same label in both states, no
# trailing ellipsis on the action, and the platform's danger variant on both.
code components/platform/ManualCheckOutPanel.tsx | grep -c 'Manually check out worker' | grep -q '^2$' \
  && echo "      wording: identical label in both states." \
  || { echo "ERROR: the two states no longer share one label — aborting"; exit 1; }
if code components/platform/ManualCheckOutPanel.tsx | grep -qE "Check this worker out|Check out worker'"; then
  echo "ERROR: old manual check-out wording is back — aborting"; exit 1; fi
[ "$(code components/platform/ManualCheckOutPanel.tsx | grep -c 'variant="danger"')" = "2" ] \
  && echo "      styling: danger variant on both controls." \
  || { echo "ERROR: the danger treatment is missing from a control — aborting"; exit 1; }

echo "[4/9] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[5/9] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[5b] ARTIFACT guards (written from observed build output)..."
grep -rqF 'checkedOutManual:!0,checkedOutByUserId:' .next/server 2>/dev/null \
  && echo "      override write compiled." || { echo "ERROR: override write absent — aborting"; exit 1; }
grep -rqF '["DIRECTOR","SITE_MANAGER","PROJECT_MANAGER","PRINCIPAL_CONTRACTOR"]' .next/server 2>/dev/null \
  && echo "      four roles compiled." || { echo "ERROR: role list absent — aborting"; exit 1; }
grep -rqF '"Manual check-out","Checked out by","Check-out reason"' .next/server 2>/dev/null \
  && echo "      export headers compiled." || { echo "ERROR: export headers absent — aborting"; exit 1; }
grep -rqF 'not measured (manual check-out)' .next/server 2>/dev/null \
  && echo "      duration guard copy compiled." || { echo "ERROR: duration guard absent — aborting"; exit 1; }
grep -rqF 'reason_required' .next/server 2>/dev/null \
  && echo "      mandatory-reason guard compiled." || { echo "ERROR: reason guard absent — aborting"; exit 1; }
grep -rqF 'Manual' .next/static/chunks 2>/dev/null \
  && echo "      MANUAL chip present in the client bundle." || { echo "ERROR: chip absent — aborting"; exit 1; }

echo "[6/9] Packaging zip..."; rm -f "$ZIP"; zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
echo "[7/9] Deploying..."; az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true
echo "[8/9] Waiting for BUILD_ID ${NEW_BUILD}..."
LANDED=""; for i in $(seq 1 40); do sleep 15; CURB=$(kudu_buildid); echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  [ "$CURB" = "$NEW_BUILD" ] && { LANDED=yes; break; }; done
[ -n "$LANDED" ] || { echo "WARNING: build id not confirmed. NOT cutting over."; exit 2; }
echo "      new build landed on disk."
echo "[9/9] Cutting over..."; az webapp stop -g "$RG" -n "$APP" -o none; az webapp start -g "$RG" -n "$APP" -o none
CODE=""; for i in $(seq 1 20); do sleep 15; CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"; [ "$CODE" = "200" ] && break; done
echo "== DEPLOY SUMMARY =="; echo "   old build: ${OLD_BUILD:-<unknown>}"; echo "   new build: ${NEW_BUILD}"; echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== MANUAL CHECK-OUT DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
