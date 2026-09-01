#!/usr/bin/env bash
# Deploy: the site switcher presents as a bounded control.
#
# Both faults were invisible to anyone not on a phone with several open
# check-ins, so the guards assert the specific mechanisms rather than "it
# renders": the dedupe that makes the list sites-not-check-ins, and the three
# class changes that let the site control give way instead of being overlapped.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/workerswitcher_deploy.zip
SVC='services/workerDashboard/workerDashboardService.ts'
SHELL_C='components/worker/WorkerShell.tsx'
SW='components/worker/SiteSwitcher.tsx'
DEPLOYED=2fa1f24

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# These files' comments quote the very class names and code the guards assert,
# so SOURCE greps run over comment-stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== WORKER SWITCHER CONTROL DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="components/worker/SiteSwitcher.tsx
components/worker/WorkerShell.tsx
components/worker/icons.tsx
scripts/deploy/workerswitcher_deploy.sh
scripts/workerswitcher_affordance_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the switcher, the shell, the icon set and scripts." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# S1 — the list must be deduped by site, at the source.
code "$SVC" | grep -qF 'findIndex((o) => o.jobSiteId === s.jobSiteId) === i' \
  || { echo "ERROR: the S1 dedupe has been lost. Aborting"; exit 1; }
echo "      S1 still in place: openCheckIns deduped by jobSiteId."

# S2 — the site control must be able to shrink, and must no longer be fixed.
code "$SW" | grep -qF 'max-w-[12rem]' \
  && { echo "ERROR: the fixed 12rem width is back — the overlap would return. Aborting"; exit 1; }
code "$SW" | grep -qF 'touch-target' \
  || { echo "ERROR: the switcher is not a 44px+ touch target. Aborting"; exit 1; }

# THE CONTROL MUST LOOK LIKE ONE. This is the whole point of the change: the
# previous build was a bare select that read as a heading.
code "$SW" | grep -qF "'Switch site'" \
  || { echo "ERROR: the explicit affordance text is missing. Aborting"; exit 1; }
code "$SW" | grep -qF 'chevronDown' \
  || { echo "ERROR: the chevron is missing. Aborting"; exit 1; }
code "$SW" | grep -qF 'name="building"' \
  || { echo "ERROR: the site icon is missing from the control. Aborting"; exit 1; }
code "$SW" | grep -qF 'rounded-lg border border-line' \
  || { echo "ERROR: the control is not bounded. Aborting"; exit 1; }

# The real select must still be there, transparent and on top — a custom
# dropdown here would lose the native picker on both phone platforms.
code "$SW" | grep -qF 'absolute inset-0 h-full w-full cursor-pointer opacity-0' \
  || { echo "ERROR: the native select is no longer overlaying the control. Aborting"; exit 1; }
code "$SW" | grep -qF 'peer-focus-visible:ring-4' \
  || { echo "ERROR: focus would be invisible — the ring moved to the hidden select. Aborting"; exit 1; }
# Flexibility is the S2 mechanism and must survive; the alignment is this
# change's own fix — the caption was right-aligned opposite the control, which
# is part of what made the group read as fragments. Carried over from the
# previous deploy script, this guard still demanded text-right and stopped a
# correct build.
code "$SHELL_C" | grep -qF 'min-w-0 flex-1' \
  || { echo "ERROR: the site context is not flexible — the overlap would return. Aborting"; exit 1; }
code "$SHELL_C" | grep -qF 'min-w-0 flex-1 text-left' \
  || { echo "ERROR: the caption is not aligned under the control. Aborting"; exit 1; }
echo "      S2: site control is flexible, touch-sized, no fixed width."

# Sign out must appear exactly twice — one per breakpoint — or a width loses it.
SO=$(code "$SHELL_C" | grep -c '/api/worker/logout')
[ "$SO" = "2" ] \
  && echo "      Sign out present for both breakpoints (sm:hidden + sm:inline-flex)." \
  || { echo "ERROR: found $SO Sign out control(s), expected 2. Aborting"; exit 1; }
code "$SHELL_C" | grep -qF 'sm:hidden' || { echo "ERROR: the phone Sign out is not hidden from sm up — it would double. Aborting"; exit 1; }
code "$SHELL_C" | grep -qF 'sm:inline-flex' || { echo "ERROR: the desktop Sign out is not restored at sm. Aborting"; exit 1; }

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (searched across .next/server, not one chunk —"
echo "     these components compile into shared chunks, not a page file)..."
grep -rqF 'Switch site' .next/server 2>/dev/null \
  && echo "      the affordance text compiled in." \
  || { echo "ERROR: 'Switch site' absent from the bundle. Aborting"; exit 1; }
grep -rqF 'min-w-0 flex-1 text-left' .next/server 2>/dev/null \
  && echo "      the flexible, left-aligned site-context wrapper compiled in." \
  || { echo "ERROR: header wrapper classes absent from the bundle. Aborting"; exit 1; }
# The bounded control itself, not just its text.
grep -rqF 'rounded-lg border border-line bg-surface px-3' .next/server 2>/dev/null \
  && echo "      the bounded control chrome compiled in." \
  || { echo "ERROR: the control chrome is absent from the bundle. Aborting"; exit 1; }
grep -rqF 'max-w-[12rem] truncate rounded-lg' .next/server 2>/dev/null \
  && { echo "ERROR: the old fixed-width switcher is still in the bundle. Aborting"; exit 1; }
echo "      the old fixed-width switcher is gone from the bundle."

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
[ "$CODE" = "200" ] && echo "== WORKER SWITCHER CONTROL DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
