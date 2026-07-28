-- CreateEnum
CREATE TYPE "GpsUnavailablePolicy" AS ENUM ('BLOCK', 'ALLOW_FLAGGED');

-- AlterTable
ALTER TABLE "JobSite" ADD COLUMN     "checkInRadiusM" INTEGER,
ADD COLUMN     "gpsCheckInEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gpsUnavailablePolicy" "GpsUnavailablePolicy" NOT NULL DEFAULT 'BLOCK',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "checkInAccuracyM" DOUBLE PRECISION,
ADD COLUMN     "checkInDistanceM" DOUBLE PRECISION,
ADD COLUMN     "checkInLat" DOUBLE PRECISION,
ADD COLUMN     "checkInLng" DOUBLE PRECISION,
ADD COLUMN     "checkOutAccuracyM" DOUBLE PRECISION,
ADD COLUMN     "checkOutDistanceM" DOUBLE PRECISION,
ADD COLUMN     "checkOutLat" DOUBLE PRECISION,
ADD COLUMN     "checkOutLng" DOUBLE PRECISION,
ADD COLUMN     "gpsUnavailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overrideByName" TEXT,
ADD COLUMN     "overrideReason" TEXT;

-- CreateTable
CREATE TABLE "CheckInOverride" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "grantedByName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckInOverride_workerId_jobSiteId_usedAt_idx" ON "CheckInOverride"("workerId", "jobSiteId", "usedAt");

-- CreateIndex
CREATE INDEX "CheckInOverride_jobSiteId_createdAt_idx" ON "CheckInOverride"("jobSiteId", "createdAt");

-- AddForeignKey
ALTER TABLE "CheckInOverride" ADD CONSTRAINT "CheckInOverride_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInOverride" ADD CONSTRAINT "CheckInOverride_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

