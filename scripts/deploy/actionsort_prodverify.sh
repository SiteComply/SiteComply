#!/usr/bin/env bash
# Production verification for Actions sorting.
#
# The live page is behind sign-in, so the evidence is the deployed bundle read
# back off the app's own disk. Every absence check is paired with a presence
# check over the SAME fetched text, and a 404 body aborts rather than letting
# absence pass vacuously.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
CUSTOM="https://app.sitecomply.co.uk"
CHUNK='.next/server/app/platform/dashboard/actions/page.js'

fails=0
chk() { [ "$2" = "1" ] && echo "  PASS  $1${3:+ — $3}" || { echo "  FAIL  $1${3:+ — $3}"; fails=$((fails+1)); }; }
TOK=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || { echo "no az token"; exit 1; }
kudu() { curl -s --max-time 45 -H "Authorization: Bearer $TOK" "${SCM}/api/vfs/site/wwwroot/$1" 2>/dev/null; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$1"; }

echo "== ACTIONS SORTING — PRODUCTION VERIFICATION =="
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
echo "-- routes guarded, not broken, sorted or not --"
S=$(status "${BASE}/platform/dashboard/actions")
chk "unauthenticated /actions does not error" \
  "$([ "$S" = 200 ] || [ "$S" = 302 ] || [ "$S" = 307 ] && echo 1 || echo 0)" "HTTP $S"
for qs in "?sort=assigned&dir=asc" "?sort=state&dir=desc" "?bucket=OPEN&sort=due&dir=desc&page=2" "?sort=nonsense&dir=sideways"; do
  S2=$(status "${BASE}/platform/dashboard/actions${qs}")
  chk "sorted URL handled the same way — ${qs}" "$([ "$S2" = "$S" ] && echo 1 || echo 0)" "HTTP $S2"
done

echo
echo "-- the deployed page chunk --"
BODY=$(kudu "$CHUNK")
case "$BODY" in
  ''|*'"Message":"Not found'*|*'<title>404'*)
    echo "  FAIL  could not read $CHUNK — every check below would be vacuous"
    echo; echo "== VERIFICATION ABORTED =="; exit 1 ;;
esac
echo "  PASS  read the compiled actions page chunk off the prod disk ($(printf '%s' "$BODY" | wc -c) bytes)"
for want in 'aria-sort' 'whitespace-nowrap'; do
  printf '%s' "$BODY" | grep -qF "$want" && ok=1 || ok=0
  chk "page chunk carries \"$want\"" "$ok"
done

echo
echo "-- the sort module, wherever it was bundled --"
COLS='{key:"action",label:"Action"},{key:"state",label:"State"},{key:"due",label:"Due"},{key:"assigned",label:"Assigned"}'
FILES=$(grep -rlF "$COLS" .next/server 2>/dev/null | head -8)
[ -n "$FILES" ] || { echo "  FAIL  local build carries no column list to look for"; exit 1; }
read_ok=0; found_cols=0; found_nulls=0; found_tie=0
for f in $FILES; do
  body=$(kudu "$f")
  case "$body" in ''|*'"Message":"Not found'*|*'<title>404'*) continue ;; esac
  read_ok=$((read_ok+1))
  printf '%s' "$body" | grep -qF "$COLS" && found_cols=1
  printf '%s' "$body" | grep -qF 'nulls:"last"' && found_nulls=1
  printf '%s' "$body" | grep -qF '{id:"asc"}' && found_tie=1
done
chk "read the sort module off the prod disk" "$([ "$read_ok" -ge 1 ] && echo 1 || echo 0)" "$read_ok of $(echo "$FILES" | wc -l)"
[ "$read_ok" -ge 1 ] || { echo; echo "== VERIFICATION ABORTED =="; exit 1; }
chk "all four sortable columns present, in order" "$found_cols"
chk "nulls-last ordering deployed" "$found_nulls"
chk "id tiebreaker deployed" "$found_tie"

echo
[ "$fails" = 0 ] && echo "== ALL PRODUCTION CHECKS PASSED ==" || { echo "== $fails CHECK(S) FAILED =="; exit 1; }
