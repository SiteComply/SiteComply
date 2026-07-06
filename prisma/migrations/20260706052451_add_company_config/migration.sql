-- CreateTable
CREATE TABLE "CompanyConfig" (
    "id" TEXT NOT NULL,
    "companyName" TEXT,
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "tagline" TEXT,
    "logoBlobPath" TEXT,
    "logoContentType" TEXT,
    "logoUpdatedAt" TIMESTAMP(3),
    "updatedByAdminId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyConfig_pkey" PRIMARY KEY ("id")
);
