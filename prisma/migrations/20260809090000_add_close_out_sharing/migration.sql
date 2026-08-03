-- SC-024 Phase 3 — AI narrative provenance + secure sharing.
--
-- Purely ADDITIVE. Four nullable columns on CloseOutPack (AI provenance; the
-- prose itself already has a home in the unused Phase 1 `aiSummary` column) and
-- two new tables for share links and their access log. No backfill: a pack with
-- no AI columns simply has no narrative, and a pack with no shares has never
-- been shared — both of which are the truth for every existing row.

-- The AI target enum gains one value. Existing rows are unaffected.
ALTER TYPE "AiSummaryTarget" ADD VALUE IF NOT EXISTS 'CLOSE_OUT_PACK';

ALTER TABLE "CloseOutPack" ADD COLUMN "aiGeneratedAt" TIMESTAMP(3);
ALTER TABLE "CloseOutPack" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "CloseOutPack" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "CloseOutPack" ADD COLUMN "aiGeneratedBy" TEXT;

CREATE TABLE "CloseOutPackShare" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    -- SHA-256 of the URL token. The token itself is never stored, so a database
    -- leak does not yield working links.
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "includeZip" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CloseOutPackShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CloseOutPackShareView" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "ipHash" TEXT,

    CONSTRAINT "CloseOutPackShareView_pkey" PRIMARY KEY ("id")
);

-- Unique so resolving a token is one indexed read, and so two shares can never
-- collide on the same secret.
CREATE UNIQUE INDEX "CloseOutPackShare_tokenHash_key" ON "CloseOutPackShare"("tokenHash");
CREATE INDEX "CloseOutPackShare_packId_createdAt_idx" ON "CloseOutPackShare"("packId", "createdAt");
CREATE INDEX "CloseOutPackShare_expiresAt_idx" ON "CloseOutPackShare"("expiresAt");
CREATE INDEX "CloseOutPackShareView_shareId_viewedAt_idx" ON "CloseOutPackShareView"("shareId", "viewedAt");

-- Cascade: revoking a pack must not leave live links pointing at it.
ALTER TABLE "CloseOutPackShare" ADD CONSTRAINT "CloseOutPackShare_packId_fkey"
    FOREIGN KEY ("packId") REFERENCES "CloseOutPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CloseOutPackShareView" ADD CONSTRAINT "CloseOutPackShareView_shareId_fkey"
    FOREIGN KEY ("shareId") REFERENCES "CloseOutPackShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
