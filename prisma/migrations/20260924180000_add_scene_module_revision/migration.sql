-- Induction modules, Phase B: which company revision a scene's words are.
--
-- ADDITIVE, one nullable column. Existing scenes are all site-derived, so NULL
-- is the correct value for every row that already exists and no backfill is
-- needed.
--
-- Deliberately NOT a foreign key to InductionModuleRevision. A published video
-- is the record of what an operative was shown; if a module were ever hard
-- deleted, a cascade would rewrite that record, and a restrict would block the
-- delete. The id is kept as a reference the way every other denormalised audit
-- value here is.
ALTER TABLE "InductionVideoScene"
  ADD COLUMN IF NOT EXISTS "moduleRevisionId" TEXT;

CREATE INDEX IF NOT EXISTS "InductionVideoScene_moduleRevisionId_idx"
  ON "InductionVideoScene"("moduleRevisionId");
