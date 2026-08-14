#!/usr/bin/env bash
# Remove the "Carry" schedule's NOT-DONE occurrences from production.
#
# SCOPE: this one schedule. No calendar filter, no display rule, no behaviour
# change — the calendar renders occurrence rows, so removing these rows is the
# only way to clear them without introducing filtering, which was ruled out.
#
# REMOVED : occurrences of the Carry schedule with status SCHEDULED
#           (generated placeholders for work that will never be performed).
# KEPT    : every COMPLETED occurrence — the evidence that work was done.
#           The Carry schedule row itself, deactivated, for audit.
#           Every other schedule, occurrence, audit and compliance record.
#
# A full JSON backup of every row being deleted is written BEFORE the delete,
# so the action is reversible.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

RG=rgSiteComply
APP=sitecomply-web
PG=sitecomply-pg
RULE=tmp-carry-occ
SCHEDULE_ID=cms767ael0005sh5s7h4ex8tp
BACKUP_DIR=${BACKUP_DIR:-/home/cc-dev-1/sitecomply/.carry-backup}

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
TITLE=$(q1 "SELECT title FROM \"ComplianceSchedule\" WHERE id='$SCHEDULE_ID';")
ACTIVE=$(q1 "SELECT active FROM \"ComplianceSchedule\" WHERE id='$SCHEDULE_ID';")
echo "   schedule: '$TITLE'  active=$ACTIVE"
[ "$TITLE" = "Carry" ] || { echo "ERROR: schedule $SCHEDULE_ID is not titled Carry — refusing."; exit 1; }
[ "$ACTIVE" = "f" ] || { echo "ERROR: schedule is still active — deactivate first."; exit 1; }

# Nothing being deleted may carry an audit link.
WITH_AUDIT=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"='$SCHEDULE_ID' AND status='SCHEDULED' AND \"auditId\" IS NOT NULL;")
echo "   SCHEDULED occurrences linked to an audit: $WITH_AUDIT"
[ "$WITH_AUDIT" = "0" ] || { echo "ERROR: some rows link to an audit — refusing to delete."; exit 1; }

echo
echo "== PLAN =="
echo "   TO REMOVE — Carry occurrences with status SCHEDULED:"
q "SELECT o.\"dueDateLocal\" AS due_date, o.status, coalesce(o.\"assigneeLabel\",'') AS assignee
     FROM \"ComplianceOccurrence\" o WHERE o.\"scheduleId\"='$SCHEDULE_ID' AND o.status='SCHEDULED'
    ORDER BY o.\"dueAt\";"
echo
echo "   TO KEEP — Carry occurrences with any other status:"
q "SELECT o.\"dueDateLocal\" AS due_date, o.status, o.\"completedAt\", coalesce(o.\"completedByName\",'') AS completed_by
     FROM \"ComplianceOccurrence\" o WHERE o.\"scheduleId\"='$SCHEDULE_ID' AND o.status <> 'SCHEDULED'
    ORDER BY o.\"dueAt\";"

REMOVE_N=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"='$SCHEDULE_ID' AND status='SCHEDULED';")
KEEP_N=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"='$SCHEDULE_ID' AND status<>'SCHEDULED';")
OTHER_N=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"<>'$SCHEDULE_ID';")
TOTAL_N=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\";")
echo
echo "   counts: remove=$REMOVE_N  keep(Carry)=$KEEP_N  other schedules=$OTHER_N  total=$TOTAL_N"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo
  echo "== DRY RUN — nothing changed =="
  exit 0
fi

echo
echo "== BACKUP =="
mkdir -p "$BACKUP_DIR"
STAMP=$(q1 "SELECT to_char(now(),'YYYYMMDD-HH24MISS');")
BACKUP_FILE="$BACKUP_DIR/carry-scheduled-occurrences-$STAMP.json"
psql "$DBURL" -X -q -t -A -c "
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (SELECT * FROM \"ComplianceOccurrence\"
           WHERE \"scheduleId\"='$SCHEDULE_ID' AND status='SCHEDULED'
           ORDER BY \"dueAt\") t;" > "$BACKUP_FILE"
BACKED=$(python3 -c "import json,sys; print(len(json.load(open('$BACKUP_FILE'))))" 2>/dev/null || echo 0)
echo "   $BACKED row(s) written to $BACKUP_FILE"
[ "$BACKED" = "$REMOVE_N" ] || { echo "ERROR: backup holds $BACKED rows, expected $REMOVE_N — refusing to delete."; exit 1; }

echo
echo "== APPLYING =="
psql "$DBURL" -X -q -v ON_ERROR_STOP=1 <<SQL
BEGIN;
DELETE FROM "ComplianceOccurrence"
 WHERE "scheduleId" = '$SCHEDULE_ID' AND status = 'SCHEDULED';
DO \$\$
DECLARE remaining int; kept int;
BEGIN
  SELECT count(*) INTO remaining FROM "ComplianceOccurrence"
    WHERE "scheduleId" = '$SCHEDULE_ID' AND status = 'SCHEDULED';
  IF remaining <> 0 THEN RAISE EXCEPTION 'SCHEDULED rows still present: %', remaining; END IF;
  SELECT count(*) INTO kept FROM "ComplianceOccurrence"
    WHERE "scheduleId" = '$SCHEDULE_ID';
  IF kept <> $KEEP_N THEN RAISE EXCEPTION 'expected % kept rows, found %', $KEEP_N, kept; END IF;
END \$\$;
COMMIT;
SQL
[ $? -eq 0 ] || { echo "ERROR: delete failed and was rolled back"; exit 1; }

echo
echo "== AFTER =="
echo "   Carry occurrences remaining:"
q "SELECT o.\"dueDateLocal\" AS due_date, o.status, o.\"completedAt\"
     FROM \"ComplianceOccurrence\" o WHERE o.\"scheduleId\"='$SCHEDULE_ID' ORDER BY o.\"dueAt\";"
echo
echo "   the schedule itself (retained, inactive):"
q "SELECT title, active, frequency, \"createdByName\", \"createdAt\"
     FROM \"ComplianceSchedule\" WHERE id='$SCHEDULE_ID';"

OTHER_AFTER=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"<>'$SCHEDULE_ID';")
SCHED_AFTER=$(q1 "SELECT count(*) FROM \"ComplianceSchedule\";")
AUDITS_AFTER=$(q1 "SELECT count(*) FROM \"Audit\";")
echo
echo "== BLAST RADIUS =="
printf "   other schedules' occurrences : %s -> %s\n" "$OTHER_N" "$OTHER_AFTER"
printf "   schedules total              : 2 -> %s\n" "$SCHED_AFTER"
printf "   audits total                 : %s\n" "$AUDITS_AFTER"
FAIL=0
[ "$OTHER_N" = "$OTHER_AFTER" ] || { echo "   ERROR: another schedule's occurrences changed"; FAIL=1; }
[ "$SCHED_AFTER" = "2" ]        || { echo "   ERROR: a schedule row was removed"; FAIL=1; }
[ "$FAIL" = "0" ] && echo "   confirmed: only Carry's SCHEDULED occurrences were removed."
exit $FAIL
