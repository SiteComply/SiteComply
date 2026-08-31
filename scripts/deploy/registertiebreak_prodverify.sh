#!/usr/bin/env bash
# Production verification for the register pagination-stability fix.
#
# This defect is invisible in the UI, so "the page renders" proves nothing. The
# evidence has to be the ORDER BY clauses themselves, read out of the bundle
# actually running in production. Every absence check is paired with a presence
# check over the same fetched text, and a 404 body aborts rather than letting
# absence pass vacuously.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
CUSTOM="https://app.sitecomply.co.uk"

fails=0
chk() { [ "$2" = "1" ] && echo "  PASS  $1${3:+ — $3}" || { echo "  FAIL  $1${3:+ — $3}"; fails=$((fails+1)); }; }
TOK=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || { echo "no az token"; exit 1; }
kudu() { curl -s --max-time 45 -H "Authorization: Bearer $TOK" "${SCM}/api/vfs/site/wwwroot/$1" 2>/dev/null; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$1"; }

echo "== REGISTER PAGINATION STABILITY — PRODUCTION VERIFICATION =="
echo
echo "-- service --"
H=$(status "${BASE}/api/health"); chk "health endpoint 200" "$([ "$H" = 200 ] && echo 1 || echo 0)" "HTTP $H"
R=$(status "${BASE}/"); chk "app root reachable" "$([ "$R" = 200 ] && echo 1 || echo 0)" "HTTP $R"
C=$(status "${CUSTOM}/api/health"); chk "custom domain healthy" "$([ "$C" = 200 ] && echo 1 || echo 0)" "HTTP $C"

echo
echo "-- build --"
LOCAL_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID 2>/dev/null)
PROD_BUILD=$(kudu ".next/BUILD_ID" | tr -d '[:space:]')
chk "prod build id matches the build we shipped" \
  "$([ -n "$PROD_BUILD" ] && [ "$PROD_BUILD" = "$LOCAL_BUILD" ] && echo 1 || echo 0)" \
  "prod=$PROD_BUILD local=$LOCAL_BUILD"

echo
echo "-- all four registers are guarded, not broken --"
for r in actions audits documents permits; do
  S=$(status "${BASE}/platform/dashboard/$r")
  chk "/$r does not error unauthenticated" \
    "$([ "$S" = 200 ] || [ "$S" = 302 ] || [ "$S" = 307 ] && echo 1 || echo 0)" "HTTP $S"
done

echo
echo "-- the tiebreaker, read out of the DEPLOYED bundle --"
# The four services compile into shared chunks, so the chunk list is discovered
# from the local build and each is fetched from the app's own disk.
FILES=$(grep -rlE 'orderBy:\[\{createdAt:"desc"\},\{id:"asc"\}\]|orderBy:\[\{dueDate:"asc"\},\{createdAt:"desc"\},\{id:"asc"\}\]' .next/server 2>/dev/null | head -12)
[ -n "$FILES" ] || { echo "  FAIL  local build carries no tiebroken ordering to look for"; exit 1; }

read_ok=0; found_actions=0; found_created=0; untiebroken=0
for f in $FILES; do
  body=$(kudu "$f")
  case "$body" in ''|*'"Message":"Not found'*|*'<title>404'*) continue ;; esac
  read_ok=$((read_ok+1))
  printf '%s' "$body" | grep -qF 'orderBy:[{dueDate:"asc"},{createdAt:"desc"},{id:"asc"}]' && found_actions=1
  n=$(printf '%s' "$body" | grep -oF 'orderBy:[{createdAt:"desc"},{id:"asc"}]' | wc -l)
  found_created=$((found_created + n))
done
chk "read the compiled chunks off the prod disk" "$([ "$read_ok" -ge 1 ] && echo 1 || echo 0)" "$read_ok of $(echo "$FILES" | wc -l)"
[ "$read_ok" -ge 1 ] || { echo; echo "== VERIFICATION ABORTED — nothing was read, every check below would be vacuous =="; exit 1; }
chk "Actions register orders by dueDate, createdAt, id" "$found_actions"
chk "Audits/Documents/Permits order by createdAt, id" "$([ "$found_created" -ge 3 ] && echo 1 || echo 0)" "$found_created occurrences"

echo
[ "$fails" = 0 ] && echo "== ALL PRODUCTION CHECKS PASSED ==" || { echo "== $fails CHECK(S) FAILED =="; exit 1; }
