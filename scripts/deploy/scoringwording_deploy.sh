#!/usr/bin/env bash
# Deploy: Audit Scoring wording — scoring configuration vs question authoring.
#
# Guards written fresh. The POINT of this change is that no two things share a
# name, so the guards assert ABSENCE as well as presence: the old label must be
# gone everywhere, and each of the three new names must appear exactly once.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/scoringwording_deploy.zip
CFG='components/platform/AuditScoringConfig.tsx'
DEPLOYED=107d5ef

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# The file explains the OLD label in its comments, so SOURCE greps must run over
# comment-stripped code or the "old label is gone" guard matches its own history.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== SCORING WORDING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="components/platform/AuditScoringConfig.tsx
scripts/deploy/scoringwording_deploy.sh
scripts/scoringwording_verify.js
scripts/workspace_deploy.sh"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the scoring screen, its guard, and the two scripts." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# The old label must be gone from CODE and from the older deploy script, which
# asserted the literal and would fail the next time it ran.
! code "$CFG" | grep -q 'Configure Questions' \
  || { echo "ERROR: 'Configure Questions' still rendered. Aborting"; exit 1; }
! grep -q 'Configure Questions' scripts/workspace_deploy.sh \
  || { echo "ERROR: the older deploy script still asserts the old label. Aborting"; exit 1; }
echo "      the old label is gone from the screen and from the older guard."

# Each new name exactly once — more than one is the duplicate naming this change
# exists to remove.
for pair in 'How questions are scored' 'Set question rules' 'Question Scoring Rules (${questionCount})'; do
  N=$(code "$CFG" | grep -cF "$pair")
  [ "$N" = "1" ] || { echo "ERROR: '$pair' appears $N times, expected exactly 1. Aborting"; exit 1; }
done
echo "      all three names present, each exactly once."

# The footer hint must name the template as the source of questions.
code "$CFG" | grep -qF 'Questions come from the audit template. Set how each one scores.' \
  || { echo "ERROR: the footer hint was not replaced. Aborting"; exit 1; }
! code "$CFG" | grep -q 'configuring the audit content' \
  || { echo "ERROR: the stale 'audit content' hint is still present. Aborting"; exit 1; }
echo "      the hand-off explains where questions actually come from."

# The empty state is the clearest statement of the distinction; it must survive.
code "$CFG" | grep -qF 'Questions come from the audit template an audit is created' \
  || { echo "ERROR: the empty state explanation is gone. Aborting"; exit 1; }
echo "      the empty state still explains template inheritance."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
for want in 'How questions are scored' 'Set question rules' 'Question Scoring Rules' \
            'Questions come from the audit template. Set how each one scores.'; do
  grep -rqF "$want" .next/server .next/static 2>/dev/null \
    || { echo "ERROR: '$want' absent from the bundle. Aborting"; exit 1; }
done
! grep -rqF 'Configure Questions' .next/server .next/static 2>/dev/null \
  || { echo "ERROR: 'Configure Questions' is still compiled in. Aborting"; exit 1; }
! grep -rqF 'configuring the audit content' .next/server .next/static 2>/dev/null \
  || { echo "ERROR: the stale hint is still compiled in. Aborting"; exit 1; }
echo "      new wording compiled in; the old label is gone from the bundle."

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
[ "$CODE" = "200" ] && echo "== SCORING WORDING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
