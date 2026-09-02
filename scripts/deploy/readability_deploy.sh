#!/usr/bin/env bash
# Deploy: worker readability — three contrast corrections, three type corrections.
#
# Guards written fresh for this change. What must hold:
#   - every fill that failed AA is gone, and the replacement is the one measured
#     to pass (safe-600 does NOT pass; only safe-700 does)
#   - the emergency label is 14px and no longer uppercase
#   - the open-shift warning is dark, but the row still carries the amber
#   - the stepper is 12px
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/readability_deploy.zip
NAV='components/worker/WorkerNav.tsx'
SHELL_C='components/worker/WorkerShell.tsx'
EMERG='app/worker/emergency/page.tsx'
ATT='components/attendance/AttendanceUI.tsx'
STEPS='components/checkin/Steps.tsx'
DEPLOYED=48a7b01

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# Every one of these files documents the OLD values in a comment explaining why
# they changed, so SOURCE greps must run over comment-stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== READABILITY DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/worker/emergency/page.tsx
components/attendance/AttendanceUI.tsx
components/checkin/Steps.tsx
components/worker/WorkerNav.tsx
components/worker/WorkerShell.tsx
scripts/deploy/readability_deploy.sh
scripts/deploy/s3nav_deploy.sh
scripts/readability_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: five components plus the verification and deploy scripts." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# CONTRAST. The failing fills must be gone from these components entirely — a
# leftover would be invisible in review and fail only on a phone in sunlight.
code "$NAV" | grep -qF 'bg-brand-600 text-white' \
  || { echo "ERROR: the active nav pill is not brand-600. Aborting"; exit 1; }
! code "$NAV" | grep -q 'bg-brand-500' \
  || { echo "ERROR: brand-500 still present in the nav (2.5:1). Aborting"; exit 1; }
code "$SHELL_C" | grep -qF 'bg-safe-700 px-2 py-0.5 text-xs font-semibold text-white' \
  || { echo "ERROR: the Worker badge is not safe-700. Aborting"; exit 1; }
! code "$SHELL_C" | grep -qE 'bg-safe-(500|600)' \
  || { echo "ERROR: safe-500/600 still present (2.7:1 / 3.6:1 — neither passes). Aborting"; exit 1; }
echo "      both failing fills replaced with the shades measured to pass AA."

# THE OPEN-SHIFT WARNING: dark text, and the amber must survive on the row.
code "$ATT" | grep -qF "incomplete ? 'text-sm text-ink' : 'text-xs text-ink-subtle'" \
  || { echo "ERROR: the warning is not 14px ink with a 12px subtle fallback. Aborting"; exit 1; }
! code "$ATT" | grep -q "text-sm text-hivis-600" \
  || { echo "ERROR: the warning is still amber (2.56:1). Aborting"; exit 1; }
code "$ATT" | grep -qF 'border-hivis-500' && code "$ATT" | grep -qF 'text-hivis-600' \
  || { echo "ERROR: the row lost its amber chrome — it no longer reads as a warning. Aborting"; exit 1; }
echo "      warning is dark; the row keeps its amber border and icon."

# TYPE.
code "$EMERG" | grep -qF '<p className="text-sm font-medium text-ink-subtle">{label}</p>' \
  || { echo "ERROR: the emergency label is not 14px sentence case. Aborting"; exit 1; }
! code "$EMERG" | grep -q 'uppercase' \
  || { echo "ERROR: uppercase still applied on the emergency page. Aborting"; exit 1; }
code "$STEPS" | grep -qF "'mt-1.5 block text-xs font-medium'" \
  || { echo "ERROR: the check-in stepper is not 12px. Aborting"; exit 1; }
! code "$STEPS" | grep -q 'text-\[11px\]' \
  || { echo "ERROR: 11px still present in the stepper. Aborting"; exit 1; }
echo "      emergency labels 14px sentence case; stepper 12px."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards. These are client components, so they compile into"
echo "     the shared chunks rather than any one page file..."
for want in 'bg-brand-600 text-white shadow-sm shadow-brand-700/20' \
            'bg-safe-700 px-2 py-0.5 text-xs font-semibold text-white' \
            'text-sm font-medium text-ink-subtle' \
            'mt-1.5 block text-xs font-medium'; do
  grep -rqF "$want" .next/server .next/static 2>/dev/null \
    || { echo "ERROR: '$want' absent from the bundle. Aborting"; exit 1; }
done
# The exact old literals must be gone from the bundle.
#
# NOT listed here: 'bg-brand-500 text-white shadow-sm shadow-brand-600/20'.
# That string is ALSO produced by components/ui/Button.tsx and
# components/platform/PlatformNav.tsx, which are unchanged and correct, and they
# bundle into the same chunk as the worker nav — so its presence proves nothing
# either way and its absence can never be asserted here. The first version of
# this guard listed it and aborted a build that was right. What actually covers
# the nav is the pair above: the SOURCE guard proves WorkerNav.tsx no longer
# contains brand-500, and the presence guard proves brand-600 compiled in.
for gone in 'bg-safe-500 px-2 py-0.5 text-xs font-semibold text-white' \
            'text-sm text-hivis-600' \
            'mt-1.5 block text-[11px] font-medium'; do
  ! grep -rqF "$gone" .next/server .next/static 2>/dev/null \
    || { echo "ERROR: the old value '$gone' is still compiled in. Aborting"; exit 1; }
done
echo "      new values compiled in; the old values are gone (see the note above"
echo "      on the one string that is shared with Button and cannot be asserted)."

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
[ "$CODE" = "200" ] && echo "== READABILITY DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
