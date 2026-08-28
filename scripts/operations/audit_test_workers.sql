-- ============================================================================
-- DRY RUN — audit every "TEST WORKER"-ish record before any cleanup.
-- READ-ONLY. Makes no changes of any kind.
--
-- WHY THE EXTRA COUNTS: deleting a Worker CASCADES. Confirmed from
-- prisma/schema.prisma:
--
--   Submission            onDelete: Cascade   <-- attendance + induction records
--   Permit                onDelete: Cascade   <-- permits to work
--   KnowledgeCheckAttempt onDelete: Cascade   <-- knowledge check results
--   CheckInOverride       onDelete: Cascade   <-- manager GPS overrides (audit trail)
--   SiteBulletinRead      onDelete: Cascade   <-- bulletin read receipts
--   WorkerSiteAssignment  onDelete: Cascade   <-- site assignments
--   WorkerPanelSetting    onDelete: Cascade   <-- per-worker dashboard overrides
--   CscsVerificationLog   onDelete: SetNull   (log row survives, unlinked)
--   SmsMessageLog         onDelete: SetNull   (log row survives, unlinked)
--
-- So a hard DELETE destroys attendance, permit, knowledge-check and override
-- history. The `verdict` column below is the go / no-go.
-- ============================================================================
SET default_transaction_read_only = on;

SELECT
  w.id                                                   AS worker_id,
  w."fullName"                                           AS display_name,
  w.mobile,
  w.company,
  w."createdAt"                                          AS record_created,

  (SELECT COUNT(*) FROM "WorkerSiteAssignment" a WHERE a."workerId" = w.id)   AS assignments,
  (SELECT string_agg(DISTINCT j.name || ' [' || a.status || ']', ', ')
     FROM "WorkerSiteAssignment" a JOIN "JobSite" j ON j.id = a."jobSiteId"
    WHERE a."workerId" = w.id)                                                AS assigned_sites,

  (SELECT COUNT(*) FROM "Submission" s WHERE s."workerId" = w.id)             AS checkins,
  (SELECT MIN(s."checkedInAt") FROM "Submission" s WHERE s."workerId" = w.id) AS first_checkin,
  (SELECT MAX(s."checkedInAt") FROM "Submission" s WHERE s."workerId" = w.id) AS last_checkin,
  (SELECT string_agg(DISTINCT j.name, ', ')
     FROM "Submission" s JOIN "JobSite" j ON j.id = s."jobSiteId"
    WHERE s."workerId" = w.id)                                                AS checkin_sites,

  -- Everything else a delete would take with it
  (SELECT COUNT(*) FROM "Permit" p                WHERE p."workerId" = w.id)  AS permits,
  (SELECT COUNT(*) FROM "KnowledgeCheckAttempt" k WHERE k."workerId" = w.id)  AS knowledge_checks,
  (SELECT COUNT(*) FROM "CheckInOverride" o       WHERE o."workerId" = w.id)  AS checkin_overrides,
  (SELECT COUNT(*) FROM "SiteBulletinRead" b      WHERE b."workerId" = w.id)  AS bulletin_reads,
  (SELECT COUNT(*) FROM "CscsVerificationLog" c   WHERE c."workerId" = w.id)  AS cscs_checks,

  CASE
    WHEN w.mobile = '+447700900150' THEN 'RETAIN — active dev account'
    WHEN (SELECT COUNT(*) FROM "Submission" s             WHERE s."workerId" = w.id) > 0
      OR (SELECT COUNT(*) FROM "Permit" p                 WHERE p."workerId" = w.id) > 0
      OR (SELECT COUNT(*) FROM "KnowledgeCheckAttempt" k  WHERE k."workerId" = w.id) > 0
      OR (SELECT COUNT(*) FROM "CheckInOverride" o        WHERE o."workerId" = w.id) > 0
      THEN 'STOP — has history a delete would destroy'
    ELSE 'no history — deletable'
  END                                                                         AS verdict

FROM "Worker" w
WHERE w."fullName" ILIKE '%test worker%'
   OR w."fullName" ILIKE '%testworker%'
ORDER BY (w.mobile = '+447700900150'), w."createdAt";
