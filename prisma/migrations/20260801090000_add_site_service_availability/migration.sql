-- SC-021 Phase 1 — per-site availability of permit types and activity types.
--
-- Purely ADDITIVE: two new tables, no change to any existing column and NO
-- backfill. The tables hold OVERRIDES ONLY — a site with no row for a type gets
-- the default, which is AVAILABLE — so every existing site keeps exactly the
-- behaviour it has today until somebody deliberately turns something off.

CREATE TABLE "SitePermitTypeSetting" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "permitTypeId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePermitTypeSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteActivityTypeSetting" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "auditTemplateId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteActivityTypeSetting_pkey" PRIMARY KEY ("id")
);

-- One row per (site, type): the uniqueness that makes a write an upsert and
-- keeps "enabled" unambiguous.
CREATE UNIQUE INDEX "SitePermitTypeSetting_jobSiteId_permitTypeId_key" ON "SitePermitTypeSetting"("jobSiteId", "permitTypeId");
CREATE INDEX "SitePermitTypeSetting_jobSiteId_idx" ON "SitePermitTypeSetting"("jobSiteId");
CREATE UNIQUE INDEX "SiteActivityTypeSetting_jobSiteId_auditTemplateId_key" ON "SiteActivityTypeSetting"("jobSiteId", "auditTemplateId");
CREATE INDEX "SiteActivityTypeSetting_jobSiteId_idx" ON "SiteActivityTypeSetting"("jobSiteId");

-- CASCADE on both sides: deleting a site or a catalogue entry must not leave
-- an override pointing at nothing.
ALTER TABLE "SitePermitTypeSetting" ADD CONSTRAINT "SitePermitTypeSetting_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SitePermitTypeSetting" ADD CONSTRAINT "SitePermitTypeSetting_permitTypeId_fkey" FOREIGN KEY ("permitTypeId") REFERENCES "PermitType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteActivityTypeSetting" ADD CONSTRAINT "SiteActivityTypeSetting_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteActivityTypeSetting" ADD CONSTRAINT "SiteActivityTypeSetting_auditTemplateId_fkey" FOREIGN KEY ("auditTemplateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
