-- AlterTable
ALTER TABLE "SiteInductionConfig" ADD COLUMN     "inductionValidityDays" INTEGER,
ADD COLUMN     "inductionsInvalidatedAt" TIMESTAMP(3),
ADD COLUMN     "invalidatedByName" TEXT;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "inductionReused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inductionSourceSubmissionId" TEXT;

-- CreateIndex
CREATE INDEX "Submission_workerId_jobSiteId_checkedInAt_idx" ON "Submission"("workerId", "jobSiteId", "checkedInAt");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_inductionSourceSubmissionId_fkey" FOREIGN KEY ("inductionSourceSubmissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

