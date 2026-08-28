-- BL-001 — authorised manual check-out.
--
-- Five additive columns on "Submission". Four are nullable and one carries a
-- constant default, so this is a metadata-only change on PostgreSQL 11+ (no
-- table rewrite) and is reversible with DROP COLUMN.
--
-- Production's App Service startup command is `next start`, so
-- `prisma migrate deploy` never runs. Apply this by hand, then record it in
-- "_prisma_migrations" so a future migration run does not try to re-apply it.
ALTER TABLE "Submission"
  ADD COLUMN IF NOT EXISTS "checkedOutManual"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "checkedOutByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "checkedOutByName"   TEXT,
  ADD COLUMN IF NOT EXISTS "checkedOutByRole"   TEXT,
  ADD COLUMN IF NOT EXISTS "checkedOutReason"   TEXT;
