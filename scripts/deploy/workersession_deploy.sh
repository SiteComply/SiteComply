#!/usr/bin/env bash
# Deploy: the active-site cookie tracks the configured worker session TTL.
#
# Paired with an app-setting change (WORKER_TTL_SECONDS=43200). The code change
# is what stops the site preference expiring at two hours while the session runs
# for twelve.
#
# Guards written fresh. What must hold: the cookie helper ACCEPTS a TTL, and
# every one of the three callers PASSES the configured value — a caller left
# behind would silently keep the two-hour fallback on that path only, which is
# exactly the class of bug this change exists to remove.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/workersession_deploy.zip
SESS='lib/session.ts'
CALLERS='app/api/worker/active-site/route.ts app/api/worker/submission/route.ts app/api/worker/express-checkin/route.ts'
DEPLOYED=cf50382

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

echo "== WORKER SESSION DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/api/worker/active-site/route.ts
app/api/worker/express-checkin/route.ts
app/api/worker/submission/route.ts
lib/session.ts
scripts/deploy/workersession_deploy.sh
scripts/worker_session_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the cookie helper, its three callers, and the scripts." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# The helper must take a TTL and fall back only when one is not supplied.
code "$SESS" | grep -qF 'export function setActiveWorkerSiteCookie(' \
  || { echo "ERROR: the active-site helper is missing. Aborting"; exit 1; }
code "$SESS" | grep -qF 'maxAgeSeconds && maxAgeSeconds > 0 ? maxAgeSeconds : WORKER_TTL_SECONDS' \
  || { echo "ERROR: the active-site cookie does not accept a TTL. Aborting"; exit 1; }
# It must appear TWICE now — once for the session cookie, once for active-site.
N=$(code "$SESS" | grep -c 'maxAgeSeconds && maxAgeSeconds > 0 ? maxAgeSeconds : WORKER_TTL_SECONDS')
[ "$N" = "2" ] \
  || { echo "ERROR: found $N TTL-aware cookies in session.ts, expected 2. Aborting"; exit 1; }
echo "      the helper takes a TTL, and both worker cookies are TTL-aware."

# EVERY caller must pass it. One missed caller keeps 2h on that path silently.
for f in $CALLERS; do
  code "$f" | grep -qF 'getAuthRuntimeConfig' \
    || { echo "ERROR: $f does not read the auth config. Aborting"; exit 1; }
  code "$f" | grep -qE 'setActiveWorkerSiteCookie\([^)]*workerSessionTtlSeconds' \
    || { echo "ERROR: $f does not pass the configured TTL. Aborting"; exit 1; }
done
# and no caller may still use the single-argument form
if code $CALLERS | grep -qE 'setActiveWorkerSiteCookie\((siteId|body\.siteId)\)'; then
  echo "ERROR: a caller still uses the 1-arg form (keeps the 2h fallback). Aborting"; exit 1
fi
echo "      all three callers pass the configured TTL; no 1-arg call sites left."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
# These are server route handlers, so they compile per route.
for r in active-site submission express-checkin; do
  F=".next/server/app/api/worker/${r}/route.js"
  [ -f "$F" ] || { echo "ERROR: $F not built. Aborting"; exit 1; }
  grep -qF 'workerSessionTtlSeconds' "$F" \
    || { echo "ERROR: ${r} route compiled WITHOUT the TTL. Aborting"; exit 1; }
done
echo "      all three compiled route handlers carry the configured TTL."

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
[ "$CODE" = "200" ] && echo "== WORKER SESSION DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
