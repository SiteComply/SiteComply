-- Induction videos, Phase 3: the rendered MP4, publication and the watching record.
--
-- ADDITIVE ONLY. Six nullable columns, one new table, one boolean that defaults
-- to false. Nothing existing changes, so this is safe to apply while the site is
-- live and before the build that uses it ships.
--
-- The new table is the evidential half of the feature: who watched which
-- VERSION, how far they got, and whether they finished.

ALTER TABLE "InductionVideo"
  ADD COLUMN IF NOT EXISTS "videoBlobPath" TEXT,
  ADD COLUMN IF NOT EXISTS "videoDurationMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "videoSizeBytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "renderEngine" TEXT,
  ADD COLUMN IF NOT EXISTS "renderedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "renderHash" TEXT;

-- Ships dark: a site adopts the video when it chooses to, and nobody is locked
-- out of an induction on the day this deploys.
ALTER TABLE "SiteInductionConfig"
  ADD COLUMN IF NOT EXISTS "inductionVideoRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "InductionVideoView" (
  "id"              TEXT NOT NULL,
  "videoId"         TEXT NOT NULL,
  "workerId"        TEXT NOT NULL,
  "workerName"      TEXT NOT NULL,
  "jobSiteId"       TEXT NOT NULL,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"     TIMESTAMP(3),
  "furthestMs"      INTEGER NOT NULL DEFAULT 0,
  "videoDurationMs" INTEGER,
  "submissionId"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InductionVideoView_pkey" PRIMARY KEY ("id")
);

-- One row per operative per version, updated as they watch.
CREATE UNIQUE INDEX IF NOT EXISTS "InductionVideoView_videoId_workerId_key"
  ON "InductionVideoView"("videoId", "workerId");
CREATE INDEX IF NOT EXISTS "InductionVideoView_jobSiteId_completedAt_idx"
  ON "InductionVideoView"("jobSiteId", "completedAt");
CREATE INDEX IF NOT EXISTS "InductionVideoView_workerId_completedAt_idx"
  ON "InductionVideoView"("workerId", "completedAt");

-- CASCADE on both: a deleted version or a deleted worker takes its view rows
-- with it, exactly as the scenes and jobs already do.
ALTER TABLE "InductionVideoView"
  DROP CONSTRAINT IF EXISTS "InductionVideoView_videoId_fkey",
  ADD CONSTRAINT "InductionVideoView_videoId_fkey"
    FOREIGN KEY ("videoId") REFERENCES "InductionVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InductionVideoView"
  DROP CONSTRAINT IF EXISTS "InductionVideoView_workerId_fkey",
  ADD CONSTRAINT "InductionVideoView_workerId_fkey"
    FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
