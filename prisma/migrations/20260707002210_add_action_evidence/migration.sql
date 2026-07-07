-- CreateTable
CREATE TABLE "ActionEvidence" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "blobPath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionEvidence_actionId_createdAt_idx" ON "ActionEvidence"("actionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ActionEvidence" ADD CONSTRAINT "ActionEvidence_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;
