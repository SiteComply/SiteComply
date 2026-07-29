-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "sourceTemplateId" TEXT,
ADD COLUMN     "sourceTemplateName" TEXT,
ADD COLUMN     "sourceTemplateVersion" INTEGER;

-- CreateTable
CREATE TABLE "AuditItem" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "category" "FindingCategory" NOT NULL DEFAULT 'OTHER',
    "note" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "AuditItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "category" "FindingCategory" NOT NULL DEFAULT 'OTHER',
    "defaultSeverity" "FindingSeverity",
    "order" INTEGER NOT NULL,

    CONSTRAINT "AuditTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditItem_auditId_order_idx" ON "AuditItem"("auditId", "order");

-- CreateIndex
CREATE INDEX "AuditTemplate_active_order_idx" ON "AuditTemplate"("active", "order");

-- CreateIndex
CREATE INDEX "AuditTemplateItem_templateId_order_idx" ON "AuditTemplateItem"("templateId", "order");

-- AddForeignKey
ALTER TABLE "AuditItem" ADD CONSTRAINT "AuditItem_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTemplateItem" ADD CONSTRAINT "AuditTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

