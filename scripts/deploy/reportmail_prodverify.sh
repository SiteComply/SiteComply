#!/usr/bin/env bash
# End-to-end verification that report delivery is actually sending.
#
# The decisive number is `sent` from the first sweep. It is incremented only
# after Graph has ACCEPTED a message, so a non-zero value is proof the transport
# works — tenant, secret, consent and the Exchange access policy all correct.
# Everything before it is necessary but not sufficient.
#
# What this CANNOT prove: that the mail arrived in the mailbox. Graph accepting a
# message is not delivery. Only a human looking at tech@sitecomply.co.uk closes
# that last gap, and this script says so rather than implying otherwise.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
BASE=https://app.sitecomply.co.uk
SWEEP="$BASE/api/system/reports/deliver"
OUT=${1:-/tmp/reportmail_verify}
mkdir -p "$OUT"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS  $1${2:+ — $2}"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1${2:+ — $2}"; }

echo "== REPORT DELIVERY — END-TO-END VERIFICATION =="

echo; echo "[1] App settings"
NAMES=$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?starts_with(name,'REPORT_MAIL')].name" -o tsv 2>/dev/null | sort | tr '\n' ' ')
for want in REPORT_MAIL_TENANT_ID REPORT_MAIL_CLIENT_ID REPORT_MAIL_CLIENT_SECRET REPORT_MAIL_FROM REPORT_MAIL_TO; do
  echo "$NAMES" | grep -q "$want" && ok "$want is set" || bad "$want is MISSING"
done
# Values are never printed. The two that are not secret are worth confirming,
# because the commonest failure is the SUBSCRIPTION tenant instead of the
# mailbox tenant, and it presents as a confusing "app not found".
TEN=$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='REPORT_MAIL_TENANT_ID'].value" -o tsv 2>/dev/null)
[ "$TEN" = "6a8a12c9-ee28-4955-8164-0f61a4f8ad91" ] \
  && ok "the tenant is the MAILBOX tenant" "$TEN" \
  || bad "tenant is not the mailbox tenant" "got '${TEN:-<empty>}'"
FROM=$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='REPORT_MAIL_FROM'].value" -o tsv 2>/dev/null)
[ "$FROM" = "tech@sitecomply.co.uk" ] \
  && ok "sends as the mailbox named in the access policy" "$FROM" \
  || bad "REPORT_MAIL_FROM is not tech@sitecomply.co.uk" "got '${FROM:-<empty>}'"

echo; echo "[2] The app is up on the new settings"
for i in $(seq 1 30); do
  H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$BASE/api/health")
  [ "$H" = "200" ] && { ok "health is 200" "after ${i} check(s)"; break; }
  sleep 6
done
[ "$H" = "200" ] || bad "health never returned 200" "last=$H"

echo; echo "[3] Delivery reports itself as ENABLED"
SEC=$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='SCHEDULER_SECRET'].value" -o tsv 2>/dev/null)
[ -n "$SEC" ] || { bad "could not read SCHEDULER_SECRET"; echo "== $PASS passed, $FAIL failed =="; exit 1; }
R1=$(curl -s --max-time 180 -X POST -H "x-scheduler-secret: $SEC" "$SWEEP")
echo "      sweep: $R1"
echo "$R1" | grep -q '"mail":"enabled"' \
  && ok "the app can see all five settings" \
  || bad "still reports mail as disabled" "config is all-or-nothing; check for a blank or trailing space"

echo; echo "[4] THE DECISIVE CHECK — Graph actually accepted a message"
SENT=$(echo "$R1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('sent',0))" 2>/dev/null || echo 0)
CONS=$(echo "$R1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('considered',0))" 2>/dev/null || echo 0)
FAILED=$(echo "$R1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('failed',0))" 2>/dev/null || echo 0)
echo "      backlog: considered=$CONS sent=$SENT failed=$FAILED"
if [ "${SENT:-0}" -gt 0 ]; then
  ok "the transport works — Graph accepted $SENT message(s)" "tenant, secret, consent and access policy are all correct"
elif [ "${FAILED:-0}" -gt 0 ]; then
  bad "Graph REFUSED every message" "$FAILED failed — see the table in docs/ISSUE-REPORTING.md"
elif [ "${CONS:-0}" -eq 0 ]; then
  bad "there was nothing to send" "the backlog was already drained; file a report and re-run"
else
  bad "messages are still pending" "considered=$CONS but none sent"
fi

echo; echo "[5] A fresh report, filed the way a user files one"
node scripts/issuereport_prodverify.js "$OUT" 2>&1 | grep -E "a report is accepted|FAIL" | sed 's/^/    /'
REF=$(node -e "0" 2>/dev/null; true)

echo; echo "[6] The new report went out INLINE, not left for the timer"
sleep 5
R2=$(curl -s --max-time 180 -X POST -H "x-scheduler-secret: $SEC" "$SWEEP")
echo "      sweep: $R2"
C2=$(echo "$R2" | python3 -c "import json,sys;print(json.load(sys.stdin).get('considered',0))" 2>/dev/null || echo -1)
[ "${C2:-1}" -eq 0 ] \
  && ok "nothing was left pending" "the report was delivered as it was filed" \
  || bad "the new report was still pending" "considered=$C2 — inline delivery did not complete"

echo
echo "== $PASS passed, $FAIL failed =="
echo
echo "REMAINING, and only you can do it: confirm the emails arrived in"
echo "tech@sitecomply.co.uk. Graph accepting a message is not the same as it"
echo "landing in the mailbox."
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
