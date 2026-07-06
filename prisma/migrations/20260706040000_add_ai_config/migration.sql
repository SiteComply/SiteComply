-- CreateTable
CREATE TABLE "AiConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "activeProvider" TEXT NOT NULL DEFAULT 'mock',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "allowedRoles" JSONB NOT NULL DEFAULT '[]',
    "dailyPerUser" INTEGER,
    "monthlyGlobal" INTEGER,
    "updatedByAdminId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

