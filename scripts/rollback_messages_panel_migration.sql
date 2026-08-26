-- ============================================================================
-- ROLLBACK for prisma/migrations/20260820100000_remove_worker_messages_panel.
--
-- Restores the MESSAGES enum label and the single SiteDashboardSetting row that
-- production held before the migration, captured verbatim on 2026-08-26:
--
--   id              cms2nkkjm0006s0oa6xpkzoex
--   jobSiteId       cmrv2hmev000uiw0fkkuy6tty   (Test Site 3)
--   panel           MESSAGES
--   enabled         false                       <- the panel was switched OFF
--   updatedByName   Director Test
--   createdAt       2026-07-27 03:13:58.786
--   updatedAt       2026-07-27 03:14:02.514
--
-- NOTE ON ENUM ORDER: ADD VALUE appends, so MESSAGES returns at the END of the
-- enum rather than between OUTSTANDING_ACTIONS and CHECK_OUT. Nothing reads
-- enumsortorder — the application derives panel order from
-- WORKER_DASHBOARD_PANELS in code — so this is cosmetic in pg_enum only.
--
-- Restoring the label alone is enough to un-break a rolled-back deployment;
-- the row is restored for completeness, since it recorded a manager's explicit
-- choice even though that choice was "off".
-- ============================================================================

ALTER TYPE "WorkerDashboardPanel" ADD VALUE IF NOT EXISTS 'MESSAGES';

-- ADD VALUE cannot be used in the same transaction as a statement that uses it,
-- so the insert is deliberately a separate statement run after the commit.
INSERT INTO "SiteDashboardSetting"
  (id, "jobSiteId", panel, enabled, "updatedByUserId", "updatedByName", "createdAt", "updatedAt")
VALUES
  ('cms2nkkjm0006s0oa6xpkzoex',
   'cmrv2hmev000uiw0fkkuy6tty',
   'MESSAGES',
   false,
   'cmr2vfbss000ws423qoavi2sj',
   'Director Test',
   '2026-07-27 03:13:58.786',
   '2026-07-27 03:14:02.514')
ON CONFLICT (id) DO NOTHING;

SELECT string_agg(enumlabel, ', ' ORDER BY enumsortorder) AS enum_labels
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'WorkerDashboardPanel';

SELECT panel::text, COUNT(*) FROM "SiteDashboardSetting" GROUP BY panel ORDER BY 1;
