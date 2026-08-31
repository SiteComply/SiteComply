#!/usr/bin/env bash
# Production verification for Check-ins sorting.
#
# The live page is behind sign-in, so this reads the compiled chunk back off the
# app's own disk through Kudu. Every absence check is paired with a presence
# check over the SAME fetched text, and a 404 body aborts rather than letting
# "absent" pass vacuously.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
CUSTOM="https://app.sitecomply.co.uk"
CHUNK='.next/server/app/platform/dashboard/submissions/page.js'   # VERBATIM

fails=0
chk() { [ "$2" = "1" ] && echo "  PASS  $1${3:+ — $3}" || { echo "  FAIL  $1${3:+ — $3}"; fails=$((fails+1)); }; }
TOK=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || { echo "no az token"; exit 1; }
kudu() { curl -s --max-time 30 -H "Authorization: Bearer $TOK" "${SCM}/api/vfs/site/wwwroot/$1" 2>/dev/null; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$1"; }

echo "== CHECK-INS SORTING — PRODUCTION VERIFICATION =="
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
echo "-- routes are guarded, not broken --"
S=$(status "${BASE}/platform/dashboard/submissions")
chk "unauthenticated check-ins does not error" \
  "$([ "$S" = 200 ] || [ "$S" = 302 ] || [ "$S" = 307 ] && echo 1 || echo 0)" "HTTP $S"
S2=$(status "${BASE}/platform/dashboard/submissions?sort=site&dir=asc")
chk "a sorted URL is handled the same way" \
  "$([ "$S2" = "$S" ] && echo 1 || echo 0)" "HTTP $S2"
E=$(status "${BASE}/api/platform/submissions/export?sort=site&dir=asc")
chk "export refuses unauthenticated rather than erroring" \
  "$([ "$E" = 401 ] || [ "$E" = 403 ] || [ "$E" = 302 ] || [ "$E" = 307 ] && echo 1 || echo 0)" "HTTP $E"

echo
echo "-- the deployed check-ins chunk --"
BODY=$(kudu "$CHUNK")
case "$BODY" in
  ''|*'"Message":"Not found'*|*'<title>404'*)
    echo "  FAIL  could not read $CHUNK off the prod disk — every check below would be vacuous"
    echo; echo "== VERIFICATION ABORTED =="; exit 1 ;;
esac
echo "  PASS  read the compiled check-ins chunk off the prod disk ($(printf '%s' "$BODY" | wc -c) bytes)"

for want in 'aria-sort' 'whitespace-nowrap' 'Checked in' 'Worker' 'Site' 'Status'; do
  printf '%s' "$BODY" | grep -qF "$want" && ok=1 || ok=0
  chk "chunk carries \"$want\"" "$ok"
done

echo
echo "-- the sort service, as deployed --"
SBODY=$(kudu ".next/server/chunks/$(printf '%s' "$BODY" | grep -oE 'require\("\./([0-9]+)\.js"\)' | head -1 | grep -oE '[0-9]+').js" 2>/dev/null || true)
# The service is inlined or chunked depending on the build; assert on whichever
# text actually carries checkinOrderBy so this cannot pass by looking nowhere.
HAY="$BODY$SBODY"
printf '%s' "$HAY" | grep -qF 'checkedOutAt' && ok=1 || ok=0
chk "status ordering references checkedOutAt" "$ok"

echo
[ "$fails" = 0 ] && echo "== ALL PRODUCTION CHECKS PASSED ==" || { echo "== $fails CHECK(S) FAILED =="; exit 1; }
