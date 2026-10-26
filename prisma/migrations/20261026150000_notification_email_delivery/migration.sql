ALTER TABLE "notifications"
ADD COLUMN "emailStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN "emailSentAt" TIMESTAMP(3),
ADD COLUMN "emailProviderId" TEXT,
ADD COLUMN "emailErrorCode" TEXT,
ADD COLUMN "deliveryKey" TEXT;

CREATE UNIQUE INDEX "notifications_deliveryKey_key"
ON "notifications"("deliveryKey");

CREATE INDEX "notifications_emailStatus_createdAt_idx"
ON "notifications"("emailStatus", "createdAt");
