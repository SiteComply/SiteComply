-- CreateTable
CREATE TABLE "SmsConfig" (
    "id" TEXT NOT NULL,
    "activeProvider" TEXT NOT NULL DEFAULT 'mock',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedByAdminId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsConfig_pkey" PRIMARY KEY ("id")
);

