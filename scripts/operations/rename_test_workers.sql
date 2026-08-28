-- ============================================================================
-- Rename HISTORICAL test-worker records that carry history, so the active dev
-- account is unmistakable. NO DELETIONS. Touches exactly one column:
-- "Worker"."fullName".
--
-- SCOPE (all three must hold):
--   1. name looks like a test worker  ILIKE '%test worker%' / '%testworker%'
--   2. NOT the active dev account     mobile <> '+447700900150'  (unique key)
--   3. NOT already renamed            idempotent re-runs are a no-op
--
-- EVERY non-active test record is archived, with or without history, so no
-- record is left sharing the plain "TEST WORKER" name with the live account.
-- Records with no check-ins take their month from the record creation date.
--
-- ⚠ "Submission" stores no copy of the worker name — every report resolves it
--    live through the Worker relation. So this changes the name DISPLAYED on
--    that worker's past check-ins as well as future ones. The attendance rows
--    themselves (dates, sites, answers, consent) are not touched.
--
-- New name:  TEST WORKER (archived YYYY-MM · NNNN)
--   YYYY-MM = month of first check-in, else month the record was created
--   NNNN    = last 4 of the mobile, so same-month records stay distinct
-- ============================================================================

\echo '=== BEFORE — every test-worker record ==='
SELECT w.id, w."fullName" AS name, w.mobile, w.company,
       (SELECT COUNT(*) FROM "Submission" s WHERE s."workerId" = w.id)             AS checkins,
       (SELECT COUNT(*) FROM "Permit" p WHERE p."workerId" = w.id)                 AS permits,
       (SELECT COUNT(*) FROM "KnowledgeCheckAttempt" k WHERE k."workerId" = w.id)  AS knowledge,
       (SELECT COUNT(*) FROM "CheckInOverride" o WHERE o."workerId" = w.id)        AS overrides,
       CASE WHEN w.mobile = '+447700900150' THEN '<<< ACTIVE — retained' ELSE '' END AS note
FROM "Worker" w
WHERE w."fullName" ILIKE '%test worker%' OR w."fullName" ILIKE '%testworker%'
ORDER BY (w.mobile = '+447700900150'), w."createdAt";

\echo ''
\echo '=== RENAMING ==='

DO $$
DECLARE n integer;
BEGIN
  WITH target AS (
    SELECT w.id,
           'TEST WORKER (archived '
             || to_char(COALESCE(
                  (SELECT MIN(s."checkedInAt") FROM "Submission" s WHERE s."workerId" = w.id),
                  w."createdAt"), 'YYYY-MM')
             || ' · ' || RIGHT(w.mobile, 4) || ')' AS new_name
    FROM "Worker" w
    WHERE (w."fullName" ILIKE '%test worker%' OR w."fullName" ILIKE '%testworker%')
      AND w.mobile <> '+447700900150'
      AND w."fullName" NOT LIKE '%(archived %'
  )
  UPDATE "Worker" w
     SET "fullName" = t.new_name
    FROM target t
   WHERE w.id = t.id;

  GET DIAGNOSTICS n = ROW_COUNT;

  -- Matching more than a handful means the name filter caught something real.
  IF n > 20 THEN
    RAISE EXCEPTION
      'Refusing to rename % rows — expected a few test records. Rolled back.', n;
  END IF;

  RAISE NOTICE 'Renamed % historical test-worker record(s).', n;
END $$;

\echo ''
\echo '=== AFTER — active account last, and unqualified ==='
SELECT w.id, w."fullName" AS name, w.mobile,
       (SELECT COUNT(*) FROM "Submission" s WHERE s."workerId" = w.id)             AS checkins,
       (SELECT MIN(s."checkedInAt") FROM "Submission" s WHERE s."workerId" = w.id) AS first_checkin,
       (SELECT MAX(s."checkedInAt") FROM "Submission" s WHERE s."workerId" = w.id) AS last_checkin,
       CASE WHEN w.mobile = '+447700900150' THEN '<<< ACTIVE — retained as TEST WORKER' ELSE 'archived' END AS status
FROM "Worker" w
WHERE w."fullName" ILIKE '%test worker%' OR w."fullName" ILIKE '%testworker%'
ORDER BY (w.mobile = '+447700900150'), w."createdAt";

\echo ''
\echo '=== CHECK — anything still named plain "TEST WORKER" other than the active account? ==='
SELECT w.id, w."fullName" AS name, w.mobile, w."createdAt"
FROM "Worker" w
WHERE (w."fullName" ILIKE '%test worker%' OR w."fullName" ILIKE '%testworker%')
  AND w.mobile <> '+447700900150'
  AND w."fullName" NOT LIKE '%(archived %'
ORDER BY w."createdAt";
\echo '(0 rows = every historical record is archived and only the live account is unqualified)'
