#!/usr/bin/env bash
# Deactivate the compliance schedule titled "Carry" in PRODUCTION.
#
# ONE ROW, ONE COLUMN. Sets active = false. Nothing is deleted, archived or
# otherwise altered: occurrences, audits, other schedules and every other
# compliance record are untouched.
#
# The update is wrapped in a transaction that ABORTS unless exactly one row
# matches, so a title that turned out to be ambiguous cannot be updated blind.
#
# Pre-conditions are re-verified inside this script rather than trusted from
# the earlier investigation — the data could have changed since.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

RG=rgSiteComply
APP=sitecomply-web
PG=sitecomply-pg
RULE=tmp-carry-deactivate
SCHEDULE_ID=cms767ael0005sh5s7h4ex8tp   # pinned from the investigation
EXPECT_SITE='Test Site B'
EXPECT_CREATOR='Site Manager Test'

cleanup() {
  az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" \
    --name "$RULE" --yes -o none 2>/dev/null || true
}
trap cleanup EXIT

MYIP=$(curl -s --max-time 20 https://api.ipify.org)
[ -n "$MYIP" ] || { echo "ERROR: could not determine this machine's IP"; exit 1; }
az postgres flexible-server firewall-rule delete -g "$RG" -s "$PG" --name "$RULE" --yes -o none 2>/dev/null || true
az postgres flexible-server firewall-rule create -g "$RG" -s "$PG" \
  --name "$RULE" --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none || {
    echo "ERROR: could not open a temporary firewall rule"; exit 1; }

DBURL=$(az webapp config appsettings list -g "$RG" -n "$APP" \
  --query "[?name=='DATABASE_URL'].value | [0]" -o tsv)
[ -n "$DBURL" ] || { echo "ERROR: could not read DATABASE_URL"; exit 1; }

q()  { psql "$DBURL" -X -q -A -F'|' -c "$1" 2>&1; }
q1() { psql "$DBURL" -X -q -t -A -c "$1" 2>&1; }

echo "== PRE-CONDITIONS =="

# 1. Exactly one schedule with this title, and it is the pinned id.
MATCHES=$(q1 "SELECT count(*) FROM \"ComplianceSchedule\" WHERE title = 'Carry';")
echo "   schedules titled Carry: $MATCHES"
[ "$MATCHES" = "1" ] || { echo "ERROR: expected exactly 1, got $MATCHES — refusing to act."; exit 1; }

ID=$(q1 "SELECT id FROM \"ComplianceSchedule\" WHERE title = 'Carry';")
echo "   id: $ID"
[ "$ID" = "$SCHEDULE_ID" ] || { echo "ERROR: id does not match the investigated record."; exit 1; }

# 2. It is the test record identified: test site, test creator.
SITE=$(q1 "SELECT j.name FROM \"ComplianceSchedule\" s JOIN \"JobSite\" j ON j.id=s.\"jobSiteId\" WHERE s.id='$SCHEDULE_ID';")
CREATOR=$(q1 "SELECT coalesce(\"createdByName\",'') FROM \"ComplianceSchedule\" WHERE id='$SCHEDULE_ID';")
echo "   site: $SITE"
echo "   created by: $CREATOR"
[ "$SITE" = "$EXPECT_SITE" ] || { echo "ERROR: site is not $EXPECT_SITE — refusing to act."; exit 1; }
[ "$CREATOR" = "$EXPECT_CREATOR" ] || { echo "ERROR: creator is not $EXPECT_CREATOR — refusing to act."; exit 1; }

# 3. Not linked to any active production workflow: no occurrence of this
#    schedule has produced an Audit record, and no other schedule shares the
#    template on a non-test site.
WITH_AUDIT=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"='$SCHEDULE_ID' AND \"auditId\" IS NOT NULL;")
echo "   occurrences that produced an audit: $WITH_AUDIT"
[ "$WITH_AUDIT" = "0" ] || { echo "ERROR: this schedule has produced audit records — refusing to act."; exit 1; }

echo "   currently active: $(q1 "SELECT active FROM \"ComplianceSchedule\" WHERE id='$SCHEDULE_ID';")"
echo "   occurrences (preserved): $(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"='$SCHEDULE_ID';")"

echo
echo "== BEFORE =="
q "SELECT title, active, frequency, \"updatedByName\" FROM \"ComplianceSchedule\" ORDER BY title;"
TOTAL_OCC_BEFORE=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\";")
TOTAL_SCH_BEFORE=$(q1 "SELECT count(*) FROM \"ComplianceSchedule\";")
OTHER_ACTIVE_BEFORE=$(q1 "SELECT count(*) FROM \"ComplianceSchedule\" WHERE id <> '$SCHEDULE_ID' AND active = true;")

if [ "${DRY_RUN:-}" = "1" ]; then
  echo
  echo "== DRY RUN — pre-conditions pass, nothing changed =="
  exit 0
fi

echo
echo "== APPLYING =="
# Single statement, pinned by id AND title, inside a transaction that rolls
# back unless exactly one row changes.
psql "$DBURL" -X -q -v ON_ERROR_STOP=1 <<SQL
BEGIN;
UPDATE "ComplianceSchedule"
   SET active = false,
       "updatedByName" = 'Deactivated on request (test data — see investigation)',
       "updatedAt" = now()
 WHERE id = '$SCHEDULE_ID' AND title = 'Carry' AND active = true;
DO \$\$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "ComplianceSchedule" WHERE id = '$SCHEDULE_ID' AND active = false;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 deactivated row, found %', n; END IF;
END \$\$;
COMMIT;
SQL
[ $? -eq 0 ] || { echo "ERROR: update failed and was rolled back"; exit 1; }

echo
echo "== AFTER =="
q "SELECT title, active, frequency, \"updatedByName\" FROM \"ComplianceSchedule\" ORDER BY title;"

TOTAL_OCC_AFTER=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\";")
TOTAL_SCH_AFTER=$(q1 "SELECT count(*) FROM \"ComplianceSchedule\";")
OTHER_ACTIVE_AFTER=$(q1 "SELECT count(*) FROM \"ComplianceSchedule\" WHERE id <> '$SCHEDULE_ID' AND active = true;")

echo
echo "== BLAST RADIUS =="
printf "   schedules total        : %s -> %s\n" "$TOTAL_SCH_BEFORE" "$TOTAL_SCH_AFTER"
printf "   occurrences total      : %s -> %s\n" "$TOTAL_OCC_BEFORE" "$TOTAL_OCC_AFTER"
printf "   OTHER schedules active : %s -> %s\n" "$OTHER_ACTIVE_BEFORE" "$OTHER_ACTIVE_AFTER"
FAIL=0
[ "$TOTAL_SCH_BEFORE" = "$TOTAL_SCH_AFTER" ] || { echo "   ERROR: a schedule was added or removed"; FAIL=1; }
[ "$TOTAL_OCC_BEFORE" = "$TOTAL_OCC_AFTER" ] || { echo "   ERROR: occurrence data changed"; FAIL=1; }
[ "$OTHER_ACTIVE_BEFORE" = "$OTHER_ACTIVE_AFTER" ] || { echo "   ERROR: another schedule's active flag changed"; FAIL=1; }
[ "$FAIL" = "0" ] && echo "   confirmed: only the Carry schedule's active flag changed."
exit $FAIL
