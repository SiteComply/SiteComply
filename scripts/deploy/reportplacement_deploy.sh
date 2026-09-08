#!/usr/bin/env bash
# Deploy: the reporting entry point moves to each experience's natural home.
#
# Two shells only. No migration, no service change — the capture path, the
# dialog and the database are exactly as already deployed.
#
# Guards written fresh. What must hold: Worker keeps a PHONE instance and gains
# a DESKTOP one between Check out and Sign out; Platform's control leaves the
# rail head on desktop and appears in the account foot paired with Sign out;
# Admin is untouched.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/reportplacement_deploy.zip
WORKER='components/worker/WorkerShell.tsx'
PLAT='components/platform/PlatformShell.tsx'
ADMIN='components/admin/AdminShell.tsx'
DEPLOYED=ba9fdcc

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

echo "== REPORTING PLACEMENT DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="components/platform/PlatformShell.tsx
components/worker/WorkerShell.tsx
scripts/deploy/reportplacement_deploy.sh"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: two shells and this script. No service or schema change." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# WORKER: two instances, one per breakpoint.
N=$(code "$WORKER" | grep -c '<ReportIssueButton')
[ "$N" = "2" ] || { echo "ERROR: worker has $N instances, expected 2. Aborting"; exit 1; }
code "$WORKER" | grep -qF 'flex shrink-0 items-center gap-2 sm:hidden' \
  || { echo "ERROR: the worker phone instance is not sm:hidden. Aborting"; exit 1; }
code "$WORKER" | grep -qF '<span className="hidden sm:inline-flex">' \
  || { echo "ERROR: the worker desktop instance is missing. Aborting"; exit 1; }
# It must sit BETWEEN Check out and Sign out in source order.
python3 - <<'PY' || exit 1
import re, sys
s = open('components/worker/WorkerShell.tsx', encoding='utf-8').read()
co = s.find('<CheckOutOfSiteButton')
btn = s.find('hidden sm:inline-flex')
so = s.find('/api/worker/logout', btn)
if not (0 < co < btn < so):
    print(f'ERROR: worker order is wrong — checkOut={co} feedback={btn} signOut={so}. Aborting')
    sys.exit(1)
print('      worker: phone instance kept, desktop instance between Check out and Sign out.')
PY

# PLATFORM: head instance is phones-only; foot instance is paired with Sign out.
N=$(code "$PLAT" | grep -c '<ReportIssueButton')
[ "$N" = "2" ] || { echo "ERROR: platform has $N instances, expected 2. Aborting"; exit 1; }
code "$PLAT" | grep -qF 'ml-auto flex items-center gap-2 md:hidden' \
  || { echo "ERROR: the platform rail-head instance is not md:hidden. Aborting"; exit 1; }
code "$PLAT" | grep -qF 'mt-2 flex flex-wrap items-center gap-2' \
  || { echo "ERROR: the account row is not a wrapping horizontal group. Aborting"; exit 1; }
! code "$PLAT" | grep -qF 'mt-2 flex flex-col items-start gap-2' \
  || { echo "ERROR: the account row is still stacked. Aborting"; exit 1; }
echo "      platform: rail head is phones-only; account foot is a horizontal group."

# ADMIN UNTOUCHED.
git diff --quiet "$DEPLOYED" HEAD -- "$ADMIN" \
  || { echo "ERROR: AdminShell changed and must not have. Aborting"; exit 1; }
echo "      admin shell is byte-identical to what is deployed."

# NOTHING BEHIND THE UI MOVED.
for f in services/reports/reportService.ts app/api/reports/route.ts components/ui/ReportIssueDialog.tsx components/ui/ReportIssueButton.tsx prisma/schema.prisma; do
  git diff --quiet "$DEPLOYED" HEAD -- "$f" \
    || { echo "ERROR: $f changed; this deploy is placement only. Aborting"; exit 1; }
done
echo "      capture, storage, dialog and schema are unchanged."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
for want in 'hidden sm:inline-flex' 'mt-2 flex flex-wrap items-center gap-2' 'ml-auto flex items-center gap-2 md:hidden'; do
  grep -rqF "$want" .next/server .next/static 2>/dev/null \
    || { echo "ERROR: '$want' absent from the bundle. Aborting"; exit 1; }
done
! grep -rqF 'mt-2 flex flex-col items-start gap-2' .next/server .next/static 2>/dev/null \
  || { echo "ERROR: the stacked account row is still compiled in. Aborting"; exit 1; }
echo "      the new placement classes compiled in; the stacked row is gone."

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
[ "$CODE" = "200" ] && echo "== REPORTING PLACEMENT DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
