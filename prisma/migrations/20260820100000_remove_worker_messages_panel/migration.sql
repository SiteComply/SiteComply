-- Remove the "Messages and notifications" Worker Dashboard panel.
--
-- The panel had no source system: both the dashboard card and /worker/messages
-- only ever rendered an empty state pointing at Daily Bulletins, so the toggle
-- could not surface anything a worker could not already reach. Removing the
-- option, its stored configuration state and the enum value.
--
-- Order matters: the stored rows must go BEFORE the enum value is dropped,
-- otherwise the USING cast below fails and the deployment cannot start.

-- 1. Drop stored configuration state for the panel (site-level and worker-level).
DELETE FROM "SiteDashboardSetting" WHERE "panel" = 'MESSAGES';
DELETE FROM "WorkerPanelSetting"   WHERE "panel" = 'MESSAGES';

-- 2. Recreate the enum without MESSAGES. Postgres cannot drop an enum label in
--    place, so swap the type and re-cast both dependent columns.
ALTER TYPE "WorkerDashboardPanel" RENAME TO "WorkerDashboardPanel_old";

CREATE TYPE "WorkerDashboardPanel" AS ENUM (
  'SITE_INFORMATION',
  'DAILY_BULLETIN',
  'ACTIVE_PERMITS',
  'RAMS',
  'SITE_DOCUMENTS',
  'EMERGENCY_INFORMATION',
  'FIRST_AIDER',
  'FIRE_ASSEMBLY_POINT',
  'SITE_CONTACTS',
  'OUTSTANDING_ACTIONS',
  'CHECK_OUT'
);

ALTER TABLE "SiteDashboardSetting"
  ALTER COLUMN "panel" TYPE "WorkerDashboardPanel"
  USING "panel"::text::"WorkerDashboardPanel";

ALTER TABLE "WorkerPanelSetting"
  ALTER COLUMN "panel" TYPE "WorkerDashboardPanel"
  USING "panel"::text::"WorkerDashboardPanel";

DROP TYPE "WorkerDashboardPanel_old";
