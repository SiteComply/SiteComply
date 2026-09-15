-- Smart Check V2.6 credentials (SC-001 Phase 2).
--
-- V2.6 authenticates with username + password + x-api-key against
-- POST /authenticate to obtain a token, then validates cards with that token.
-- CscsConfig could only hold a URL and a key, so there was nowhere to put the
-- username or the password.
--
-- Hand-written: this database was built with `db push`, so `prisma migrate dev`
-- cannot replay history on a shadow database. Apply with
--   psql -v ON_ERROR_STOP=1 -f migration.sql
--
-- Both statements are guarded, so re-running is harmless. Adding nullable
-- columns is non-destructive and needs no backfill: with no credentials stored
-- the Smart Check provider already refuses to run, which is the current state.

ALTER TABLE "CscsConfig" ADD COLUMN IF NOT EXISTS "smartCheckUsername" TEXT;
ALTER TABLE "CscsConfig" ADD COLUMN IF NOT EXISTS "smartCheckPassword" TEXT;
