-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('DIRECTOR', 'PROJECT_MANAGER', 'CLIENT', 'AUDITOR', 'ENGINEER', 'HS_CONSULTANT', 'PRINCIPAL_CONTRACTOR');

-- CreateEnum
CREATE TYPE "PlatformUserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT,
    "role" "PlatformRole" NOT NULL,
    "status" "PlatformUserStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PlatformUserSites" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE INDEX "PlatformUser_status_idx" ON "PlatformUser"("status");

-- CreateIndex
CREATE INDEX "PlatformUser_company_idx" ON "PlatformUser"("company");

-- CreateIndex
CREATE UNIQUE INDEX "_PlatformUserSites_AB_unique" ON "_PlatformUserSites"("A", "B");

-- CreateIndex
CREATE INDEX "_PlatformUserSites_B_index" ON "_PlatformUserSites"("B");

-- AddForeignKey
ALTER TABLE "_PlatformUserSites" ADD CONSTRAINT "_PlatformUserSites_A_fkey" FOREIGN KEY ("A") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PlatformUserSites" ADD CONSTRAINT "_PlatformUserSites_B_fkey" FOREIGN KEY ("B") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
