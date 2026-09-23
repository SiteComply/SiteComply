-- Induction videos, Phase 1: the script pipeline.
--
-- ADDITIVE ONLY. Five new tables and three enums; nothing existing is altered,
-- so it is safe to apply while the current build is running. The statuses and
-- job kinds for Phase 2 (narration, render, publication) are created now so the
-- workflow stays one state machine rather than growing a second.
DO $$ BEGIN
  CREATE TYPE "InductionVideoStatus" AS ENUM (
    'DRAFT', 'INFORMATION_REQUIRED', 'SCRIPT_GENERATING', 'SCRIPT_READY',
    'SCRIPT_APPROVED', 'VIDEO_GENERATING', 'VIDEO_READY', 'PUBLISHED',
    'GENERATION_FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InductionVideoJobKind" AS ENUM ('SCRIPT', 'NARRATION', 'RENDER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InductionVideoJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InductionVideo" (
  "id"               TEXT NOT NULL,
  "jobSiteId"        TEXT NOT NULL,
  "version"          INTEGER NOT NULL,
  "status"           "InductionVideoStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceHash"       TEXT,
  "provider"         TEXT,
  "model"            TEXT,
  "promptVersion"    TEXT,
  "generatedAt"      TIMESTAMP(3),
  "generatedByName"  TEXT,
  "approvedAt"       TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "approvedByName"   TEXT,
  "publishedAt"      TIMESTAMP(3),
  "publishedByName"  TEXT,
  "supersededAt"     TIMESTAMP(3),
  "blockingReasons"  JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InductionVideo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InductionVideo_jobSiteId_fkey" FOREIGN KEY ("jobSiteId")
    REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InductionVideo_jobSiteId_version_key" ON "InductionVideo"("jobSiteId", "version");
CREATE INDEX IF NOT EXISTS "InductionVideo_jobSiteId_status_idx" ON "InductionVideo"("jobSiteId", "status");

CREATE TABLE IF NOT EXISTS "InductionVideoScene" (
  "id"              TEXT NOT NULL,
  "videoId"         TEXT NOT NULL,
  "sceneType"       TEXT NOT NULL,
  "order"           INTEGER NOT NULL,
  "heading"         TEXT NOT NULL,
  "narration"       TEXT NOT NULL,
  "visualTemplate"  TEXT,
  "sourceRefs"      JSONB,
  "required"        BOOLEAN NOT NULL DEFAULT false,
  "audioBlobPath"   TEXT,
  "audioDurationMs" INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InductionVideoScene_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InductionVideoScene_videoId_fkey" FOREIGN KEY ("videoId")
    REFERENCES "InductionVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "InductionVideoScene_videoId_order_idx" ON "InductionVideoScene"("videoId", "order");

CREATE TABLE IF NOT EXISTS "InductionVideoJob" (
  "id"              TEXT NOT NULL,
  "videoId"         TEXT NOT NULL,
  "kind"            "InductionVideoJobKind" NOT NULL,
  "status"          "InductionVideoJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "providerJobId"   TEXT,
  "error"           TEXT,
  "requestedByName" TEXT,
  "startedAt"       TIMESTAMP(3),
  "finishedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InductionVideoJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InductionVideoJob_videoId_fkey" FOREIGN KEY ("videoId")
    REFERENCES "InductionVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "InductionVideoJob_status_createdAt_idx" ON "InductionVideoJob"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "InductionVideoJob_videoId_createdAt_idx" ON "InductionVideoJob"("videoId", "createdAt");

CREATE TABLE IF NOT EXISTS "InductionVideoEvent" (
  "id"        TEXT NOT NULL,
  "videoId"   TEXT NOT NULL,
  "action"    TEXT NOT NULL,
  "detail"    TEXT,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InductionVideoEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InductionVideoEvent_videoId_fkey" FOREIGN KEY ("videoId")
    REFERENCES "InductionVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "InductionVideoEvent_videoId_createdAt_idx" ON "InductionVideoEvent"("videoId", "createdAt");

CREATE TABLE IF NOT EXISTS "AiUsageEvent" (
  "id"             TEXT NOT NULL,
  "jobSiteId"      TEXT,
  "videoId"        TEXT,
  "purpose"        TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "model"          TEXT,
  "tokensPrompt"   INTEGER,
  "tokensOutput"   INTEGER,
  "speechChars"    INTEGER,
  "renderSeconds"  INTEGER,
  "estimatedPence" INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiUsageEvent_jobSiteId_createdAt_idx" ON "AiUsageEvent"("jobSiteId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageEvent_purpose_createdAt_idx" ON "AiUsageEvent"("purpose", "createdAt");
