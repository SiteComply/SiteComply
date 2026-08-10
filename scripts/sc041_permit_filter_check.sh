#!/usr/bin/env bash
# M-3 verification — permit register status filter.
#
# The invariant: for every status, the set of permits the filter RETURNS must
# equal the set of permits whose BADGE shows that status in the unfiltered
# register. Asserted against the rendered page, so it measures what a user
# sees rather than what the query happens to do.
set -uo pipefail
cd /home/cc-dev-1/sitecomply
export SESSION_SECRET=$(grep -m1 '^SESSION_SECRET=' .env | cut -d= -f2- | sed 's/^"//;s/"$//')
UID_=$1
T=$(node -e "
const {createHmac}=require('crypto');const n=Math.floor(Date.now()/1000);
const b=Buffer.from(JSON.stringify({typ:'platform',userId:process.argv[1],iat:n,exp:n+28800})).toString('base64url');
console.log(b+'.'+createHmac('sha256',process.env.SESSION_SECRET).update(b).digest('base64url'));" "$UID_")

# reference<TAB>badge for every row on the page, in reference order
rows() {
  curl -s -b "sc_platform=$T" "http://localhost:3000/platform/dashboard/permits?take=100${1:-}" \
  | node -e "
let h='';process.stdin.on('data',d=>h+=d).on('end',()=>{
  const out=[];
  const re=/<tr\b[\s\S]*?<\/tr>/g; let m;
  while((m=re.exec(h))){
    const tr=m[0];
    const ref=(tr.match(/>(M3-[A-Z-]+|[A-Z]{2,4}-[A-Z0-9-]+)</)||[])[1];
    const badge=(tr.match(/rounded-full[^>]*>\s*([A-Za-z ]+?)\s*</)||[])[1];
    if(ref&&badge) out.push(ref+'\t'+badge.trim());
  }
  console.log([...new Set(out)].sort().join('\n'));
});"
}

fails=0
chk() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; else echo "  FAIL  $1"; echo "        expected:"; echo "$3" | sed 's/^/          /'; echo "        actual:"; echo "$2" | sed 's/^/          /'; fails=$((fails+1)); fi; }

ALL=$(rows "")
echo "=== unfiltered register (what the user sees) ==="
echo "$ALL" | sed 's/^/  /'
echo

for S in APPROVED EXPIRED SUBMITTED REJECTED CLOSED UNDER_REVIEW; do
  WANT=$(echo "$ALL" | awk -F'\t' -v s="$S" '
    BEGIN{ lbl["APPROVED"]="Approved"; lbl["EXPIRED"]="Expired"; lbl["SUBMITTED"]="Awaiting approval";
           lbl["REJECTED"]="Rejected"; lbl["CLOSED"]="Closed"; lbl["UNDER_REVIEW"]="Under review" }
    $2==lbl[s]{print}')
  GOT=$(rows "&status=$S")
  chk "filter $S returns exactly the rows badged that way" "$GOT" "$WANT"
done

echo
echo "=== filter + search must still combine ==="
COMBO=$(rows "&status=EXPIRED&q=M3")
echo "$COMBO" | sed 's/^/  /'
EXPECT_COMBO=$(echo "$ALL" | awk -F'\t' '$2=="Expired" && $1 ~ /^M3-/{print}')
chk "status+search intersect (neither clause lost)" "$COMBO" "$EXPECT_COMBO"

echo
if [ "$fails" = "0" ]; then echo "== ALL PASSED =="; else echo "== $fails FAILED =="; fi
exit $fails
