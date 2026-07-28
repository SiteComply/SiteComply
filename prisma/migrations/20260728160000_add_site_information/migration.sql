-- CreateTable
CREATE TABLE "SiteInformation" (
    "jobSiteId" TEXT NOT NULL,
    "workingHours" TEXT,
    "siteRules" TEXT,
    "welfareFacilities" TEXT,
    "siteHazards" TEXT,
    "emergencyProcedures" TEXT,
    "siteMapBlobPath" TEXT,
    "siteMapFileName" TEXT,
    "siteMapMimeType" TEXT,
    "siteMapSizeBytes" INTEGER,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteInformation_pkey" PRIMARY KEY ("jobSiteId")
);

-- AddForeignKey
ALTER TABLE "SiteInformation" ADD CONSTRAINT "SiteInformation_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

