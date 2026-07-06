-- CreateEnum
CREATE TYPE "ActionActivityType" AS ENUM ('CREATED', 'COMMENT', 'STATUS_CHANGE', 'ASSIGNMENT');

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "completionNote" TEXT;

-- CreateTable
CREATE TABLE "ActionActivity" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "type" "ActionActivityType" NOT NULL,
    "note" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionActivity_actionId_createdAt_idx" ON "ActionActivity"("actionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ActionActivity" ADD CONSTRAINT "ActionActivity_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

