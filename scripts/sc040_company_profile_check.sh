#!/usr/bin/env bash
# H-2 verification. Read/write against the LOCAL dev instance only.
#
# Proves three things:
#   1. a partial update leaves every unmentioned field untouched
#   2. saving one section cannot wipe another
#   3. an explicit clear ('') still nulls the field — the fix must not turn the
#      form into something that can never remove a value
set -uo pipefail
cd /home/cc-dev-1/sitecomply
PG=$HOME/.local/pgsql/usr/lib/postgresql/16/bin/psql
export LD_LIBRARY_PATH=$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}
DBU=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/^"//;s/"$//' | sed 's/[?&]schema=[^&]*//')
export SESSION_SECRET=$(grep -m1 '^SESSION_SECRET=' .env | cut -d= -f2- | sed 's/^"//;s/"$//')
UID_=$1
T=$(node -e "
const {createHmac}=require('crypto');const n=Math.floor(Date.now()/1000);
const b=Buffer.from(JSON.stringify({typ:'platform',userId:process.argv[1],iat:n,exp:n+28800})).toString('base64url');
console.log(b+'.'+createHmac('sha256',process.env.SESSION_SECRET).update(b).digest('base64url'));" "$UID_")

api() { curl -s -o /dev/null -w '%{http_code}' -b "sc_platform=$T" -X PATCH \
  -H 'content-type: application/json' -d "$1" http://localhost:3000/api/platform/company-profile; }

snap() { $PG "$DBU" -tAc "select
  coalesce(\"companyName\",'-')||'|'||coalesce(\"primaryEmail\",'-')||'|'||
  coalesce(\"primaryPhone\",'-')||'|'||coalesce(\"addressLine1\",'-')||'|'||
  coalesce(\"reportFooter\",'-')||'|'||coalesce(\"disclaimer\",'-')||'|'||
  coalesce(\"primaryColor\",'-')||'|'||coalesce(\"tagline\",'-')||'|'||
  \"packIncludeLogo\"||'|'||\"packIncludeCompanyInfo\"
  from \"CompanyConfig\""; }

fails=0
chk() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; else echo "  FAIL  $1"; echo "        expected: $3"; echo "        actual:   $2"; fails=$((fails+1)); fi; }

echo "=== seed a fully populated profile ==="
api '{"companyName":"Parry Structures Ltd","primaryEmail":"office@parry.example",
"primaryPhone":"01792 123456","addressLine1":"12 Kingsway","reportFooter":"Confidential - Parry Structures",
"disclaimer":"Issued under CDM 2015","primaryColor":"#38B54A","tagline":"Building safely",
"packIncludeLogo":true,"packIncludeCompanyInfo":true}' >/dev/null
BASE=$(snap); echo "  baseline: $BASE"
[ -n "$BASE" ] || { echo "  could not seed"; exit 1; }

echo
echo "=== 1. empty request must change nothing ==="
echo "  HTTP $(api '{}')"
chk "empty {} leaves the whole profile intact" "$(snap)" "$BASE"

echo
echo "=== 2. branding-only save must not touch company/contact/report fields ==="
echo "  HTTP $(api '{"primaryColor":"#00AEEF","tagline":"Safer sites"}')"
EXPECT=$(echo "$BASE" | awk -F'|' 'BEGIN{OFS="|"}{$7="#00aeef";$8="Safer sites";print}')
chk "only the two branding fields moved" "$(snap)" "$EXPECT"
BASE=$(snap)

echo
echo "=== 3. contact-only save must not touch branding or report footer ==="
echo "  HTTP $(api '{"primaryEmail":"hello@parry.example","primaryPhone":"01792 999888"}')"
EXPECT=$(echo "$BASE" | awk -F'|' 'BEGIN{OFS="|"}{$2="hello@parry.example";$3="01792 999888";print}')
chk "only the two contact fields moved" "$(snap)" "$EXPECT"
BASE=$(snap)

echo
echo "=== 4. close-out pack toggle must not be forced back on ==="
echo "  HTTP $(api '{"packIncludeLogo":false}')"
EXPECT=$(echo "$BASE" | awk -F'|' 'BEGIN{OFS="|"}{$9="false";print}')
chk "packIncludeLogo false persisted" "$(snap)" "$EXPECT"
BASE=$(snap)
EXPECT=$(echo "$BASE" | awk -F'|' 'BEGIN{OFS="|"}{$1="Parry Structures Ltd";print}')
echo "  HTTP $(api '{"companyName":"Parry Structures Ltd"}')  (a save that omits the toggles)"
chk "omitted toggle stayed OFF" "$(snap)" "$EXPECT"
BASE=$(snap)

echo
echo "=== 5. an explicit clear must still null the field ==="
echo "  HTTP $(api '{"tagline":""}')"
EXPECT=$(echo "$BASE" | awk -F'|' 'BEGIN{OFS="|"}{$8="-";print}')
chk "explicitly cleared tagline is nulled" "$(snap)" "$EXPECT"

echo
echo "=== 6. validation still rejects bad input ==="
C=$(api '{"primaryEmail":"not-an-email"}'); chk "invalid email rejected (400)" "$C" "400"
C=$(api '{"primaryColor":"nonsense"}');    chk "invalid hex rejected (400)"   "$C" "400"

echo
if [ "$fails" = "0" ]; then echo "== ALL PASSED =="; else echo "== $fails FAILED =="; fi
exit $fails
