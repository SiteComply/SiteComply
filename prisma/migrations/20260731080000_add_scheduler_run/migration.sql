-- SC-020 Phase 4 — scheduler run tracking.
--
-- Purely ADDITIVE: one new enum and one new table. Nothing existing is touched
-- and there is no backfill, so the running Phase 3 code is unaffected and this is
-- safe to apply before the code deploy.
--
-- The point of this table is OBSERVABILITY. Lazy generation is retained as a
-- fallback, so the calendar is never wrong when someone looks at it — but that
-- also means a dead timer would be invisible. Recording only triggered runs makes
-- the newest row a truthful answer to "is the timer alive?", which the calendar
-- surfaces as a "last generated" line.

-- CreateEnum
CREATE TYPE "SchedulerTrigger" AS ENUM ('TIMER', 'MANUAL');

-- CreateTable
CREATE TABLE "SchedulerRun" (
    "id" TEXT NOT NULL,
    "trigger" "SchedulerTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "sitesConsidered" INTEGER NOT NULL DEFAULT 0,
    "occurrencesCreated" INTEGER NOT NULL DEFAULT 0,
    "escalationsRecorded" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "SchedulerRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchedulerRun_trigger_startedAt_idx" ON "SchedulerRun"("trigger", "startedAt");
