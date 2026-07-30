-- SC-020 Phase 2 — Reminders & Escalations.
--
-- Purely ADDITIVE: one new NotificationEventType enum value and two nullable
-- columns on ComplianceOccurrence. No backfill, nothing rewritten, so the
-- running Phase 1 code is unaffected and this is safe to apply before the code
-- deploy.
--
-- Why only escalations get stored state: a REMINDER is a state ("due in 3 days")
-- and is derived on read, so it self-corrects when a due date moves and needs no
-- scheduler. An ESCALATION is a discrete act, and "was management told, and
-- when" is exactly the question a stored record answers and a derived view
-- cannot. `escalatedAt` doubles as the idempotency guard: the escalation is
-- recorded only while it is null, so it fires exactly once without a timer.

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'COMPLIANCE_ESCALATED';

-- AlterTable
ALTER TABLE "ComplianceOccurrence" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalatedToRole" "PlatformRole";

-- CreateIndex — finding occurrences awaiting escalation is a hot path on every
-- calendar read, so it must not be a full scan.
CREATE INDEX "ComplianceOccurrence_escalatedAt_status_idx" ON "ComplianceOccurrence"("escalatedAt", "status");
