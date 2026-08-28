-- ============================================================================
-- Diagnose the TEST WORKER records. READ-ONLY — no writes.
--
-- Answers: which Worker row is which, does the +447700900150 account exist and
-- is it assigned to a site, and which record is the one showing on Test Site B.
-- ============================================================================
SET default_transaction_read_only = on;

\echo '=== 1. EVERY worker whose name looks like a test account, or is on the reserved range ==='
SELECT w.id,
       w."fullName",
       w.company,
       w.mobile,
       w."createdAt",
       (SELECT COUNT(*) FROM "Submission" s WHERE s."workerId" = w.id)              AS checkins,
       (SELECT MIN(s."checkedInAt") FROM "Submission" s WHERE s."workerId" = w.id)  AS first_checkin,
       (SELECT MAX(s."checkedInAt") FROM "Submission" s WHERE s."workerId" = w.id)  AS last_checkin,
       (SELECT COUNT(*) FROM "WorkerSiteAssignment" a WHERE a."workerId" = w.id)    AS assignments
FROM "Worker" w
WHERE w."fullName" ILIKE '%test%'
   OR w.mobile LIKE '+44770090%'
ORDER BY w."createdAt";

\echo ''
\echo '=== 2. THE account in question: mobile +447700900150 ==='
SELECT id, "fullName", company, mobile, "createdAt"
FROM "Worker"
WHERE mobile = '+447700900150';
\echo '(0 rows here = the account has never completed onboarding in production)'

\echo ''
\echo '=== 3. Site assignments for +447700900150 ==='
SELECT a.id            AS assignment_id,
       a.status,
       j.name          AS site,
       a."invitedAt",
       a."invitedByName",
       a."approvedAt",
       a."approvedByName",
       a."startDate",
       a."endDate"
FROM "WorkerSiteAssignment" a
JOIN "JobSite" j ON j.id = a."jobSiteId"
JOIN "Worker"  w ON w.id = a."workerId"
WHERE w.mobile = '+447700900150';

\echo ''
\echo '=== 4. Assignments for EVERY worker named TEST WORKER (which record is on which site) ==='
SELECT w.id AS worker_id, w.mobile, a.status, j.name AS site, a."invitedAt"
FROM "Worker" w
LEFT JOIN "WorkerSiteAssignment" a ON a."workerId" = w.id
LEFT JOIN "JobSite" j ON j.id = a."jobSiteId"
WHERE w."fullName" ILIKE 'TEST WORKER'
ORDER BY w."createdAt";

\echo ''
\echo '=== 5. Who is actually on "Test Site B" (worker rows behind its check-ins) ==='
SELECT DISTINCT w.id, w."fullName", w.mobile,
       COUNT(s.id) OVER (PARTITION BY w.id) AS checkins_at_this_site
FROM "Submission" s
JOIN "Worker"  w ON w.id = s."workerId"
JOIN "JobSite" j ON j.id = s."jobSiteId"
WHERE j.name ILIKE '%Test Site B%'
ORDER BY w."fullName";
