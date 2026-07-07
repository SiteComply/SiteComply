-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Document_jobSiteId_expiresAt_idx" ON "Document"("jobSiteId", "expiresAt");
