-- SC-024 Phase 2 — the stored ZIP artefact for a close-out pack.
--
-- Purely ADDITIVE: five nullable/defaulted columns on CloseOutPack. No backfill.
-- Packs generated in Phase 1 simply have no archive yet; they still render and
-- print exactly as before, and an archive can be built for them on demand.

ALTER TABLE "CloseOutPack" ADD COLUMN "zipBlobPath" TEXT;
ALTER TABLE "CloseOutPack" ADD COLUMN "zipSizeBytes" INTEGER;
ALTER TABLE "CloseOutPack" ADD COLUMN "zipGeneratedAt" TIMESTAMP(3);
ALTER TABLE "CloseOutPack" ADD COLUMN "zipTruncated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CloseOutPack" ADD COLUMN "zipFileCount" INTEGER;
