-- Induction videos: WHICH REALM an action came from.
--
-- Admin Centre OWNER and ADMIN users now have authority equivalent to a Platform
-- Director for induction video management - generate, approve, publish, retire -
-- so "approved by Jane Smith" must be able to say whether that was a Director or
-- a platform administrator.
--
-- ALL ADDITIVE AND ALL NULLABLE. No defaults, so ADD COLUMN is metadata-only in
-- PG 16 and there is no table rewrite. Existing rows are deliberately left NULL
-- rather than backfilled to 'PLATFORM': null means "recorded before this was
-- tracked", which is true, and a backfill would assert something about history
-- that nothing verified.
--
-- The *AdminId columns exist because an admin id must never be written into a
-- *ByUserId column - it references a different table, and a dangling id in an
-- audit record is worse than an absent one.
ALTER TABLE "InductionVideo"
  ADD COLUMN IF NOT EXISTS "generatedByRealm"   TEXT,
  ADD COLUMN IF NOT EXISTS "approvedByAdminId"  TEXT,
  ADD COLUMN IF NOT EXISTS "approvedByRealm"    TEXT,
  ADD COLUMN IF NOT EXISTS "publishedByAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "publishedByRealm"   TEXT;

ALTER TABLE "InductionVideoEvent"
  ADD COLUMN IF NOT EXISTS "actorRealm" TEXT;
