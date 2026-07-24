-- SC-001: CSCS Smart Check verification & competency record fields on Worker.
-- All columns are additive and nullable (cscsVerified defaults false), so
-- existing worker rows and queries are unaffected.

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "cscsCardImagePath" TEXT,
ADD COLUMN     "cscsHolderName" TEXT,
ADD COLUMN     "cscsQualifications" JSONB,
ADD COLUMN     "cscsScheme" TEXT,
ADD COLUMN     "cscsVerificationStatus" TEXT,
ADD COLUMN     "cscsVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cscsVerifiedAt" TIMESTAMP(3);
