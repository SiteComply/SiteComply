-- AlterTable
ALTER TABLE "PlatformAccessRequest" ADD COLUMN     "createdPlatformUserId" TEXT,
ADD COLUMN     "reviewedByAdminId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccessRequest_createdPlatformUserId_key" ON "PlatformAccessRequest"("createdPlatformUserId");

-- AddForeignKey
ALTER TABLE "PlatformAccessRequest" ADD CONSTRAINT "PlatformAccessRequest_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAccessRequest" ADD CONSTRAINT "PlatformAccessRequest_createdPlatformUserId_fkey" FOREIGN KEY ("createdPlatformUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

