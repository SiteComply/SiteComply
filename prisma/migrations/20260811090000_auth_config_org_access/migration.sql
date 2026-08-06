-- SC-AUTH Phase 1 — organisation-wide Authentication & Access settings.
--
-- Purely ADDITIVE. Six columns on the existing AuthConfig singleton; no column
-- is altered or dropped and there is no backfill. Every boolean carries a
-- default that reproduces today's behaviour exactly, so applying this before
-- the code deploy changes nothing:
--   workerSmsLoginEnabled  true  — worker SMS login is on today
--   expressCheckInEnabled  true  — express check-in is available today
--   invitedWorkersOnly     false — access stays governed per site
--   requireActiveSiteAssignment false — as above
-- The two nullable integers fall back to env then built-in default via
-- getAuthRuntimeConfig(), the same DB-over-env-over-default merge the existing
-- columns use.
ALTER TABLE "AuthConfig" ADD COLUMN     "expressCheckInEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "invitedWorkersOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireActiveSiteAssignment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedByUserId" TEXT,
ADD COLUMN     "workerSessionTtlSeconds" INTEGER,
ADD COLUMN     "workerSmsLoginEnabled" BOOLEAN NOT NULL DEFAULT true;
