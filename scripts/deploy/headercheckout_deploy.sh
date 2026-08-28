#!/usr/bin/env bash
# Deploy: global header check-out across the Worker Portal.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/headercheckout_deploy.zip
BTN=components/worker/CheckOutOfSiteButton.tsx
SHELL_=components/worker/WorkerShell.tsx
kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }
code() { python3 - "$1" <<'NAVPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
NAVPY
}
echo "== HEADER CHECK-OUT DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# behaviour must be untouched — endpoint, dialog copy, post-success routing
for s in "api/worker/checkout" "Are you sure you want to check out?" "router.push('/worker')" "Checking out…"; do
  code "$BTN" | grep -qF "$s" || { echo "ERROR: '$s' missing from the button — aborting"; exit 1; }
done
echo "      confirmed: endpoint, dialog copy, redirect and busy state intact."
git diff HEAD~1 HEAD -- "$BTN" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -qE "api/worker/checkout|ConfirmDialog|router\.push|toast\.(success|error)" \
  && { echo "ERROR: behaviour lines changed in the button — aborting"; exit 1; } \
  || echo "      confirmed: no behavioural lines changed, styling/variant only."

# the Dashboard keeps its LARGE primary button (no variant => primary)
code app/worker/dashboard/page.tsx | grep -q '<CheckOutOfSiteButton submissionId={submission.id} />' \
  && echo "      confirmed: Dashboard still renders the large primary button." \
  || { echo "ERROR: Dashboard button changed — aborting"; exit 1; }

# header control placed between site context and Sign out, and panel-gated
code "$SHELL_" | grep -q 'panels.CHECK_OUT' \
  && echo "      confirmed: header control honours panels.CHECK_OUT." \
  || { echo "ERROR: header control is not panel-gated — aborting"; exit 1; }
python3 - <<'ORDERPY' || exit 1
import re, sys
s = open('components/worker/WorkerShell.tsx', encoding='utf-8').read()
h = re.search(r'<header.*?</header>', s, re.S).group(0)
i_site = max(h.find('SiteSwitcher'), h.find('{siteName}'))
i_out  = h.find('CheckOutOfSiteButton')
i_sign = h.find('/api/worker/logout')
if not (i_site < i_out < i_sign):
    print(f"ERROR: header order wrong (site={i_site} checkout={i_out} signout={i_sign})"); sys.exit(1)
print("      confirmed: order is site context -> Check out -> Sign out.")
ORDERPY

# every shell entry point supplies the id
MISSING=""
for f in $(grep -rl '<WorkerShell' app/worker components 2>/dev/null); do
  awk '/<WorkerShell/,/>/' "$f" | grep -q 'submissionId=' || MISSING="$MISSING $f"
done
[ -z "$MISSING" ] && echo "      confirmed: every WorkerShell call site passes submissionId." \
  || { echo "ERROR: missing submissionId in:$MISSING — aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
for s in "Are you sure you want to check out" "Checking out" "Could not check you out" "Stay safe"; do
  n=$(grep -rl "$s" .next/static/chunks 2>/dev/null | wc -l)
  [ "$n" -ge 1 ] || { echo "ERROR: '$s' absent from the client bundle — aborting"; exit 1; }
done
echo "      confirmed: confirmation, busy and error strings all bundled."
grep -rq 'border-danger-200' .next/static/chunks .next/server 2>/dev/null \
  && echo "      confirmed: header variant styling compiled." \
  || { echo "ERROR: header variant styling absent — aborting"; exit 1; }

echo "[5/8] Packaging zip..."; rm -f "$ZIP"; zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"
echo "[6/8] Deploying..."; az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true
echo "[7/8] Waiting for BUILD_ID ${NEW_BUILD}..."
LANDED=""; for i in $(seq 1 40); do sleep 15; CURB=$(kudu_buildid); echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  [ "$CURB" = "$NEW_BUILD" ] && { LANDED=yes; break; }; done
[ -n "$LANDED" ] || { echo "WARNING: build id not confirmed. NOT cutting over."; exit 2; }
echo "      new build landed on disk."
echo "[8/8] Cutting over..."; az webapp stop -g "$RG" -n "$APP" -o none; az webapp start -g "$RG" -n "$APP" -o none
CODE=""; for i in $(seq 1 20); do sleep 15; CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"; [ "$CODE" = "200" ] && break; done
echo "== DEPLOY SUMMARY =="; echo "   old build: ${OLD_BUILD:-<unknown>}"; echo "   new build: ${NEW_BUILD}"; echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== HEADER CHECK-OUT DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
