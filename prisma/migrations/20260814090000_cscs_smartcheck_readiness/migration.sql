-- SC-001 — CSCS Smart Check production readiness.
--
-- Purely ADDITIVE: two new tables, no change to any existing column and no
-- backfill. Nothing is written by this migration.
--
-- CscsConfig defaults to activeProvider='mock', which is exactly what the
-- platform does today (getCscsProvider falls back to the mock when CSCS_PROVIDER
-- is unset). Applying this before the code changes nothing for anyone.
--
-- CscsVerificationLog starts empty. It records every verification ATTEMPT,
-- including failures, because "never checked" and "check failed" are different
-- facts about a competency record. The card number is stored masked to the last
-- four characters — the audit question is which card was checked and what came
-- back, not a second copy of the credential.
CREATE TABLE "CscsConfig" (
    "id" TEXT NOT NULL,
    "activeProvider" TEXT NOT NULL DEFAULT 'mock',
    "verificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smartCheckApiUrl" TEXT,
    "smartCheckApiKey" TEXT,
    "updatedByAdminId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CscsConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CscsVerificationLog" (
    "id" TEXT NOT NULL,
    "workerId" TEXT,
    "cardNumberMasked" TEXT NOT NULL,
    "scheme" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "errorReason" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CscsVerificationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CscsVerificationLog_workerId_createdAt_idx" ON "CscsVerificationLog"("workerId", "createdAt");
CREATE INDEX "CscsVerificationLog_status_createdAt_idx" ON "CscsVerificationLog"("status", "createdAt");

-- SET NULL, not CASCADE: a worker erased under GDPR must not take the audit
-- trail of what was verified with them. The row survives without identifying
-- anyone, which is the point of a masked card number.
ALTER TABLE "CscsVerificationLog" ADD CONSTRAINT "CscsVerificationLog_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
