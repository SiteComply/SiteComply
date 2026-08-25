-- ============================================================================
-- ROLLBACK for scripts/fix_toolbox_talk.sql.
--
-- Restores the "Toolbox Talk" description to the exact value production held
-- before the fix (the string seeded from auditTemplateSeed.ts at commit
-- 55a7eb0). Same one-row guard: raises and rolls back unless exactly one row
-- matches, so it cannot fire twice or hit anything else.
-- ============================================================================

DO $$
DECLARE n integer;
BEGIN
  UPDATE "AuditTemplate"
     SET description = 'Supervisor-delivered briefing, recorded as a scheduled activity. SC-018 removed the toolbox-talk question from the worker induction precisely because these are delivered separately — this is where they belong.'
   WHERE name = 'Toolbox Talk'
     AND "isSystem" = true
     AND description NOT LIKE '%SC-018%';

  GET DIAGNOSTICS n = ROW_COUNT;

  IF n <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly 1 matching row, found %. No change made (rolled back).', n;
  END IF;

  RAISE NOTICE 'ROLLED BACK: restored % row to the pre-fix description.', n;
END $$;

SELECT id, name, description FROM "AuditTemplate" WHERE name = 'Toolbox Talk';
