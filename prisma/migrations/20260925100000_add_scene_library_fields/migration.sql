-- A scene can now BE a piece of Library footage rather than a generated frame.
--
-- Denormalised onto the scene, exactly as moduleRevisionId is, and for the same
-- reason: a published video is the record of what an operative was shown. If the
-- renderer looked the footage up through the asset at render time, re-issuing or
-- retiring an asset would silently change what an already-published induction
-- contains.
--
-- ALL ADDITIVE AND ALL NULLABLE. Every existing scene is generated, so NULL is
-- correct for every existing row and there is no backfill.
ALTER TABLE "InductionVideoScene"
  ADD COLUMN IF NOT EXISTS "libraryRevisionId"       TEXT,
  ADD COLUMN IF NOT EXISTS "libraryBlobPath"         TEXT,
  ADD COLUMN IF NOT EXISTS "libraryCaptionsBlobPath" TEXT,
  ADD COLUMN IF NOT EXISTS "libraryDurationMs"       INTEGER;

CREATE INDEX IF NOT EXISTS "InductionVideoScene_libraryRevisionId_idx"
  ON "InductionVideoScene"("libraryRevisionId");
