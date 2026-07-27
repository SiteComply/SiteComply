-- CreateEnum
CREATE TYPE "KnowledgeCheckBankStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeQuestionCategory" AS ENUM ('SAFETY', 'SITE_RULES', 'EMERGENCY', 'HAZARD', 'GENERAL');

-- CreateEnum
CREATE TYPE "KnowledgeCheckAttemptStatus" AS ENUM ('IN_PROGRESS', 'PASSED');

-- CreateEnum
CREATE TYPE "InductionUnavailablePolicy" AS ENUM ('SKIP_FLAGGED', 'BLOCK');

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "knowledgeCheckPassed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "knowledgeCheckSkipped" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SiteInductionConfig" (
    "jobSiteId" TEXT NOT NULL,
    "knowledgeCheckEnabled" BOOLEAN,
    "questionsPerAttempt" INTEGER,
    "requireManagerApproval" BOOLEAN NOT NULL DEFAULT false,
    "unavailablePolicy" "InductionUnavailablePolicy",
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteInductionConfig_pkey" PRIMARY KEY ("jobSiteId")
);

-- CreateTable
CREATE TABLE "InductionQuestionBank" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "checklistVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "KnowledgeCheckBankStatus" NOT NULL DEFAULT 'GENERATING',
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "error" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InductionQuestionBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InductionQuestion" (
    "id" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "category" "KnowledgeQuestionCategory" NOT NULL DEFAULT 'GENERAL',
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctOptionId" TEXT NOT NULL,
    "sourceRef" TEXT,
    "explanation" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InductionQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCheckAttempt" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "checklistVersion" INTEGER NOT NULL,
    "submissionId" TEXT,
    "questionIds" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "status" "KnowledgeCheckAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "questionCount" INTEGER NOT NULL,
    "incorrectFirstTryCount" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeCheckAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionFlag" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "workerId" TEXT,
    "submissionId" TEXT,
    "reason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InductionQuestionBank_jobSiteId_status_idx" ON "InductionQuestionBank"("jobSiteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InductionQuestionBank_jobSiteId_checklistVersion_contentHas_key" ON "InductionQuestionBank"("jobSiteId", "checklistVersion", "contentHash");

-- CreateIndex
CREATE INDEX "InductionQuestion_bankId_active_order_idx" ON "InductionQuestion"("bankId", "active", "order");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCheckAttempt_submissionId_key" ON "KnowledgeCheckAttempt"("submissionId");

-- CreateIndex
CREATE INDEX "KnowledgeCheckAttempt_workerId_startedAt_idx" ON "KnowledgeCheckAttempt"("workerId", "startedAt");

-- CreateIndex
CREATE INDEX "KnowledgeCheckAttempt_jobSiteId_status_completedAt_idx" ON "KnowledgeCheckAttempt"("jobSiteId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "QuestionFlag_questionId_idx" ON "QuestionFlag"("questionId");

-- CreateIndex
CREATE INDEX "QuestionFlag_resolvedAt_idx" ON "QuestionFlag"("resolvedAt");

-- AddForeignKey
ALTER TABLE "SiteInductionConfig" ADD CONSTRAINT "SiteInductionConfig_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InductionQuestionBank" ADD CONSTRAINT "InductionQuestionBank_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InductionQuestion" ADD CONSTRAINT "InductionQuestion_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "InductionQuestionBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCheckAttempt" ADD CONSTRAINT "KnowledgeCheckAttempt_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCheckAttempt" ADD CONSTRAINT "KnowledgeCheckAttempt_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCheckAttempt" ADD CONSTRAINT "KnowledgeCheckAttempt_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "InductionQuestionBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCheckAttempt" ADD CONSTRAINT "KnowledgeCheckAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionFlag" ADD CONSTRAINT "QuestionFlag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "InductionQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

