-- CreateEnum
CREATE TYPE "PermitStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PermitQuestionType" AS ENUM ('ACKNOWLEDGEMENT', 'YES_NO', 'TEXT', 'DATE');

-- CreateEnum
CREATE TYPE "PermitActivityType" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'CLOSED', 'COMMENT');

-- CreateTable
CREATE TABLE "PermitType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referencePrefix" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'permit',
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermitType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermitTypeQuestion" (
    "id" TEXT NOT NULL,
    "permitTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "PermitQuestionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,

    CONSTRAINT "PermitTypeQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permit" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "permitTypeId" TEXT NOT NULL,
    "permitTypeKey" TEXT NOT NULL,
    "permitTypeName" TEXT NOT NULL,
    "status" "PermitStatus" NOT NULL DEFAULT 'SUBMITTED',
    "workActivity" TEXT NOT NULL,
    "workLocation" TEXT,
    "proposedStart" TIMESTAMP(3),
    "proposedFinish" TIMESTAMP(3),
    "answers" JSONB NOT NULL,
    "submittedByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedByName" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "closedByName" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermitActivity" (
    "id" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "type" "PermitActivityType" NOT NULL,
    "note" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "actorKind" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermitActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PermitType_key_key" ON "PermitType"("key");

-- CreateIndex
CREATE INDEX "PermitType_active_order_idx" ON "PermitType"("active", "order");

-- CreateIndex
CREATE INDEX "PermitTypeQuestion_permitTypeId_order_idx" ON "PermitTypeQuestion"("permitTypeId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Permit_reference_key" ON "Permit"("reference");

-- CreateIndex
CREATE INDEX "Permit_jobSiteId_status_idx" ON "Permit"("jobSiteId", "status");

-- CreateIndex
CREATE INDEX "Permit_workerId_status_idx" ON "Permit"("workerId", "status");

-- CreateIndex
CREATE INDEX "PermitActivity_permitId_createdAt_idx" ON "PermitActivity"("permitId", "createdAt");

-- AddForeignKey
ALTER TABLE "PermitTypeQuestion" ADD CONSTRAINT "PermitTypeQuestion_permitTypeId_fkey" FOREIGN KEY ("permitTypeId") REFERENCES "PermitType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permit" ADD CONSTRAINT "Permit_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permit" ADD CONSTRAINT "Permit_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permit" ADD CONSTRAINT "Permit_permitTypeId_fkey" FOREIGN KEY ("permitTypeId") REFERENCES "PermitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitActivity" ADD CONSTRAINT "PermitActivity_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "Permit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

