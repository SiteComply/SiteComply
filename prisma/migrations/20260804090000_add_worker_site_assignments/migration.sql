-- SC-023 Phase 1 — worker invitation and site assignment.
--
-- Purely ADDITIVE: one enum, two tables, one defaulted column. NO backfill in
-- this migration.
--
-- `workerAccessEnforced` defaults FALSE, so on deploy every site behaves exactly
-- as it does today and no worker is locked out. Enforcement is switched on per
-- site, by a Director, after that site's workers have been invited or
-- backfilled. The backfill runs as a SEPARATE, explicit step
-- (scripts/sc023_backfill.ts) so it can be inspected before enforcement is
-- enabled anywhere.

CREATE TYPE "WorkerAssignmentStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

ALTER TABLE "JobSite" ADD COLUMN "workerAccessEnforced" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "WorkerSiteAssignment" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "status" "WorkerAssignmentStatus" NOT NULL DEFAULT 'INVITED',
    "invitationCode" TEXT,
    "invitedByUserId" TEXT,
    "invitedByName" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedByName" TEXT,
    "removedAt" TIMESTAMP(3),
    "backfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSiteAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerAssignmentEvent" (
    "id" TEXT NOT NULL,
    "workerId" TEXT,
    "workerName" TEXT NOT NULL,
    "jobSiteId" TEXT,
    "siteName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerAssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- One assignment per (worker, site): makes an invite an upsert and keeps the
-- access decision unambiguous.
CREATE UNIQUE INDEX "WorkerSiteAssignment_workerId_jobSiteId_key" ON "WorkerSiteAssignment"("workerId", "jobSiteId");
CREATE INDEX "WorkerSiteAssignment_jobSiteId_status_idx" ON "WorkerSiteAssignment"("jobSiteId", "status");
CREATE INDEX "WorkerSiteAssignment_workerId_status_idx" ON "WorkerSiteAssignment"("workerId", "status");
CREATE INDEX "WorkerAssignmentEvent_jobSiteId_createdAt_idx" ON "WorkerAssignmentEvent"("jobSiteId", "createdAt");
CREATE INDEX "WorkerAssignmentEvent_workerId_createdAt_idx" ON "WorkerAssignmentEvent"("workerId", "createdAt");

ALTER TABLE "WorkerSiteAssignment" ADD CONSTRAINT "WorkerSiteAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkerSiteAssignment" ADD CONSTRAINT "WorkerSiteAssignment_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WorkerAssignmentEvent deliberately has NO foreign keys: the trail must
-- outlive the worker and the site it describes.
