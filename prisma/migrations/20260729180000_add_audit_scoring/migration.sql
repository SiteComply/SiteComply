-- SC-014 Customisable Audit Scoring.
-- Fully ADDITIVE: every new column is nullable or carries a default, and
-- "Audit"."scoringEnabled" defaults to false, so existing audits keep the legacy
-- manual "overallScore" and behave exactly as they did before this migration.

-- CreateEnum
CREATE TYPE "ScoringMethod" AS ENUM ('PERCENTAGE', 'PASS_FAIL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "QuestionScoringRule" AS ENUM ('WEIGHTED', 'PASS_FAIL', 'INFO_ONLY');

-- CreateEnum
CREATE TYPE "ItemResult" AS ENUM ('PASS', 'FAIL', 'NA');

-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "scoringEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scoringMethod" "ScoringMethod" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "totalPossibleScore" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "passingScore" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "showAsPercentage" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "roundScores" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "calculatedScore" INTEGER,
ADD COLUMN     "calculatedPercent" INTEGER,
ADD COLUMN     "calculatedPassed" BOOLEAN,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AuditTemplate" ADD COLUMN     "scoringEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scoringMethod" "ScoringMethod" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "totalPossibleScore" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "passingScore" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "showAsPercentage" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "roundScores" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "AuditItem" ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "scoringRule" "QuestionScoringRule" NOT NULL DEFAULT 'WEIGHTED',
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "mandatory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "result" "ItemResult",
ADD COLUMN     "pointsAwarded" INTEGER,
ADD COLUMN     "answeredAt" TIMESTAMP(3),
ADD COLUMN     "answeredByName" TEXT;

-- AlterTable
ALTER TABLE "AuditTemplateItem" ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "scoringRule" "QuestionScoringRule" NOT NULL DEFAULT 'WEIGHTED',
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "mandatory" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AuditSection" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightPercent" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL,

    CONSTRAINT "AuditSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTemplateSection" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightPercent" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL,

    CONSTRAINT "AuditTemplateSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditScoreBand" (
    "id" TEXT NOT NULL,
    "auditId" TEXT,
    "templateId" TEXT,
    "label" TEXT NOT NULL,
    "minScore" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'brand',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuditScoreBand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditSection_auditId_order_idx" ON "AuditSection"("auditId", "order");

-- CreateIndex
CREATE INDEX "AuditTemplateSection_templateId_order_idx" ON "AuditTemplateSection"("templateId", "order");

-- CreateIndex
CREATE INDEX "AuditScoreBand_auditId_order_idx" ON "AuditScoreBand"("auditId", "order");

-- CreateIndex
CREATE INDEX "AuditScoreBand_templateId_order_idx" ON "AuditScoreBand"("templateId", "order");

-- CreateIndex
CREATE INDEX "AuditItem_sectionId_order_idx" ON "AuditItem"("sectionId", "order");

-- CreateIndex
CREATE INDEX "AuditTemplateItem_sectionId_order_idx" ON "AuditTemplateItem"("sectionId", "order");

-- AddForeignKey
ALTER TABLE "AuditSection" ADD CONSTRAINT "AuditSection_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTemplateSection" ADD CONSTRAINT "AuditTemplateSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditScoreBand" ADD CONSTRAINT "AuditScoreBand_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditScoreBand" ADD CONSTRAINT "AuditScoreBand_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditItem" ADD CONSTRAINT "AuditItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AuditSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTemplateItem" ADD CONSTRAINT "AuditTemplateItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AuditTemplateSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
