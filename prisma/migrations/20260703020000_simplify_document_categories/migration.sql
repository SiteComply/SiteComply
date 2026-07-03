-- Simplify DocumentCategory to four broad buckets, migrating existing values:
--   METHOD_STATEMENT        -> RAMS       (RAMS already means Risk Assessment & Method Statement)
--   TOOLBOX_TALK, PERMIT    -> GENERAL
--   TRAINING_CERTIFICATE,
--   PLANT_CERTIFICATE       -> CERTIFICATE
-- RAMS, INSURANCE and GENERAL are unchanged.

-- 1) Collapse values that map onto categories that already exist in the old enum.
UPDATE "Document" SET "category" = 'RAMS' WHERE "category" = 'METHOD_STATEMENT';
UPDATE "Document" SET "category" = 'GENERAL' WHERE "category" IN ('TOOLBOX_TALK', 'PERMIT');

-- 2) Create the new, narrowed enum type.
CREATE TYPE "DocumentCategory_new" AS ENUM ('RAMS', 'INSURANCE', 'CERTIFICATE', 'GENERAL');

-- 3) Move the column onto the new type, folding the certificate values into CERTIFICATE.
ALTER TABLE "Document"
  ALTER COLUMN "category" TYPE "DocumentCategory_new"
  USING (
    CASE "category"::text
      WHEN 'TRAINING_CERTIFICATE' THEN 'CERTIFICATE'
      WHEN 'PLANT_CERTIFICATE' THEN 'CERTIFICATE'
      ELSE "category"::text
    END::"DocumentCategory_new"
  );

-- 4) Replace the old type with the new one.
DROP TYPE "DocumentCategory";
ALTER TYPE "DocumentCategory_new" RENAME TO "DocumentCategory";
