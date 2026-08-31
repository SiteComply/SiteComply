#!/usr/bin/env bash
# Production verification for the status-column removal.
#
# The live page is behind Azure AD and this machine cannot sign in, so instead
# of a screenshot this reads the compiled settings chunk back off the app's own
# disk through Kudu.
#
# Every absence check is paired with a presence check over the SAME fetched
# text, and a 404 body is rejected explicitly. That pairing is not decoration:
# the first version of the previous verifier requested a wrong path, and Kudu's
# 404 body is non-empty, so its "old copy absent" check passed while proving
# nothing at all.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
CUSTOM="https://app.sitecomply.co.uk"
CHUNK='.next/server/app/admin/(dashboard)/settings/page.js'   # used VERBATIM

fails=0
chk() { [ "$2" = "1" ] && echo "  PASS  $1${3:+ — $3}" || { echo "  FAIL  $1${3:+ — $3}"; fails=$((fails+1)); }; }

TOK=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || { echo "no az token"; exit 1; }
kudu() { curl -s --max-time 30 -H "Authorization: Bearer $TOK" "${SCM}/api/vfs/site/wwwroot/$1" 2>/dev/null; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$1"; }

echo "== SETTINGS INDEX (NO STATUS) — PRODUCTION VERIFICATION =="
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
echo "-- the deployed settings chunk --"
BODY=$(kudu "$CHUNK")
case "$BODY" in
  ''|*'"Message":"Not found'*|*'<title>404'*)
    echo "  FAIL  could not read $CHUNK off the prod disk — everything below would be vacuous"
    echo; echo "== VERIFICATION ABORTED =="; exit 1 ;;
esac
echo "  PASS  read the compiled settings chunk off the prod disk ($(printf '%s' "$BODY" | wc -c) bytes)"

# Presence — proves we are reading the right file and it is the settings index.
for want in 'Platform configuration' 'Organisation' 'Integrations' 'Authentication' 'Notifications' 'Company'; do
  printf '%s' "$BODY" | grep -qF "$want" && ok=1 || ok=0
  chk "still serves \"$want\"" "$ok"
done

# Absence — meaningful only because the presence checks above passed on this text.
for gone in 'CSCS onboarding pending' 'Using built-in defaults' 'Profile and branding set' 'Read-only'; do
  printf '%s' "$BODY" | grep -qF "$gone" && ok=0 || ok=1
  chk "status string \"$gone\" is gone" "$ok"
done

echo
[ "$fails" = 0 ] && echo "== ALL PRODUCTION CHECKS PASSED ==" || { echo "== $fails CHECK(S) FAILED =="; exit 1; }
