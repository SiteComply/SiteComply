-- CreateEnum
CREATE TYPE "BulletinCategory" AS ENUM ('NOTICE', 'ANNOUNCEMENT', 'SAFETY_ALERT');

-- CreateTable
CREATE TABLE "SiteBulletin" (
    "id" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "category" "BulletinCategory" NOT NULL DEFAULT 'NOTICE',
    "title" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteBulletin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteBulletinRead" (
    "id" TEXT NOT NULL,
    "bulletinId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteBulletinRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteBulletin_jobSiteId_active_publishedAt_idx" ON "SiteBulletin"("jobSiteId", "active", "publishedAt");

-- CreateIndex
CREATE INDEX "SiteBulletinRead_workerId_idx" ON "SiteBulletinRead"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteBulletinRead_bulletinId_workerId_key" ON "SiteBulletinRead"("bulletinId", "workerId");

-- AddForeignKey
ALTER TABLE "SiteBulletin" ADD CONSTRAINT "SiteBulletin_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBulletinRead" ADD CONSTRAINT "SiteBulletinRead_bulletinId_fkey" FOREIGN KEY ("bulletinId") REFERENCES "SiteBulletin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBulletinRead" ADD CONSTRAINT "SiteBulletinRead_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

