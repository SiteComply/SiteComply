-- CreateEnum
CREATE TYPE "AiSummaryTarget" AS ENUM ('COMPLIANCE_REPORT', 'SCORECARD_REPORT', 'ORG_OVERVIEW_REPORT', 'AUDIT', 'AUDITS_REGISTER', 'ACTIONS_REGISTER');

-- CreateTable
CREATE TABLE "AiSummary" (
    "id" TEXT NOT NULL,
    "targetType" "AiSummaryTarget" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "platformUserId" TEXT,
    "role" "PlatformRole" NOT NULL,
    "siteIds" JSONB NOT NULL,
    "contextHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "summary" JSONB,
    "tokensPrompt" INTEGER,
    "tokensOutput" INTEGER,
    "status" TEXT NOT NULL,
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSummary_targetType_targetKey_createdAt_idx" ON "AiSummary"("targetType", "targetKey", "createdAt");

-- CreateIndex
CREATE INDEX "AiSummary_platformUserId_createdAt_idx" ON "AiSummary"("platformUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AiSummary_createdAt_idx" ON "AiSummary"("createdAt");

-- AddForeignKey
ALTER TABLE "AiSummary" ADD CONSTRAINT "AiSummary_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

