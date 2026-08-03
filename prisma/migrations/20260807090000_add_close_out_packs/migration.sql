-- SC-024 Phase 1 — project close-out packs.
--
-- Purely ADDITIVE: one table, no changes to any existing column, no backfill.
-- Generating a pack is a read-only act over existing records, so nothing about
-- how the platform behaves changes until someone chooses to generate one.

CREATE TABLE "CloseOutPack" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "aiSummary" TEXT,
    "aiPromptVersion" TEXT,
    "preparedFor" TEXT,
    "generatedByUserId" TEXT,
    "generatedByName" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloseOutPack_pkey" PRIMARY KEY ("id")
);

-- One version number per site: makes the revision history unambiguous and stops
-- two concurrent generations claiming the same version.
CREATE UNIQUE INDEX "CloseOutPack_jobSiteId_version_key" ON "CloseOutPack"("jobSiteId", "version");
CREATE INDEX "CloseOutPack_jobSiteId_generatedAt_idx" ON "CloseOutPack"("jobSiteId", "generatedAt");

ALTER TABLE "CloseOutPack" ADD CONSTRAINT "CloseOutPack_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
