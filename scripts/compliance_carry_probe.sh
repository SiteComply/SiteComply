#!/usr/bin/env bash
# READ-ONLY production probe — compliance schedules and their occurrences.
#
# Investigation for the "Carry" activities seen in the Compliance Calendar.
# SELECT statements only. Nothing is created, updated, archived or deleted.
#
# Uses the same access pattern as the deploy scripts' migration pre-flight: a
# temporary firewall rule for this machine, removed again on exit including on
# failure, via a trap set BEFORE the rule is created.
set -uo pipefail
export PATH="$HOME/.local/pgsql/usr/lib/postgresql/16/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/pgsql/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

RG=rgSiteComply
APP=sitecomply-web
PG=sitecomply-pg
RULE=tmp-carry-probe

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

q() { psql "$DBURL" -X -q -A -F'|' -c "$1" 2>&1; }

echo "=============================================================="
echo " READ-ONLY PROBE — compliance schedules in PRODUCTION"
echo "=============================================================="
echo
echo "--- 1. how many schedules and occurrences exist at all ---"
q "SELECT
     (SELECT count(*) FROM \"ComplianceSchedule\")  AS schedules,
     (SELECT count(*) FROM \"ComplianceOccurrence\") AS occurrences,
     (SELECT count(*) FROM \"AuditTemplate\")        AS audit_templates;"

echo
echo "--- 2. every schedule: title, template, frequency, creator, created ---"
q "SELECT s.title,
          t.name          AS template_name,
          s.frequency,
          s.\"intervalDays\" AS every_n_days,
          s.weekdays,
          s.\"dayOfMonth\"   AS day_of_month,
          s.\"timeOfDay\"    AS time_of_day,
          s.active,
          j.name          AS site,
          coalesce(s.\"createdByName\", '(null)') AS created_by,
          coalesce(s.\"createdByUserId\", '(null)') AS created_by_id,
          s.\"createdAt\",
          s.\"startDate\",
          s.\"activatedAt\"
     FROM \"ComplianceSchedule\" s
     JOIN \"AuditTemplate\" t ON t.id = s.\"auditTemplateId\"
     JOIN \"JobSite\" j       ON j.id = s.\"jobSiteId\"
    ORDER BY s.\"createdAt\";"

echo
echo "--- 3. occurrences per schedule, with date range ---"
q "SELECT s.title,
          count(o.id)      AS occurrences,
          min(o.\"dueAt\")   AS first_due,
          max(o.\"dueAt\")   AS last_due,
          count(*) FILTER (WHERE o.status = 'COMPLETED') AS completed
     FROM \"ComplianceSchedule\" s
     LEFT JOIN \"ComplianceOccurrence\" o ON o.\"scheduleId\" = s.id
    GROUP BY s.title
    ORDER BY 2 DESC;"

echo
echo "--- 4. the audit templates these schedules point at ---"
q "SELECT t.id, t.name,
          coalesce(t.\"createdByName\", '(null)') AS created_by,
          t.\"createdAt\"
     FROM \"AuditTemplate\" t
    WHERE t.id IN (SELECT \"auditTemplateId\" FROM \"ComplianceSchedule\")
    ORDER BY t.\"createdAt\";"

echo
echo "--- 5. platform users, to identify the creator ---"
q "SELECT id, name, email, role, status, \"createdAt\" FROM \"PlatformUser\" ORDER BY \"createdAt\";"

echo
echo "--- 6. scheduler runs (what has been generating occurrences) ---"
q "SELECT * FROM \"SchedulerRun\" ORDER BY 1 DESC LIMIT 10;"

echo
echo "=============================================================="
echo " probe complete — no rows were modified"
echo "=============================================================="
