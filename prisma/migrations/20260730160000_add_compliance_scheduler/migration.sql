-- SC-020 Phase 1 — Compliance Scheduler & Automation (calendar + generation).
--
-- Purely ADDITIVE: four new enums and two new tables. No existing column is
-- touched and there is no backfill, so the running SC-019 code is unaffected and
-- this is safe to apply before the code deploy.
--
-- The unique constraint on (scheduleId, dueAt) is the load-bearing part: it is
-- the idempotency guarantee for occurrence generation. Generation runs lazily on
-- read (and, from Phase 4, from a scheduled trigger) using createMany +
-- skipDuplicates, so repeated or concurrent runs cannot double-generate. A
-- duplicated or missing statutory inspection is a compliance failure, not a
-- cosmetic bug, so the database enforces it rather than careful application code.

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ScheduleAssigneeKind" AS ENUM ('USER', 'WORKER', 'ROLE');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'MISSED');

-- CreateTable
CREATE TABLE "ComplianceSchedule" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "auditTemplateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "frequency" "ScheduleFrequency" NOT NULL,
    "intervalDays" INTEGER,
    "weekdays" INTEGER[],
    "dayOfMonth" INTEGER,
    "timeOfDay" TEXT NOT NULL DEFAULT '08:00',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "dueWindowDays" INTEGER NOT NULL DEFAULT 1,
    "assigneeKind" "ScheduleAssigneeKind" NOT NULL DEFAULT 'ROLE',
    "assignedPlatformUserId" TEXT,
    "assignedWorkerId" TEXT,
    "assignedRole" "PlatformRole",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminderOffsetsDays" INTEGER[],
    "escalateAfterDays" INTEGER,
    "escalateToRole" "PlatformRole",
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceOccurrence" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "dueDateLocal" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "auditId" TEXT,
    "assigneeKind" "ScheduleAssigneeKind" NOT NULL,
    "assignedPlatformUserId" TEXT,
    "assignedWorkerId" TEXT,
    "assignedRole" "PlatformRole",
    "assigneeLabel" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceSchedule_jobSiteId_active_idx" ON "ComplianceSchedule"("jobSiteId", "active");

-- CreateIndex
CREATE INDEX "ComplianceSchedule_auditTemplateId_idx" ON "ComplianceSchedule"("auditTemplateId");

-- CreateIndex — THE idempotency guarantee for occurrence generation.
CREATE UNIQUE INDEX "ComplianceOccurrence_scheduleId_dueAt_key" ON "ComplianceOccurrence"("scheduleId", "dueAt");

-- CreateIndex
CREATE INDEX "ComplianceOccurrence_jobSiteId_dueDateLocal_idx" ON "ComplianceOccurrence"("jobSiteId", "dueDateLocal");

-- CreateIndex
CREATE INDEX "ComplianceOccurrence_status_dueAt_idx" ON "ComplianceOccurrence"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_auditTemplateId_fkey" FOREIGN KEY ("auditTemplateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceOccurrence" ADD CONSTRAINT "ComplianceOccurrence_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ComplianceSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceOccurrence" ADD CONSTRAINT "ComplianceOccurrence_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceOccurrence" ADD CONSTRAINT "ComplianceOccurrence_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
