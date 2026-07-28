-- CreateEnum
CREATE TYPE "SignatureType" AS ENUM ('DRAWN', 'TYPED');

-- AlterTable
ALTER TABLE "SiteInductionConfig" ADD COLUMN     "inductionSignatureRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "declarationAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "declarationText" TEXT,
ADD COLUMN     "signatureBlobPath" TEXT,
ADD COLUMN     "signatureType" "SignatureType",
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedName" TEXT;

