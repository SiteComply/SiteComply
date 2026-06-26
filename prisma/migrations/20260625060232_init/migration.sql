-- CreateEnum
CREATE TYPE "CscsCardType" AS ENUM ('GREEN_LABOURER', 'RED_TRAINEE', 'BLUE_SKILLED', 'GOLD_SUPERVISORY', 'BLACK_MANAGER', 'WHITE_PROFESSIONAL');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ChecklistItemType" AS ENUM ('ACKNOWLEDGEMENT', 'YES_NO', 'PPE_CONFIRM');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('COMPLIANT', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "cscsCardNumber" TEXT,
    "cscsCardType" "CscsCardType",
    "cscsExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSite" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "town" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "jobReference" TEXT NOT NULL,
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "inductionContent" TEXT NOT NULL DEFAULT '',
    "fireAssemblyPoint" TEXT,
    "firstAiderName" TEXT,
    "firstAiderNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" TEXT NOT NULL,

    CONSTRAINT "JobSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceChecklist" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "ChecklistItemType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "checklistVersion" INTEGER NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "ppeConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "rulesAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "safeWorkingAgreed" BOOLEAN NOT NULL DEFAULT false,
    "gdprConsent" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedOutAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "azureObjectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Worker_mobile_key" ON "Worker"("mobile");

-- CreateIndex
CREATE INDEX "Worker_company_idx" ON "Worker"("company");

-- CreateIndex
CREATE INDEX "JobSite_status_idx" ON "JobSite"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceChecklist_jobSiteId_version_key" ON "ComplianceChecklist"("jobSiteId", "version");

-- CreateIndex
CREATE INDEX "ChecklistItem_checklistId_order_idx" ON "ChecklistItem"("checklistId", "order");

-- CreateIndex
CREATE INDEX "Submission_jobSiteId_checkedInAt_idx" ON "Submission"("jobSiteId", "checkedInAt");

-- CreateIndex
CREATE INDEX "Submission_workerId_idx" ON "Submission"("workerId");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_azureObjectId_key" ON "Admin"("azureObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- AddForeignKey
ALTER TABLE "JobSite" ADD CONSTRAINT "JobSite_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceChecklist" ADD CONSTRAINT "ComplianceChecklist_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "ComplianceChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
