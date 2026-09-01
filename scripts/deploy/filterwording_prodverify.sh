#!/usr/bin/env bash
# Production verification for the filter default wording change.
#
# Wording-only, so the evidence is the strings themselves, read out of the
# bundle running in production. Every absence check is paired with a presence
# check over the SAME fetched text, and a failure to read aborts rather than
# letting "absent" pass vacuously.
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

echo "== FILTER WORDING — PRODUCTION VERIFICATION =="
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
echo "-- the four pages still serve, and still filter --"
for r in documents actions audits permits; do
  S=$(status "${BASE}/platform/dashboard/$r")
  chk "/$r does not error" "$([ "$S" = 200 ] || [ "$S" = 302 ] || [ "$S" = 307 ] && echo 1 || echo 0)" "HTTP $S"
done
# The parameters must still be accepted exactly as before.
for qs in "?category=INSURANCE" "?category=" "?site=&expiry=expired"; do
  S=$(status "${BASE}/platform/dashboard/documents${qs}")
  chk "documents accepts ${qs}" "$([ "$S" = 200 ] || [ "$S" = 302 ] || [ "$S" = 307 ] && echo 1 || echo 0)" "HTTP $S"
done

echo
echo "-- the wording, read out of the DEPLOYED bundle --"
FILES=$(grep -rlE '"All sites"|children:"All"' .next/server 2>/dev/null | head -12)
[ -n "$FILES" ] || { echo "  FAIL  local build carries no wording to look for"; exit 1; }
read_ok=0; found_allsites=0; found_all=0; stale=""
for f in $FILES; do
  body=$(kudu "$f")
  case "$body" in ''|*'"Message":"Not found'*|*'<title>404'*) continue ;; esac
  read_ok=$((read_ok+1))
  printf '%s' "$body" | grep -qF '"All sites"' && found_allsites=1
  printf '%s' "$body" | grep -qF 'children:"All"' && found_all=1
  for old in 'All categories' 'All statuses' 'All priorities' 'All my sites' 'All Sites'; do
    printf '%s' "$body" | grep -qF "$old" && stale="$stale $old"
  done
done
chk "read the compiled chunks off the prod disk" "$([ "$read_ok" -ge 1 ] && echo 1 || echo 0)" "$read_ok of $(echo "$FILES" | wc -l)"
[ "$read_ok" -ge 1 ] || { echo; echo "== VERIFICATION ABORTED — nothing read, the checks below would be vacuous =="; exit 1; }
chk "the shortened \"All\" default is deployed" "$found_all"
chk "the unlabelled selects still read \"All sites\"" "$found_allsites"
chk "no retired wording left in production" "$([ -z "$stale" ] && echo 1 || echo 0)" "${stale:-none}"

echo
[ "$fails" = 0 ] && echo "== ALL PRODUCTION CHECKS PASSED ==" || { echo "== $fails CHECK(S) FAILED =="; exit 1; }
