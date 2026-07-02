-- CreateTable
CREATE TABLE "ReportExportLog" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "siteIds" JSONB NOT NULL,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportExportLog_reportType_createdAt_idx" ON "ReportExportLog"("reportType", "createdAt");

-- CreateIndex
CREATE INDEX "ReportExportLog_platformUserId_idx" ON "ReportExportLog"("platformUserId");

-- AddForeignKey
ALTER TABLE "ReportExportLog" ADD CONSTRAINT "ReportExportLog_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
