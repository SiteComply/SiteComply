-- Company induction modules: WHICH REALM an action came from.
--
-- Company modules are now administered from two places - Induction Videos (a
-- Platform user with a PlatformRole) and the Admin Centre (an Entra SSO admin
-- with an AdminRole). The two realms share no role vocabulary and no user table.
--
-- ALL ADDITIVE AND ALL NULLABLE. Every existing row was written by a Platform
-- user, but they are deliberately left NULL rather than backfilled to 'PLATFORM':
-- a null means "recorded before this was tracked", which is true, whereas a
-- backfill would assert something about history that nothing verified.
--
-- The *AdminId columns exist because an admin id must never be written into a
-- *UserId column - it references a different table, and a dangling id in an audit
-- record is worse than an absent one.
ALTER TABLE "InductionModuleRevision"
  ADD COLUMN IF NOT EXISTS "preparedByAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "preparedByRealm"   TEXT,
  ADD COLUMN IF NOT EXISTS "issuedByAdminId"   TEXT,
  ADD COLUMN IF NOT EXISTS "issuedByRealm"     TEXT;

ALTER TABLE "InductionModuleEvent"
  ADD COLUMN IF NOT EXISTS "actorRealm" TEXT;

ALTER TABLE "SiteInductionModule"
  ADD COLUMN IF NOT EXISTS "decidedByAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "decidedByRealm"   TEXT;
