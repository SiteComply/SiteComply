-- SC-021 Phase 2 — configuration templates and company-mandatory services.
--
-- Purely ADDITIVE: three new tables, one new enum, three nullable columns on
-- JobSite, and no backfill. Zero behaviour change until somebody creates a
-- template or sets a policy — the same dark-by-default property as Phase 1.

CREATE TYPE "SiteConfigTemplateCategory" AS ENUM ('PROJECT_TYPE', 'CLIENT', 'INDUSTRY', 'OTHER');

-- Provenance of the last template applied. SNAPSHOT STRINGS, not a foreign key:
-- deleting or renaming a template must never rewrite a site's own history.
ALTER TABLE "JobSite" ADD COLUMN "appliedConfigTemplateName" TEXT;
ALTER TABLE "JobSite" ADD COLUMN "appliedConfigTemplateAt" TIMESTAMP(3);
ALTER TABLE "JobSite" ADD COLUMN "appliedConfigTemplateBy" TEXT;

CREATE TABLE "SiteConfigTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "SiteConfigTemplateCategory" NOT NULL DEFAULT 'PROJECT_TYPE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteConfigTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteConfigTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "permitTypeId" TEXT,
    "auditTemplateId" TEXT,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "SiteConfigTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrgServicePolicy" (
    "id" TEXT NOT NULL,
    "permitTypeId" TEXT,
    "auditTemplateId" TEXT,
    "reason" TEXT,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgServicePolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteConfigTemplate_name_key" ON "SiteConfigTemplate"("name");
CREATE INDEX "SiteConfigTemplate_active_category_idx" ON "SiteConfigTemplate"("active", "category");
CREATE UNIQUE INDEX "SiteConfigTemplateItem_templateId_permitTypeId_key" ON "SiteConfigTemplateItem"("templateId", "permitTypeId");
CREATE UNIQUE INDEX "SiteConfigTemplateItem_templateId_auditTemplateId_key" ON "SiteConfigTemplateItem"("templateId", "auditTemplateId");
CREATE INDEX "SiteConfigTemplateItem_templateId_idx" ON "SiteConfigTemplateItem"("templateId");
CREATE UNIQUE INDEX "OrgServicePolicy_permitTypeId_key" ON "OrgServicePolicy"("permitTypeId");
CREATE UNIQUE INDEX "OrgServicePolicy_auditTemplateId_key" ON "OrgServicePolicy"("auditTemplateId");

-- EXACTLY ONE target per row. A row pointing at both or neither is meaningless
-- and would silently misapply, so the database refuses it rather than trusting
-- every future caller to get it right.
ALTER TABLE "SiteConfigTemplateItem" ADD CONSTRAINT "SiteConfigTemplateItem_one_target"
  CHECK (("permitTypeId" IS NOT NULL) <> ("auditTemplateId" IS NOT NULL));
ALTER TABLE "OrgServicePolicy" ADD CONSTRAINT "OrgServicePolicy_one_target"
  CHECK (("permitTypeId" IS NOT NULL) <> ("auditTemplateId" IS NOT NULL));

ALTER TABLE "SiteConfigTemplateItem" ADD CONSTRAINT "SiteConfigTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SiteConfigTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteConfigTemplateItem" ADD CONSTRAINT "SiteConfigTemplateItem_permitTypeId_fkey" FOREIGN KEY ("permitTypeId") REFERENCES "PermitType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteConfigTemplateItem" ADD CONSTRAINT "SiteConfigTemplateItem_auditTemplateId_fkey" FOREIGN KEY ("auditTemplateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgServicePolicy" ADD CONSTRAINT "OrgServicePolicy_permitTypeId_fkey" FOREIGN KEY ("permitTypeId") REFERENCES "PermitType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgServicePolicy" ADD CONSTRAINT "OrgServicePolicy_auditTemplateId_fkey" FOREIGN KEY ("auditTemplateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
