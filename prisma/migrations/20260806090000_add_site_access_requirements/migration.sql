-- SC-023 Phase 3 — competency and induction requirements for site access.
--
-- Purely ADDITIVE: one enum, one table. NO backfill, and every requirement is
-- absent-means-not-enforced, so nothing changes for any worker on deploy.
--
-- Requirements only bite where the site-level enforcement switch (Phase 1) is
-- already ON, which it is nowhere in production. Two independent switches must
-- both be deliberately enabled before a single worker can be refused.

CREATE TYPE "AccessRequirement" AS ENUM (
  'CSCS_VERIFIED', 'CSCS_IN_DATE', 'KNOWLEDGE_CHECK_PASSED',
  'INDUCTION_VALID', 'SIGNATURE_ON_FILE'
);

CREATE TABLE "SiteAccessRequirement" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "requirement" "AccessRequirement" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "blockedAtEnable" INTEGER,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAccessRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteAccessRequirement_jobSiteId_requirement_key" ON "SiteAccessRequirement"("jobSiteId", "requirement");
CREATE INDEX "SiteAccessRequirement_jobSiteId_enabled_idx" ON "SiteAccessRequirement"("jobSiteId", "enabled");

ALTER TABLE "SiteAccessRequirement" ADD CONSTRAINT "SiteAccessRequirement_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
