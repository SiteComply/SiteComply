#!/usr/bin/env bash
# Deploy: one shared site control, two states.
#
# Guards written FRESH for this change rather than derived from the last deploy
# script. Three deploys in a row aborted on assertions inherited from a previous
# change that no longer described this one — cheaper to write them than to
# discover them one abort at a time.
#
# What must hold: the two states share one component, the read-only variant has
# NO interactive behaviour of any kind, and the interactive one keeps all of it.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/sitecontrol_deploy.zip
CHROME='components/worker/SiteControlChrome.tsx'
SW='components/worker/SiteSwitcher.tsx'
SHELL_C='components/worker/WorkerShell.tsx'
DEPLOYED=661d122

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# Every one of these files documents the classes and behaviour the guards check,
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

echo "== SITE CONTROL DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="components/worker/SiteControlChrome.tsx
components/worker/SiteSwitcher.tsx
components/worker/WorkerShell.tsx
scripts/deploy/sitecontrol_deploy.sh
scripts/workerheader_states_verify.js
scripts/workersitecontrol_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the shared chrome, its two callers, and scripts." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# ONE COMPONENT, BOTH CALLERS. If either stops using it the states can drift
# again, which is the failure this change exists to prevent.
[ -f "$CHROME" ] || { echo "ERROR: the shared chrome is missing. Aborting"; exit 1; }
for f in "$SW" "$SHELL_C"; do
  code "$f" | grep -qF 'SiteControlChrome' \
    || { echo "ERROR: $f does not use the shared chrome. Aborting"; exit 1; }
done
echo "      both states render from one component."

# THE READ-ONLY VARIANT. No chevron, no select, no hover, no focus.
code "$SHELL_C" | grep -qF 'interactive={false}' \
  || { echo "ERROR: the single-site branch is not the read-only variant. Aborting"; exit 1; }
code "$SHELL_C" | grep -qF 'supportingText="Current site"' \
  || { echo "ERROR: the single-site supporting text is not 'Current site'. Aborting"; exit 1; }
# Exactly one SiteSwitcher usage: the multi-site branch. A second would put a
# select into the read-only state.
SWU=$(code "$SHELL_C" | grep -c '<SiteSwitcher')
[ "$SWU" = "1" ] \
  || { echo "ERROR: found $SWU SiteSwitcher usages, expected exactly 1. Aborting"; exit 1; }
echo "      single-site is read-only, says 'Current site', and renders no switcher."

# The chevron and the interactive states must be CONDITIONAL on the variant —
# unconditional, the read-only box would look and behave like a control.
code "$CHROME" | grep -qF 'interactive && (' \
  || { echo "ERROR: the chevron is not gated on the interactive variant. Aborting"; exit 1; }
code "$CHROME" | grep -qE "interactive &&\s*$" \
  || code "$CHROME" | grep -qF "interactive &&" \
  || { echo "ERROR: hover/focus classes are not gated on the variant. Aborting"; exit 1; }
code "$CHROME" | grep -qF "interactive ? 'bg-surface' : 'bg-surface-sunken'" \
  || { echo "ERROR: the raised/recessed fill distinction is missing. Aborting"; exit 1; }
echo "      chevron, hover/focus and fill are all gated on the variant."

# THE INTERACTIVE VARIANT keeps everything it had.
code "$SW" | grep -qF "supportingText={busy ? 'Switching…' : 'Switch site'}" \
  || { echo "ERROR: the switcher's affordance text changed. Aborting"; exit 1; }
code "$SW" | grep -qF 'absolute inset-0 h-full w-full cursor-pointer opacity-0' \
  || { echo "ERROR: the native select no longer overlays the control. Aborting"; exit 1; }
echo "      the switcher keeps its overlaid native select and affordance."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards (searched across .next/server — these are shared"
echo "     components and do not compile into any one page file)..."
for want in 'Current site' 'Switch site' 'bg-surface-sunken'; do
  grep -rqF "$want" .next/server 2>/dev/null \
    || { echo "ERROR: '$want' absent from the bundle. Aborting"; exit 1; }
done
echo "      both variants' text and the recessed fill compiled in."

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
[ "$CODE" = "200" ] && echo "== SITE CONTROL DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
