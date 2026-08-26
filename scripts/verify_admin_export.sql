-- ============================================================================
-- SiteComply — reconcile the Admin Check-ins screen and CSV export against the
-- production database.
--
-- READ-ONLY. Nothing is written, altered or locked.
--
-- Run from Azure Cloud Shell (its egress is already covered by the existing
-- AllowAllAzureServicesAndResourcesWithinAzureIps rule — no firewall change):
--
--   RAW=$(az webapp config appsettings list -g rgSiteComply -n sitecomply-web \
--           --query "[?name=='DATABASE_URL'].value" -o tsv)
--   DB=$(printf '%s' "$RAW" | sed -E 's/[?&]schema=[^&]*//')
--   psql "$DB" -f verify_admin_export.sql
--
-- The sed is required — psql rejects Prisma's ?schema= parameter.
--
-- Each row below is a number the UI or a CSV must match exactly. The mapping to
-- what you check in the browser is in the `check` column.
-- ============================================================================

\echo '--- 1. UNFILTERED: page total, and rows in an unfiltered CSV export ---'
SELECT
  'Admin > Check-ins with no filters' AS check,
  COUNT(*)                            AS expected_page_total,
  COUNT(*)                            AS expected_csv_data_rows,
  LEAST(COUNT(*), 1000)               AS expected_rows_listed_on_screen,
  CASE WHEN COUNT(*) > 1000
       THEN 'page MUST also say: Showing the first 1,000 - export CSV for all.'
       ELSE 'page must NOT show the "Showing the first..." notice'
  END                                 AS expected_notice
FROM "Submission";

\echo ''
\echo '--- 2. PER SITE: filter the page by each site, export, compare ---'
SELECT
  j.name                        AS site_filter,
  COUNT(s.id)                   AS expected_page_total,
  COUNT(s.id)                   AS expected_csv_data_rows,
  LEAST(COUNT(s.id), 1000)      AS expected_rows_listed
FROM "JobSite" j
LEFT JOIN "Submission" s ON s."jobSiteId" = j.id
GROUP BY j.name
ORDER BY COUNT(s.id) DESC;

\echo ''
\echo '--- 3. PER COMPLIANCE STATUS ---'
SELECT
  status::text                  AS status_filter,
  COUNT(*)                      AS expected_page_total,
  COUNT(*)                      AS expected_csv_data_rows
FROM "Submission"
GROUP BY status
ORDER BY 1;

\echo ''
\echo '--- 4. EXPORT CEILING: is any export near the 50,000 refusal threshold? ---'
SELECT
  COUNT(*)                                        AS total_records,
  50000                                           AS export_ceiling,
  CASE WHEN COUNT(*) > 50000
       THEN 'UNFILTERED EXPORT WILL REFUSE WITH 413 - this is correct behaviour'
       ELSE 'unfiltered export returns every record'
  END                                             AS expected_export_behaviour
FROM "Submission";

\echo ''
\echo '--- 5. The old defect, for the record: what the previous build would have returned ---'
SELECT
  COUNT(*)                        AS true_total,
  LEAST(COUNT(*), 1000)           AS old_build_would_have_exported,
  GREATEST(COUNT(*) - 1000, 0)    AS records_previously_dropped_silently
FROM "Submission";
