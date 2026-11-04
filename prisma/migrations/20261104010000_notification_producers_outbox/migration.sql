ALTER TABLE "Notification"
    ADD COLUMN "eventKey" TEXT;

CREATE UNIQUE INDEX "Notification_eventKey_key"
    ON "Notification"("eventKey");

ALTER TABLE "NotificationEmailDelivery"
    ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
    ADD COLUMN "failureCode" TEXT;

CREATE INDEX "NotificationEmailDelivery_status_nextAttemptAt_idx"
    ON "NotificationEmailDelivery"("status", "nextAttemptAt");
