-- COMPANY INDUCTION MODULES — Phase A: the model and its management.
--
-- ADDITIVE ONLY. Four new tables and three new enums; nothing existing changes,
-- so this is safe to apply while the site is live and before the build ships.
--
-- NOTHING REACHES AN INDUCTION YET. A module only reaches a site once it has an
-- ISSUED revision, and the video generator does not read these tables at all
-- until Phase B. Applying this migration changes nothing an operative sees.

CREATE TYPE "InductionModuleCategory" AS ENUM ('SAFETY', 'BEHAVIOUR', 'ENVIRONMENT', 'REPORTING');
CREATE TYPE "InductionModuleRevisionStatus" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED');
CREATE TYPE "SiteInductionModuleState" AS ENUM ('INCLUDED', 'EXCLUDED', 'OVERRIDDEN');

CREATE TABLE "InductionModule" (
  "id"                TEXT NOT NULL,
  "slug"              TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "category"          "InductionModuleCategory" NOT NULL DEFAULT 'SAFETY',
  "order"             INTEGER NOT NULL DEFAULT 0,
  "mandatory"         BOOLEAN NOT NULL DEFAULT false,
  "defaultIncluded"   BOOLEAN NOT NULL DEFAULT true,
  "replacesSceneType" TEXT,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId"   TEXT,
  "createdByName"     TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InductionModule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InductionModule_slug_key" ON "InductionModule"("slug");
CREATE INDEX "InductionModule_active_order_idx" ON "InductionModule"("active", "order");

CREATE TABLE "InductionModuleRevision" (
  "id"               TEXT NOT NULL,
  "moduleId"         TEXT NOT NULL,
  "version"          INTEGER NOT NULL,
  "status"           "InductionModuleRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "heading"          TEXT NOT NULL,
  "narration"        TEXT NOT NULL,
  "contentHash"      TEXT NOT NULL,
  "preparedByUserId" TEXT,
  "preparedByName"   TEXT NOT NULL,
  "preparedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedByUserId"   TEXT,
  "issuedByName"     TEXT,
  "issuedAt"         TIMESTAMP(3),
  "issueNote"        TEXT,
  "supersededAt"     TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InductionModuleRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InductionModuleRevision_moduleId_version_key"
  ON "InductionModuleRevision"("moduleId", "version");
CREATE INDEX "InductionModuleRevision_moduleId_status_idx"
  ON "InductionModuleRevision"("moduleId", "status");

CREATE TABLE "InductionModuleEvent" (
  "id"         TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "detail"     TEXT,
  "actorName"  TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InductionModuleEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InductionModuleEvent_revisionId_createdAt_idx"
  ON "InductionModuleEvent"("revisionId", "createdAt");

CREATE TABLE "SiteInductionModule" (
  "id"                TEXT NOT NULL,
  "jobSiteId"         TEXT NOT NULL,
  "moduleId"          TEXT NOT NULL,
  "state"             "SiteInductionModuleState" NOT NULL,
  "overrideNarration" TEXT,
  "reason"            TEXT,
  "decidedByUserId"   TEXT,
  "decidedByName"     TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteInductionModule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteInductionModule_jobSiteId_moduleId_key"
  ON "SiteInductionModule"("jobSiteId", "moduleId");
CREATE INDEX "SiteInductionModule_jobSiteId_idx" ON "SiteInductionModule"("jobSiteId");

-- CASCADE throughout: a deleted module takes its revisions, their history and
-- every site's decision about it with it.
ALTER TABLE "InductionModuleRevision"
  ADD CONSTRAINT "InductionModuleRevision_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "InductionModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InductionModuleEvent"
  ADD CONSTRAINT "InductionModuleEvent_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "InductionModuleRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteInductionModule"
  ADD CONSTRAINT "SiteInductionModule_jobSiteId_fkey"
  FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteInductionModule"
  ADD CONSTRAINT "SiteInductionModule_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "InductionModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
