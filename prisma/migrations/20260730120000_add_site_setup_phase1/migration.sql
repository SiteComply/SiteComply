-- SC-019 Phase 1 — Enhanced Site Setup (data model + wizard foundation).
--
-- Purely ADDITIVE: nine new nullable columns on SiteInformation, three new 1:1
-- tables keyed by jobSiteId, one new many-table with its enum, and no changes to
-- any existing column. Nothing is rewritten and there is no backfill — existing
-- sites simply read as "setup incomplete", which the completeness indicator
-- presents as a to-do list rather than a fault.
--
-- The single-source-of-truth rule: the new CPP narrative fields extend the
-- EXISTING SC-008 SiteInformation record rather than living in a parallel CPP
-- model, so the worker-facing Site Information page and the Construction Phase
-- Plan can never diverge. JobSite's own emergency/first-aider columns are left
-- untouched and remain the primary entry, so every worker-facing panel keeps
-- working exactly as before.

-- CreateEnum
CREATE TYPE "SiteKeyPersonKind" AS ENUM ('FIRST_AIDER', 'FIRE_MARSHAL', 'SITE_MANAGER', 'OTHER');

-- AlterTable
ALTER TABLE "SiteInformation" ADD COLUMN     "existingSiteRisks" TEXT,
ADD COLUMN     "temporaryWorks" TEXT,
ADD COLUMN     "trafficManagement" TEXT,
ADD COLUMN     "deliveryProcedures" TEXT,
ADD COLUMN     "accessEgress" TEXT,
ADD COLUMN     "environmentalControls" TEXT,
ADD COLUMN     "utilitiesIsolation" TEXT,
ADD COLUMN     "highRiskActivities" TEXT,
ADD COLUMN     "fireArrangements" TEXT;

-- CreateTable
CREATE TABLE "CdmDutyHolders" (
    "jobSiteId" TEXT NOT NULL,
    "clientName" TEXT,
    "clientContactName" TEXT,
    "clientContactEmail" TEXT,
    "clientContactPhone" TEXT,
    "principalDesigner" TEXT,
    "principalDesignerContact" TEXT,
    "principalDesignerEmail" TEXT,
    "principalDesignerPhone" TEXT,
    "principalDesignerAppointedAt" TIMESTAMP(3),
    "principalContractor" TEXT,
    "principalContractorContact" TEXT,
    "principalContractorEmail" TEXT,
    "principalContractorPhone" TEXT,
    "principalContractorAppointedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CdmDutyHolders_pkey" PRIMARY KEY ("jobSiteId")
);

-- CreateTable
CREATE TABLE "SiteProjectDetails" (
    "jobSiteId" TEXT NOT NULL,
    "description" TEXT,
    "scopeOfWorks" TEXT,
    "startDate" TIMESTAMP(3),
    "plannedEndDate" TIMESTAMP(3),
    "cdmNotifiable" BOOLEAN NOT NULL DEFAULT false,
    "f10Reference" TEXT,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteProjectDetails_pkey" PRIMARY KEY ("jobSiteId")
);

-- CreateTable
CREATE TABLE "SiteKeyPerson" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "kind" "SiteKeyPersonKind" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "location" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteKeyPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSetupProgress" (
    "jobSiteId" TEXT NOT NULL,
    "completedSteps" TEXT[],
    "lastStepKey" TEXT,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetupProgress_pkey" PRIMARY KEY ("jobSiteId")
);

-- CreateIndex
CREATE INDEX "SiteKeyPerson_jobSiteId_kind_order_idx" ON "SiteKeyPerson"("jobSiteId", "kind", "order");

-- AddForeignKey
ALTER TABLE "CdmDutyHolders" ADD CONSTRAINT "CdmDutyHolders_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteProjectDetails" ADD CONSTRAINT "SiteProjectDetails_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteKeyPerson" ADD CONSTRAINT "SiteKeyPerson_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSetupProgress" ADD CONSTRAINT "SiteSetupProgress_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
