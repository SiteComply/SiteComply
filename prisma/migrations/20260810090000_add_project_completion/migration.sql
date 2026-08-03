-- SC-025 — Project Completion & Archive Management.
--
-- Purely ADDITIVE:
--   - one new SiteStatus value (COMPLETED);
--   - three nullable closure columns on JobSite;
--   - one new append-only table, SiteClosureEvent.
--
-- NO BACKFILL, deliberately. The one site already ARCHIVED in production was
-- archived before this workflow existed and never passed a completion
-- checklist, so declaring it COMPLETED would fabricate an approval that never
-- happened. It stays ARCHIVED and stays editable.

ALTER TYPE "SiteStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TABLE "JobSite" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "JobSite" ADD COLUMN "completedById" TEXT;
ALTER TABLE "JobSite" ADD COLUMN "completedByName" TEXT;

CREATE TABLE "SiteClosureEvent" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    -- Snapshot of the warnings overridden at the moment of the decision.
    "warnings" JSONB,
    -- The assignments this closure suspended, so a reopen can offer exactly
    -- those back instead of guessing which access to restore.
    "suspendedAssignmentIds" JSONB,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteClosureEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteClosureEvent_jobSiteId_createdAt_idx" ON "SiteClosureEvent"("jobSiteId", "createdAt");

ALTER TABLE "SiteClosureEvent" ADD CONSTRAINT "SiteClosureEvent_jobSiteId_fkey"
    FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
