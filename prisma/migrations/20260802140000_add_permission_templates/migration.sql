-- SC-022 Phase 2 — permission templates and company permission defaults.
--
-- Purely ADDITIVE: three new tables, no change to any existing column and NO
-- backfill. Behaviour is unchanged until somebody creates a template or sets a
-- company default; the seeded Contractor (standard) template is inert until
-- deliberately applied.

CREATE TABLE "PermissionTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PermissionTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "verbs" TEXT[],

    CONSTRAINT "PermissionTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyPermissionDefault" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "verbs" TEXT[],
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPermissionDefault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermissionTemplate_name_key" ON "PermissionTemplate"("name");
CREATE INDEX "PermissionTemplate_active_name_idx" ON "PermissionTemplate"("active", "name");
CREATE UNIQUE INDEX "PermissionTemplateItem_templateId_module_key" ON "PermissionTemplateItem"("templateId", "module");
CREATE INDEX "PermissionTemplateItem_templateId_idx" ON "PermissionTemplateItem"("templateId");
CREATE UNIQUE INDEX "CompanyPermissionDefault_company_module_key" ON "CompanyPermissionDefault"("company", "module");
CREATE INDEX "CompanyPermissionDefault_company_idx" ON "CompanyPermissionDefault"("company");

ALTER TABLE "PermissionTemplateItem" ADD CONSTRAINT "PermissionTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PermissionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
