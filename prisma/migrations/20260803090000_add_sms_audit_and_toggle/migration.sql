-- Twilio SMS support: outbound send toggle + message audit trail.
--
-- Purely ADDITIVE. `sendingEnabled` defaults TRUE so existing behaviour is
-- unchanged — the ACTIVE PROVIDER still decides whether a real message leaves,
-- and that remains "mock" until an administrator switches it. No backfill.

ALTER TABLE "SmsConfig" ADD COLUMN "sendingEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "SmsMessageLog" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "toMasked" TEXT NOT NULL,
    "workerId" TEXT,
    "provider" TEXT NOT NULL,
    "messageId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "actorName" TEXT,
    "jobSiteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmsMessageLog_purpose_createdAt_idx" ON "SmsMessageLog"("purpose", "createdAt");
CREATE INDEX "SmsMessageLog_workerId_createdAt_idx" ON "SmsMessageLog"("workerId", "createdAt");
CREATE INDEX "SmsMessageLog_createdAt_idx" ON "SmsMessageLog"("createdAt");

-- SET NULL, not CASCADE: erasing a worker must remove the link to them without
-- destroying the delivery record, which is operational evidence that a message
-- was or was not sent. The masked destination alone does not identify anyone.
ALTER TABLE "SmsMessageLog" ADD CONSTRAINT "SmsMessageLog_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
