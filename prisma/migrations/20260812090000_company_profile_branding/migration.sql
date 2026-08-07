-- Company Profile & Branding — organisation-wide settings owned by Platform.
--
-- Purely ADDITIVE. Nineteen columns on the existing CompanyConfig singleton.
-- No column is altered or dropped, no table is created, there is no backfill
-- and no row is written.
--
-- SAFE TO APPLY BEFORE THE CODE DEPLOY. The build currently in production has
-- no Prisma client for these columns and never selects them. Every boolean
-- defaults TRUE, which reproduces exactly what close-out packs render today:
-- company info, logo and standard details all appear. Nothing changes for
-- anyone until a Director saves.
--
-- Text columns are nullable with no default. NULL means "not set", and every
-- reader falls back to what it does now — the hard-coded pack disclaimer stays
-- in place until an organisation supplies its own.
ALTER TABLE "CompanyConfig" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "addressPostcode" TEXT,
ADD COLUMN     "addressTown" TEXT,
ADD COLUMN     "disclaimer" TEXT,
ADD COLUMN     "packIncludeCompanyInfo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "packIncludeLogo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "packIncludePrintLogo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "packIncludeStandardDetails" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "primaryContactName" TEXT,
ADD COLUMN     "primaryEmail" TEXT,
ADD COLUMN     "primaryPhone" TEXT,
ADD COLUMN     "printLogoBlobPath" TEXT,
ADD COLUMN     "printLogoContentType" TEXT,
ADD COLUMN     "printLogoUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "reportFooter" TEXT,
ADD COLUMN     "updatedByUserId" TEXT,
ADD COLUMN     "vatNumber" TEXT,
ADD COLUMN     "website" TEXT;
