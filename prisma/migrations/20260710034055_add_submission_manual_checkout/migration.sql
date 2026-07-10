-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "checkedOutByName" TEXT,
ADD COLUMN     "checkedOutByUserId" TEXT,
ADD COLUMN     "checkedOutManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkedOutReason" TEXT;
