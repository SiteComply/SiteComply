-- SC-017 Photo Annotation Tools.
-- Purely ADDITIVE: three nullable/defaulted columns on each of FindingEvidence,
-- ActionEvidence and Document. No backfill, nothing rewritten — existing uploads
-- keep working exactly as before and simply read as "not annotated".
--
-- The ORIGINAL upload is never overwritten. An annotated photo is stored as its
-- OWN row (annotated = true) pointing back at the original via
-- originalEvidenceId / originalDocumentId, so the untouched camera image always
-- remains part of the audit record. annotationData holds the editable vector
-- annotation list so annotations can be reopened later; the flattened image
-- stays authoritative for display and print.

-- AlterTable
ALTER TABLE "FindingEvidence" ADD COLUMN     "annotated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalEvidenceId" TEXT,
ADD COLUMN     "annotationData" JSONB;

-- AlterTable
ALTER TABLE "ActionEvidence" ADD COLUMN     "annotated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalEvidenceId" TEXT,
ADD COLUMN     "annotationData" JSONB;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "annotated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalDocumentId" TEXT,
ADD COLUMN     "annotationData" JSONB;

-- CreateIndex
CREATE INDEX "FindingEvidence_originalEvidenceId_idx" ON "FindingEvidence"("originalEvidenceId");

-- CreateIndex
CREATE INDEX "ActionEvidence_originalEvidenceId_idx" ON "ActionEvidence"("originalEvidenceId");

-- CreateIndex
CREATE INDEX "Document_originalDocumentId_idx" ON "Document"("originalDocumentId");
