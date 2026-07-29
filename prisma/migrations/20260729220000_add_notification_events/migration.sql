-- SC-016 Action Assignment Notification (Phase A — live in-app).
-- Purely ADDITIVE: one new enum and one new table. Nothing existing is altered,
-- so the running SC-015 code is unaffected and this is safe to apply before the
-- code deploy. No backfill: events are recorded from the deploy onward, and the
-- pre-existing DERIVED notification types (overdue / due-soon / site-scoped
-- assignment) keep working unchanged for managers.

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('ACTION_ASSIGNED', 'ACTION_REASSIGNED', 'ACTION_STATUS_CHANGED', 'ACTION_PRIORITY_CHANGED', 'ACTION_DUE_DATE_CHANGED');

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "type" "NotificationEventType" NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "actionId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "priority" TEXT,
    "dueDate" TIMESTAMP(3),
    "description" TEXT,
    "href" TEXT NOT NULL,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationEvent_recipientUserId_createdAt_idx" ON "NotificationEvent"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_actionId_idx" ON "NotificationEvent"("actionId");

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;
