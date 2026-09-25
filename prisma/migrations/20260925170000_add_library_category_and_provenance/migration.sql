-- CreateEnum
CREATE TYPE "LibraryCategory" AS ENUM ('COMPANY_CULTURE', 'PPE', 'BEHAVIOUR', 'MANUAL_HANDLING', 'HOUSEKEEPING', 'ENVIRONMENT', 'REPORTING', 'OTHER');

-- CreateEnum
CREATE TYPE "LibraryProvenance" AS ENUM ('UPLOADED', 'GENERATED');

-- AlterTable
ALTER TABLE "LibraryAsset" ADD COLUMN     "category" "LibraryCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "provenance" "LibraryProvenance" NOT NULL DEFAULT 'UPLOADED';

-- AlterTable
ALTER TABLE "LibraryAssetRevision" ADD COLUMN     "sourceModuleRevisionId" TEXT;
