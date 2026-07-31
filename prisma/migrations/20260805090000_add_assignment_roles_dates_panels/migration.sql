-- SC-023 Phase 2 — worker roles, access dates, transfers and per-worker panels.
--
-- Purely ADDITIVE: one enum, four nullable columns, one table. NO backfill.
--
-- Every new field is null-means-unrestricted, so the assignments created in
-- Phase 1 (including the backfilled ones) behave exactly as they do today until
-- somebody sets something. Combined with enforcement still being off, deploying
-- this changes nothing for any worker.
--
-- `role` is deliberately NOT defaulted to EMPLOYEE: the backfilled assignments
-- have no known role, and a default would assert something untrue about real
-- people.

CREATE TYPE "WorkerSiteRole" AS ENUM ('EMPLOYEE', 'CONTRACTOR', 'SUPERVISOR', 'CLIENT_REP');

ALTER TABLE "WorkerSiteAssignment" ADD COLUMN "role" "WorkerSiteRole";
ALTER TABLE "WorkerSiteAssignment" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "WorkerSiteAssignment" ADD COLUMN "endDate" TIMESTAMP(3);
ALTER TABLE "WorkerSiteAssignment" ADD COLUMN "transferredFromSiteName" TEXT;

CREATE TABLE "WorkerPanelSetting" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "panel" "WorkerDashboardPanel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerPanelSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerPanelSetting_workerId_jobSiteId_panel_key" ON "WorkerPanelSetting"("workerId", "jobSiteId", "panel");
CREATE INDEX "WorkerPanelSetting_workerId_jobSiteId_idx" ON "WorkerPanelSetting"("workerId", "jobSiteId");

ALTER TABLE "WorkerPanelSetting" ADD CONSTRAINT "WorkerPanelSetting_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkerPanelSetting" ADD CONSTRAINT "WorkerPanelSetting_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
