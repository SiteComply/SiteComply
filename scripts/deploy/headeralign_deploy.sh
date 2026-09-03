#!/usr/bin/env bash
# Deploy: worker header — the site control and the action buttons share a baseline.
#
# Guards written fresh. What must hold: the actions row aligns tops, and the
# "Checked in" line stays INSIDE the control's wrapper. Moving the timestamp out
# of that wrapper would also fix the alignment, but it would then belong to the
# row rather than to the site — which is the thing that was explicitly asked for.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/headeralign_deploy.zip
SHELL_C='components/worker/WorkerShell.tsx'
DEPLOYED=5c1c550

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# The file's comments quote the OLD class, so greps run over stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== HEADER ALIGNMENT DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="components/worker/WorkerShell.tsx
scripts/deploy/headeralign_deploy.sh
scripts/headeralign_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the worker shell plus its guard and verification." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

code "$SHELL_C" | grep -qF 'flex w-full min-w-0 items-start justify-end gap-2 sm:w-auto sm:gap-3' \
  || { echo "ERROR: the actions row no longer aligns tops. Aborting"; exit 1; }
! code "$SHELL_C" | grep -qF 'flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto sm:gap-3' \
  || { echo "ERROR: the actions row is centred again — the card will ride up. Aborting"; exit 1; }
echo "      the actions row aligns tops."

# The timestamp must remain in the control's wrapper, in BOTH branches.
N=$(code "$SHELL_C" | grep -c 'mt-0.5 block truncate pl-1 text-xs text-ink-subtle')
[ "$N" = "2" ] \
  || { echo "ERROR: found $N 'Checked in' lines, expected 2 (switcher + read-only). Aborting"; exit 1; }
M=$(code "$SHELL_C" | grep -c 'className="min-w-0 flex-1 text-left"')
[ "$M" = "2" ] \
  || { echo "ERROR: found $M control wrappers, expected 2 — the timestamp may have been moved out. Aborting"; exit 1; }
echo "      the timestamp stays inside the site control's wrapper, both variants."

# All three controls must keep the 52px target that makes the baseline work.
code "$SHELL_C" | grep -qF 'touch-target hidden shrink-0 items-center whitespace-nowrap rounded-lg' \
  || { echo "ERROR: Sign out lost its touch target. Aborting"; exit 1; }
echo "      Sign out keeps its 52px target."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
grep -rqF 'items-start justify-end gap-2 sm:w-auto sm:gap-3' .next/server .next/static 2>/dev/null \
  || { echo "ERROR: the aligned row is absent from the bundle. Aborting"; exit 1; }
! grep -rqF 'items-center justify-end gap-2 sm:w-auto sm:gap-3' .next/server .next/static 2>/dev/null \
  || { echo "ERROR: the centred row is still compiled in. Aborting"; exit 1; }
echo "      the aligned row compiled in; the centred one is gone."

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
[ "$CODE" = "200" ] && echo "== HEADER ALIGNMENT DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
