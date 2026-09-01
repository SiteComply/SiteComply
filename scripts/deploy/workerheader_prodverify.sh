#!/usr/bin/env bash
# Production verification for the worker header fix.
#
# The worker portal is behind SMS sign-in, so the geometry cannot be measured in
# production from here. What CAN be established is that the exact code producing
# that geometry is what is serving: the dedupe, the flexible classes, and the
# absence of the fixed width whose return would reinstate the overlap.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"
BASE="https://${APP}.azurewebsites.net"
CUSTOM="https://app.sitecomply.co.uk"

fails=0
chk(){ [ "$2" = 1 ] && echo "  PASS  $1${3:+ — $3}" || { echo "  FAIL  $1${3:+ — $3}"; fails=$((fails+1)); }; }
TOK=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || { echo "no az token"; exit 1; }
kudu(){ curl -s --max-time 45 -H "Authorization: Bearer $TOK" "${SCM}/api/vfs/site/wwwroot/$1" 2>/dev/null; }
st(){ curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$1"; }

echo "== WORKER HEADER — PRODUCTION VERIFICATION =="
echo
echo "-- service --"
chk "health 200" "$([ "$(st $BASE/api/health)" = 200 ] && echo 1 || echo 0)"
chk "app root reachable" "$([ "$(st $BASE/)" = 200 ] && echo 1 || echo 0)"
chk "custom domain healthy" "$([ "$(st $CUSTOM/api/health)" = 200 ] && echo 1 || echo 0)"

echo
echo "-- build --"
L=$(tr -d '[:space:]' < .next/BUILD_ID); P=$(kudu ".next/BUILD_ID" | tr -d '[:space:]')
chk "prod build id matches what we shipped" "$([ "$L" = "$P" ] && echo 1 || echo 0)" "$P"

echo
echo "-- worker routes still guarded, not broken --"
for r in /worker/dashboard /worker/permits /worker/emergency /check-in; do
  S=$(st "$BASE$r")
  chk "$r responds without erroring" "$([ "$S" = 200 ] || [ "$S" = 302 ] || [ "$S" = 307 ] && echo 1 || echo 0)" "HTTP $S"
done

echo
echo "-- the header code, read off the prod disk --"
FILES=$(grep -rlF 'Switch site' .next/server 2>/dev/null | head -8)
[ -n "$FILES" ] || { echo "  FAIL  local build carries nothing to look for"; exit 1; }
read_ok=0; flex_sel=0; flex_wrap=0; dedupe=0; old_fixed=0
for f in $FILES $(grep -rlF 'jobSiteId===' .next/server 2>/dev/null | head -6); do
  body=$(kudu "$f"); case "$body" in ''|*'"Message":"Not found'*|*'<title>404'*) continue;; esac
  read_ok=$((read_ok+1))
  printf '%s' "$body" | grep -qF 'Switch site' && flex_sel=1
  printf '%s' "$body" | grep -qF 'rounded-lg border border-line bg-surface px-3' && flex_wrap=1
  printf '%s' "$body" | grep -qF 'max-w-[12rem] truncate rounded-lg' && old_fixed=1
done
chk "read the compiled worker chunks off the prod disk" "$([ "$read_ok" -ge 1 ] && echo 1 || echo 0)" "$read_ok chunk(s)"
[ "$read_ok" -ge 1 ] || { echo; echo "== ABORTED — nothing read, the checks below would be vacuous =="; exit 1; }
chk "the \"Switch site\" affordance is deployed" "$flex_sel"
chk "the bounded control chrome is deployed" "$flex_wrap"
chk "S2: the old fixed 12rem width is NOT deployed" "$([ "$old_fixed" = 0 ] && echo 1 || echo 0)"

# S1's dedupe compiles into the dashboard service chunk.
DFILES=$(grep -rlF 'findIndex(' .next/server 2>/dev/null | head -10)
d_ok=0; d_found=0
for f in $DFILES; do
  body=$(kudu "$f"); case "$body" in ''|*'"Message":"Not found'*) continue;; esac
  d_ok=$((d_ok+1))
  printf '%s' "$body" | grep -qE 'findIndex\([a-z]+=>[a-z]+\.jobSiteId===[a-z]+\.jobSiteId\)===' && d_found=1
done
chk "read the service chunks off the prod disk" "$([ "$d_ok" -ge 1 ] && echo 1 || echo 0)" "$d_ok chunk(s)"
chk "S1: the site dedupe is deployed" "$d_found"

echo
[ "$fails" = 0 ] && echo "== ALL PRODUCTION CHECKS PASSED ==" || { echo "== $fails CHECK(S) FAILED =="; exit 1; }
