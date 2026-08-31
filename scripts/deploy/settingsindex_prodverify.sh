#!/usr/bin/env bash
# Production verification for the Settings index deploy.
#
# The live page is behind Azure AD, so this cannot sign in. Instead it proves
# the change is actually SERVING by reading the deployed bundle off the app's
# own disk through Kudu and asserting the new copy is in it and the old copy is
# not — which is stronger than a screenshot anyway, and does not need a session.
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
kudu() { curl -s --max-time 30 -H "Authorization: Bearer $TOK" "${SCM}/api/vfs/site/wwwroot/$1" 2>/dev/null; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$1"; }

echo "== SETTINGS INDEX — PRODUCTION VERIFICATION =="
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
echo "-- the settings route is guarded, not broken --"
S=$(status "${BASE}/admin/settings")
chk "unauthenticated /admin/settings does not error" \
  "$([ "$S" = 200 ] || [ "$S" = 302 ] || [ "$S" = 307 ] && echo 1 || echo 0)" "HTTP $S"
L=$(status "${BASE}/admin/login")
chk "admin sign-in page serves" "$([ "$L" = 200 ] && echo 1 || echo 0)" "HTTP $L"

echo
echo "-- the deployed bundle really is the new page --"
# Path discovered from the local build output; assert it exists in prod too.
> /tmp/settingsindex_chunks
grep -rlF 'CSCS onboarding pending' .next/server > /tmp/settingsindex_chunks 2>/dev/null
[ -s /tmp/settingsindex_chunks ] || { echo "  FAIL  local build has no chunk carrying the new copy"; exit 1; }

# The path is used VERBATIM: an earlier version stripped the ".next/" prefix, so
# every fetch 404'd. Kudu's 404 body is non-empty, which made the "absent" checks
# pass vacuously — a verification that proves nothing is worse than none, so the
# fetch now asserts it actually got the file.
found_new=0; found_old=0; checked=0
while IFS= read -r c; do
  [ -n "$c" ] || continue
  body=$(kudu "$c")
  case "$body" in
    ''|*'"Message":"Not found'*|*'<title>404'*)
      echo "  FAIL  could not read $c off the prod disk"; fails=$((fails+1)); continue ;;
  esac
  checked=$((checked+1))
  printf '%s' "$body" | grep -qF 'CSCS onboarding pending' && found_new=1
  printf '%s' "$body" | grep -qF 'Manage integrations' && found_old=1
  printf '%s' "$body" | grep -qF 'CSCS on mock provider' && found_old=1
done < /tmp/settingsindex_chunks
chk "read the compiled settings chunk off the prod disk" "$([ "$checked" -ge 1 ] && echo 1 || echo 0)" "$checked chunk(s)"
chk "new status copy is in the DEPLOYED bundle" "$found_new" ""
chk "old card CTA / mock wording absent from the DEPLOYED bundle" "$([ "$found_old" = 0 ] && echo 1 || echo 0)" ""

echo
[ "$fails" = 0 ] && echo "== ALL PRODUCTION CHECKS PASSED ==" || { echo "== $fails CHECK(S) FAILED =="; exit 1; }
