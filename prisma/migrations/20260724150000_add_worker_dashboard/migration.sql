-- CreateEnum
CREATE TYPE "WorkerDashboardPanel" AS ENUM ('SITE_INFORMATION', 'DAILY_BULLETIN', 'ACTIVE_PERMITS', 'RAMS', 'SITE_DOCUMENTS', 'EMERGENCY_INFORMATION', 'FIRST_AIDER', 'FIRE_ASSEMBLY_POINT', 'SITE_CONTACTS', 'OUTSTANDING_ACTIONS', 'MESSAGES', 'CHECK_OUT');

-- AlterTable
ALTER TABLE "JobSite" ADD COLUMN     "emergencyNumber" TEXT,
ADD COLUMN     "firstAiderLocation" TEXT,
ADD COLUMN     "nearestHospital" TEXT;

-- CreateTable
CREATE TABLE "SiteContact" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDashboardSetting" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "panel" "WorkerDashboardPanel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDashboardSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteContact_jobSiteId_order_idx" ON "SiteContact"("jobSiteId", "order");

-- CreateIndex
CREATE INDEX "SiteDashboardSetting_jobSiteId_idx" ON "SiteDashboardSetting"("jobSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteDashboardSetting_jobSiteId_panel_key" ON "SiteDashboardSetting"("jobSiteId", "panel");

-- AddForeignKey
ALTER TABLE "SiteContact" ADD CONSTRAINT "SiteContact_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDashboardSetting" ADD CONSTRAINT "SiteDashboardSetting_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

