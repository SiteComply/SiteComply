-- Induction videos, Phase 2: narration, captions and the transcript.
--
-- ADDITIVE ONLY. Two new statuses and seven nullable columns; no existing row
-- changes and nothing is dropped, so a Phase 1 video keeps working untouched
-- and this migration is safe to apply while the site is live.
--
-- The enum values are placed BEFORE 'VIDEO_GENERATING' so the type still reads
-- in workflow order - script, narration, video - which is how it is displayed.

ALTER TYPE "InductionVideoStatus" ADD VALUE IF NOT EXISTS 'NARRATION_GENERATING' BEFORE 'VIDEO_GENERATING';
ALTER TYPE "InductionVideoStatus" ADD VALUE IF NOT EXISTS 'NARRATION_READY' BEFORE 'VIDEO_GENERATING';

ALTER TABLE "InductionVideo"
  ADD COLUMN IF NOT EXISTS "voice" TEXT,
  ADD COLUMN IF NOT EXISTS "narrationAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "narrationDurationMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "narrationHash" TEXT,
  ADD COLUMN IF NOT EXISTS "captionsBlobPath" TEXT,
  ADD COLUMN IF NOT EXISTS "transcriptBlobPath" TEXT;

ALTER TABLE "InductionVideoScene"
  ADD COLUMN IF NOT EXISTS "audioHash" TEXT;
