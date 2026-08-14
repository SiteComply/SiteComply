#!/usr/bin/env bash
# Remove the "Carry" compliance schedule and its remaining occurrences.
#
# Option B: delete the schedule row. ComplianceOccurrence.scheduleId is
# onDelete: Cascade, so its 3 COMPLETED occurrences go with it in one
# statement — nothing is orphaned and "Carry" leaves every surface, including
# the Schedules page where an inactive schedule is still listed.
#
# CONFIRMED BEFORE WRITING THIS: none of the occurrences links to an Audit
# (auditId is null on all three; the only occurrence in the system with an
# audit link belongs to PPE Compliance), and close-out packs do not reference
# ComplianceOccurrence at all — so no audit record and no pack is affected.
#
# A full JSON backup of the schedule AND its occurrences is written first, and
# the delete is refused unless the backup matches the rows about to go.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

RG=rgSiteComply
APP=sitecomply-web
PG=sitecomply-pg
RULE=tmp-carry-sched
SCHEDULE_ID=cms767ael0005sh5s7h4ex8tp
PPE_TITLE='PPE Compliance'
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
TITLE=$(q1  "SELECT title  FROM \"ComplianceSchedule\" WHERE id='$SCHEDULE_ID';")
ACTIVE=$(q1 "SELECT active FROM \"ComplianceSchedule\" WHERE id='$SCHEDULE_ID';")
SITE=$(q1   "SELECT j.name FROM \"ComplianceSchedule\" s JOIN \"JobSite\" j ON j.id=s.\"jobSiteId\" WHERE s.id='$SCHEDULE_ID';")
echo "   schedule '$TITLE'  active=$ACTIVE  site='$SITE'"
[ "$TITLE"  = "Carry" ]        || { echo "ERROR: not the Carry schedule — refusing."; exit 1; }
[ "$ACTIVE" = "f" ]            || { echo "ERROR: schedule is still active — refusing."; exit 1; }
[ "$SITE"   = "Test Site B" ]  || { echo "ERROR: not on Test Site B — refusing."; exit 1; }

WITH_AUDIT=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"='$SCHEDULE_ID' AND \"auditId\" IS NOT NULL;")
echo "   its occurrences linked to an audit: $WITH_AUDIT"
[ "$WITH_AUDIT" = "0" ] || { echo "ERROR: an occurrence links to an audit — refusing."; exit 1; }

# Baselines for everything that must NOT change.
SCH_BEFORE=$(q1 "SELECT count(*) FROM \"ComplianceSchedule\";")
OCC_BEFORE=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\";")
CARRY_OCC=$(q1  "SELECT count(*) FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"='$SCHEDULE_ID';")
PPE_OCC_BEFORE=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" o JOIN \"ComplianceSchedule\" s ON s.id=o.\"scheduleId\" WHERE s.title='$PPE_TITLE';")
AUDITS_BEFORE=$(q1 "SELECT count(*) FROM \"Audit\";")
PACKS_BEFORE=$(q1  "SELECT count(*) FROM \"CloseOutPack\";")

echo
echo "== PLAN =="
echo "   TO REMOVE — the schedule:"
q "SELECT title, active, frequency, \"createdByName\", \"createdAt\" FROM \"ComplianceSchedule\" WHERE id='$SCHEDULE_ID';"
echo "   TO REMOVE — its occurrences (cascade):"
q "SELECT \"dueDateLocal\", status, \"completedAt\", \"completedByName\"
     FROM \"ComplianceOccurrence\" WHERE \"scheduleId\"='$SCHEDULE_ID' ORDER BY \"dueAt\";"
echo
echo "   MUST SURVIVE UNCHANGED:"
printf "     schedules total     %s -> expect %s\n" "$SCH_BEFORE" "$((SCH_BEFORE-1))"
printf "     occurrences total   %s -> expect %s\n" "$OCC_BEFORE" "$((OCC_BEFORE-CARRY_OCC))"
printf "     PPE occurrences     %s -> expect %s\n" "$PPE_OCC_BEFORE" "$PPE_OCC_BEFORE"
printf "     audits              %s -> expect %s\n" "$AUDITS_BEFORE" "$AUDITS_BEFORE"
printf "     close-out packs     %s -> expect %s\n" "$PACKS_BEFORE" "$PACKS_BEFORE"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo
  echo "== DRY RUN — nothing changed =="
  exit 0
fi

echo
echo "== BACKUP =="
mkdir -p "$BACKUP_DIR"
STAMP=$(q1 "SELECT to_char(now(),'YYYYMMDD-HH24MISS');")
BF="$BACKUP_DIR/carry-schedule-and-occurrences-$STAMP.json"
psql "$DBURL" -X -q -t -A -c "
  SELECT json_build_object(
    'schedule',    (SELECT row_to_json(s) FROM \"ComplianceSchedule\" s WHERE s.id='$SCHEDULE_ID'),
    'occurrences', (SELECT coalesce(json_agg(row_to_json(o) ORDER BY o.\"dueAt\"), '[]'::json)
                      FROM \"ComplianceOccurrence\" o WHERE o.\"scheduleId\"='$SCHEDULE_ID')
  );" > "$BF"
OK=$(python3 - "$BF" "$CARRY_OCC" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); exp=int(sys.argv[2])
s=d.get('schedule'); o=d.get('occurrences') or []
print('OK' if s and s.get('title')=='Carry' and len(o)==exp else 'BAD')
PY
)
echo "   backup: $BF"
echo "   contains: schedule + $(python3 -c "import json,sys;print(len(json.load(open('$BF'))['occurrences']))") occurrence(s)  [$OK]"
[ "$OK" = "OK" ] || { echo "ERROR: backup does not match the rows to be deleted — refusing."; exit 1; }

echo
echo "== APPLYING =="
psql "$DBURL" -X -q -v ON_ERROR_STOP=1 <<SQL
BEGIN;
DELETE FROM "ComplianceSchedule" WHERE id = '$SCHEDULE_ID' AND title = 'Carry' AND active = false;
DO \$\$
DECLARE sch int; occ int; ppe int; aud int; pk int;
BEGIN
  SELECT count(*) INTO sch FROM "ComplianceSchedule"   WHERE id = '$SCHEDULE_ID';
  IF sch <> 0 THEN RAISE EXCEPTION 'Carry schedule still present'; END IF;
  SELECT count(*) INTO occ FROM "ComplianceOccurrence" WHERE "scheduleId" = '$SCHEDULE_ID';
  IF occ <> 0 THEN RAISE EXCEPTION 'Carry occurrences still present: %', occ; END IF;
  SELECT count(*) INTO ppe FROM "ComplianceOccurrence" o
    JOIN "ComplianceSchedule" s ON s.id = o."scheduleId" WHERE s.title = '$PPE_TITLE';
  IF ppe <> $PPE_OCC_BEFORE THEN RAISE EXCEPTION 'PPE occurrences changed: % (expected %)', ppe, $PPE_OCC_BEFORE; END IF;
  SELECT count(*) INTO aud FROM "Audit";
  IF aud <> $AUDITS_BEFORE THEN RAISE EXCEPTION 'audit count changed: %', aud; END IF;
  SELECT count(*) INTO pk FROM "CloseOutPack";
  IF pk <> $PACKS_BEFORE THEN RAISE EXCEPTION 'close-out pack count changed: %', pk; END IF;
END \$\$;
COMMIT;
SQL
[ $? -eq 0 ] || { echo "ERROR: delete failed and was rolled back"; exit 1; }

echo
echo "== AFTER =="
echo "   any row anywhere still titled Carry:"
q "SELECT 'schedule' AS kind, title FROM \"ComplianceSchedule\" WHERE title ILIKE '%carry%'
   UNION ALL
   SELECT 'audit', title FROM \"Audit\" WHERE title ILIKE '%carry%'
   UNION ALL
   SELECT 'audit template', name FROM \"AuditTemplate\" WHERE name ILIKE '%carry%';"
echo "   remaining schedules:"
q "SELECT s.title, s.active, j.name AS site FROM \"ComplianceSchedule\" s JOIN \"JobSite\" j ON j.id=s.\"jobSiteId\" ORDER BY s.title;"
echo "   remaining occurrences:"
q "SELECT s.title, o.status, count(*) FROM \"ComplianceOccurrence\" o
     JOIN \"ComplianceSchedule\" s ON s.id=o.\"scheduleId\" GROUP BY 1,2 ORDER BY 1,2;"

SCH_AFTER=$(q1 "SELECT count(*) FROM \"ComplianceSchedule\";")
OCC_AFTER=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\";")
PPE_AFTER=$(q1 "SELECT count(*) FROM \"ComplianceOccurrence\" o JOIN \"ComplianceSchedule\" s ON s.id=o.\"scheduleId\" WHERE s.title='$PPE_TITLE';")
AUD_AFTER=$(q1 "SELECT count(*) FROM \"Audit\";")
PACK_AFTER=$(q1 "SELECT count(*) FROM \"CloseOutPack\";")
echo
echo "== BLAST RADIUS =="
printf "   schedules      %s -> %s\n" "$SCH_BEFORE" "$SCH_AFTER"
printf "   occurrences    %s -> %s\n" "$OCC_BEFORE" "$OCC_AFTER"
printf "   PPE occurrences %s -> %s\n" "$PPE_OCC_BEFORE" "$PPE_AFTER"
printf "   audits         %s -> %s\n" "$AUDITS_BEFORE" "$AUD_AFTER"
printf "   close-out packs %s -> %s\n" "$PACKS_BEFORE" "$PACK_AFTER"
F=0
[ "$SCH_AFTER"  = "$((SCH_BEFORE-1))" ]          || { echo "   ERROR: wrong number of schedules removed"; F=1; }
[ "$OCC_AFTER"  = "$((OCC_BEFORE-CARRY_OCC))" ]  || { echo "   ERROR: wrong number of occurrences removed"; F=1; }
[ "$PPE_AFTER"  = "$PPE_OCC_BEFORE" ]            || { echo "   ERROR: PPE Compliance was affected"; F=1; }
[ "$AUD_AFTER"  = "$AUDITS_BEFORE" ]             || { echo "   ERROR: audits changed"; F=1; }
[ "$PACK_AFTER" = "$PACKS_BEFORE" ]              || { echo "   ERROR: close-out packs changed"; F=1; }
[ "$F" = "0" ] && echo "   confirmed: only the Carry schedule and its occurrences were removed."
exit $F
