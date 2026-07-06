-- CreateTable
CREATE TABLE "AuthConfig" (
    "id" TEXT NOT NULL,
    "otpTtlSeconds" INTEGER,
    "otpMaxAttempts" INTEGER,
    "sessionTtlSeconds" INTEGER,
    "smsOtpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailOtpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByAdminId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthConfig_pkey" PRIMARY KEY ("id")
);
