ALTER TYPE "AuthCodePurpose" ADD VALUE 'EMAIL_CHANGE';

CREATE TYPE "NotificationEmailDeliveryStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SENT',
    'FAILED',
    'CANCELLED'
);

ALTER TABLE "User"
    ADD COLUMN "pendingEmail" TEXT,
    ADD COLUMN "profilePhotoBytes" BYTEA;
ALTER TABLE "Notification"
    ADD COLUMN "inApp" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "User_pendingEmail_lower_key"
    ON "User" (LOWER("pendingEmail"))
    WHERE "pendingEmail" IS NOT NULL;

CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_type_key"
    ON "NotificationPreference"("userId", "type");
CREATE INDEX "NotificationPreference_userId_idx"
    ON "NotificationPreference"("userId");
ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationEmailDelivery" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "status" "NotificationEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationEmailDelivery_notificationId_key"
    ON "NotificationEmailDelivery"("notificationId");
CREATE INDEX "NotificationEmailDelivery_status_createdAt_idx"
    ON "NotificationEmailDelivery"("status", "createdAt");
ALTER TABLE "NotificationEmailDelivery"
    ADD CONSTRAINT "NotificationEmailDelivery_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
