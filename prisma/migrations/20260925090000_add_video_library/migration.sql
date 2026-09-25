-- THE VIDEO LIBRARY: reusable footage inserted into every site's induction.
--
-- The counterpart to company induction modules. Those are reusable TEXT the model
-- speaks; these are finished segments concatenated into the rendered video. Same
-- lifecycle (DRAFT -> ISSUED -> SUPERSEDED) for the same reason: what an operative
-- was shown has to be answerable years later.
--
-- ALL ADDITIVE. Four new tables, two new enums, one new value on an existing enum.
-- Nothing existing is altered, so the current build keeps working against this
-- schema and the migration is safe to apply before deploying.
CREATE TYPE "LibraryPlacement" AS ENUM ('OPENING', 'COMPANY_BAND', 'CLOSING');
CREATE TYPE "LibraryRevisionStatus" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED');

CREATE TABLE "LibraryAsset" (
  "id"              TEXT NOT NULL,
  "slug"            TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT,
  "placement"       "LibraryPlacement" NOT NULL DEFAULT 'COMPANY_BAND',
  "order"           INTEGER NOT NULL DEFAULT 0,
  "moduleId"        TEXT,
  "defaultIncluded" BOOLEAN NOT NULL DEFAULT true,
  "mandatory"       BOOLEAN NOT NULL DEFAULT false,
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "createdByName"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LibraryAsset_slug_key" ON "LibraryAsset"("slug");
CREATE INDEX "LibraryAsset_active_order_idx" ON "LibraryAsset"("active", "order");
CREATE INDEX "LibraryAsset_moduleId_idx" ON "LibraryAsset"("moduleId");

-- SetNull, not Cascade: retiring a company module must not delete the footage that
-- replaced it. The asset simply stops being a replacement and stands on its own.
ALTER TABLE "LibraryAsset"
  ADD CONSTRAINT "LibraryAsset_moduleId_fkey" FOREIGN KEY ("moduleId")
  REFERENCES "InductionModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LibraryAssetRevision" (
  "id"                 TEXT NOT NULL,
  "assetId"            TEXT NOT NULL,
  "version"            INTEGER NOT NULL,
  "status"             "LibraryRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceBlobPath"     TEXT,
  "sourceFileName"     TEXT,
  "sourceBytes"        INTEGER,
  "normalisedBlobPath" TEXT,
  "normalisedBytes"    INTEGER,
  "durationMs"         INTEGER,
  "captionsBlobPath"   TEXT,
  "captionsFileName"   TEXT,
  "normaliseError"     TEXT,
  "contentHash"        TEXT,
  "preparedByUserId"   TEXT,
  "preparedByAdminId"  TEXT,
  "preparedByName"     TEXT NOT NULL,
  "preparedByRealm"    TEXT,
  "preparedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedByUserId"     TEXT,
  "issuedByAdminId"    TEXT,
  "issuedByName"       TEXT,
  "issuedByRealm"      TEXT,
  "issuedAt"           TIMESTAMP(3),
  "issueNote"          TEXT,
  "supersededAt"       TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryAssetRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LibraryAssetRevision_assetId_version_key"
  ON "LibraryAssetRevision"("assetId", "version");
CREATE INDEX "LibraryAssetRevision_assetId_status_idx"
  ON "LibraryAssetRevision"("assetId", "status");
ALTER TABLE "LibraryAssetRevision"
  ADD CONSTRAINT "LibraryAssetRevision_assetId_fkey" FOREIGN KEY ("assetId")
  REFERENCES "LibraryAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LibraryAssetEvent" (
  "id"         TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "detail"     TEXT,
  "actorName"  TEXT NOT NULL,
  "actorRealm" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryAssetEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LibraryAssetEvent_revisionId_createdAt_idx"
  ON "LibraryAssetEvent"("revisionId", "createdAt");
ALTER TABLE "LibraryAssetEvent"
  ADD CONSTRAINT "LibraryAssetEvent_revisionId_fkey" FOREIGN KEY ("revisionId")
  REFERENCES "LibraryAssetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SiteLibraryAsset" (
  "id"               TEXT NOT NULL,
  "jobSiteId"        TEXT NOT NULL,
  "assetId"          TEXT NOT NULL,
  "included"         BOOLEAN NOT NULL,
  "reason"           TEXT,
  "decidedByUserId"  TEXT,
  "decidedByAdminId" TEXT,
  "decidedByName"    TEXT,
  "decidedByRealm"   TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteLibraryAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteLibraryAsset_jobSiteId_assetId_key"
  ON "SiteLibraryAsset"("jobSiteId", "assetId");
CREATE INDEX "SiteLibraryAsset_jobSiteId_idx" ON "SiteLibraryAsset"("jobSiteId");
ALTER TABLE "SiteLibraryAsset"
  ADD CONSTRAINT "SiteLibraryAsset_jobSiteId_fkey" FOREIGN KEY ("jobSiteId")
  REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteLibraryAsset"
  ADD CONSTRAINT "SiteLibraryAsset_assetId_fkey" FOREIGN KEY ("assetId")
  REFERENCES "LibraryAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Transcoding a library upload. Its OWN table rather than a kind of
-- InductionVideoJob: every job there belongs to a video and is that video's lock,
-- and a normalise job belongs to a revision and no video. Reusing it would have
-- meant a nullable videoId for every kind to suit one.
CREATE TABLE "LibraryNormaliseJob" (
  "id"              TEXT NOT NULL,
  "revisionId"      TEXT NOT NULL,
  "status"          "InductionVideoJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "error"           TEXT,
  "requestedByName" TEXT,
  "startedAt"       TIMESTAMP(3),
  "finishedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryNormaliseJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LibraryNormaliseJob_status_createdAt_idx"
  ON "LibraryNormaliseJob"("status", "createdAt");
CREATE INDEX "LibraryNormaliseJob_revisionId_createdAt_idx"
  ON "LibraryNormaliseJob"("revisionId", "createdAt");
ALTER TABLE "LibraryNormaliseJob"
  ADD CONSTRAINT "LibraryNormaliseJob_revisionId_fkey" FOREIGN KEY ("revisionId")
  REFERENCES "LibraryAssetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
