-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'SIGNED_OFF');

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "observations" TEXT,
    "overallScore" INTEGER,
    "status" "AuditStatus" NOT NULL DEFAULT 'DRAFT',
    "jobSiteId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "signedOffByUserId" TEXT,
    "signedOffByName" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AuditDocuments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Audit_jobSiteId_status_createdAt_idx" ON "Audit"("jobSiteId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_status_idx" ON "Audit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "_AuditDocuments_AB_unique" ON "_AuditDocuments"("A", "B");

-- CreateIndex
CREATE INDEX "_AuditDocuments_B_index" ON "_AuditDocuments"("B");

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_signedOffByUserId_fkey" FOREIGN KEY ("signedOffByUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AuditDocuments" ADD CONSTRAINT "_AuditDocuments_A_fkey" FOREIGN KEY ("A") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AuditDocuments" ADD CONSTRAINT "_AuditDocuments_B_fkey" FOREIGN KEY ("B") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

