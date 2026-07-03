-- CreateEnum
CREATE TYPE "ActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "ActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "assignedTo" TEXT,
    "jobSiteId" TEXT NOT NULL,
    "auditFindingId" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Action_jobSiteId_status_dueDate_idx" ON "Action"("jobSiteId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Action_status_dueDate_idx" ON "Action"("status", "dueDate");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_auditFindingId_fkey" FOREIGN KEY ("auditFindingId") REFERENCES "AuditFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

