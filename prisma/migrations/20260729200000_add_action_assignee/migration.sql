-- SC-015 Mandatory Action Assignment.
-- Purely ADDITIVE: three nullable columns on "Action" plus their indexes and
-- foreign keys. `assignedTo` (the existing free-text name) is UNCHANGED and now
-- serves as the denormalised name snapshot, so legacy actions keep their value
-- and stay readable. Mandatory assignment is enforced in validation for NEWLY
-- created actions only — deliberately NOT a NOT NULL constraint, which would
-- require inventing an assignee for every historic action.

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "assignedToCompany" TEXT,
ADD COLUMN     "assignedWorkerId" TEXT,
ADD COLUMN     "assignedPlatformUserId" TEXT;

-- CreateIndex
CREATE INDEX "Action_assignedWorkerId_idx" ON "Action"("assignedWorkerId");

-- CreateIndex
CREATE INDEX "Action_assignedPlatformUserId_idx" ON "Action"("assignedPlatformUserId");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_assignedPlatformUserId_fkey" FOREIGN KEY ("assignedPlatformUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
