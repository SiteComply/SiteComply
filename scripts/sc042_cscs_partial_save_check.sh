#!/usr/bin/env bash
# M-4 verification — CSCS Smart Check settings partial saves.
#
# Every CSCS setting must keep its value when the request omits it, while an
# explicitly supplied value still takes effect and the credential guard that
# refuses an unrunnable provider still holds.
set -uo pipefail
cd /home/cc-dev-1/sitecomply
PG=$HOME/.local/pgsql/usr/lib/postgresql/16/bin/psql
export LD_LIBRARY_PATH=$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}
DBU=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/^"//;s/"$//' | sed 's/[?&]schema=[^&]*//')
export SESSION_SECRET=$(grep -m1 '^SESSION_SECRET=' .env | cut -d= -f2- | sed 's/^"//;s/"$//')
A=$(node -e "
const {createHmac}=require('crypto');const n=Math.floor(Date.now()/1000);
const b=Buffer.from(JSON.stringify({typ:'admin',adminId:process.argv[1],email:'a@b.c',name:'M4 Audit',role:'OWNER',iat:n,exp:n+28800})).toString('base64url');
console.log(b+'.'+createHmac('sha256',process.env.SESSION_SECRET).update(b).digest('base64url'));" "$1")

api() { curl -s -o /dev/null -w '%{http_code}' -b "sc_admin=$A" -X POST \
  -H 'content-type: application/json' -d "$1" http://localhost:3000/api/admin/settings/cscs; }

snap() { $PG "$DBU" -tAc "select \"activeProvider\"||'|'||\"verificationEnabled\"||'|'||
  coalesce(\"smartCheckApiUrl\",'-')||'|'||(case when \"smartCheckApiKey\" is null then '-' else 'KEYSET' end)
  from \"CscsConfig\""; }

fails=0
chk() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; else echo "  FAIL  $1"; echo "        expected: $3"; echo "        actual:   $2"; fails=$((fails+1)); fi; }

echo "=== establish a known configuration ==="
# Credentials first, so smartcheck can legitimately be selected.
api '{"smartCheckApiUrl":"https://api.cscssmartcheck.example","smartCheckApiKey":"partner-key-abc"}' >/dev/null
api '{"activeProvider":"smartcheck","verificationEnabled":false}' >/dev/null
BASE=$(snap); echo "  baseline: $BASE"
chk "baseline is smartcheck, verification OFF, credentials stored" "$BASE" "smartcheck|false|https://api.cscssmartcheck.example|KEYSET"

echo
echo "=== 1. an empty request must change nothing ==="
echo "  HTTP $(api '{}')"
chk "empty {} leaves every CSCS setting intact" "$(snap)" "$BASE"

echo
echo "=== 2. saving ONLY the provider must not touch the master switch ==="
echo "  HTTP $(api '{"activeProvider":"mock"}')"
chk "provider changed, verificationEnabled preserved" "$(snap)" "mock|false|https://api.cscssmartcheck.example|KEYSET"
BASE=$(snap)

echo
echo "=== 3. saving ONLY the master switch must not touch the provider ==="
echo "  HTTP $(api '{"verificationEnabled":true}')"
chk "switch changed, provider preserved" "$(snap)" "mock|true|https://api.cscssmartcheck.example|KEYSET"
BASE=$(snap)

echo
echo "=== 4. an omitted switch must not be forced back on ==="
echo "  HTTP $(api '{"verificationEnabled":false}')"
chk "switch explicitly OFF" "$(snap)" "mock|false|https://api.cscssmartcheck.example|KEYSET"
echo "  HTTP $(api '{"activeProvider":"mock"}')  (a save that omits the switch)"
chk "omitted switch stayed OFF" "$(snap)" "mock|false|https://api.cscssmartcheck.example|KEYSET"

echo
echo "=== 5. credentials must survive a save that omits them ==="
echo "  HTTP $(api '{"activeProvider":"smartcheck","verificationEnabled":true}')"
chk "URL and key preserved, provider applied" "$(snap)" "smartcheck|true|https://api.cscssmartcheck.example|KEYSET"

echo
echo "=== 6. the credential guard must still refuse an unrunnable provider ==="
$PG "$DBU" -tAc "update \"CscsConfig\" set \"smartCheckApiKey\"=null, \"activeProvider\"='mock'" >/dev/null
C=$(api '{"activeProvider":"smartcheck"}')
chk "selecting smartcheck without a key is refused (400)" "$C" "400"
chk "the refusal did not change the provider" "$(snap | cut -d'|' -f1)" "mock"

echo
echo "=== 7. explicit values still take effect ==="
C=$(api '{"activeProvider":"not-a-provider"}'); chk "unknown provider rejected (400)" "$C" "400"
C=$(api '{"smartCheckApiUrl":"http://insecure.example"}'); chk "non-https URL rejected (400)" "$C" "400"

echo
if [ "$fails" = "0" ]; then echo "== ALL PASSED =="; else echo "== $fails FAILED =="; fi
exit $fails
