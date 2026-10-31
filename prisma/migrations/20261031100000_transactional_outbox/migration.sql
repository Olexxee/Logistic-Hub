CREATE TABLE "outbox_jobs" (
  "id" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "outbox_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbox_jobs_idempotencyKey_key" ON "outbox_jobs"("idempotencyKey");
CREATE INDEX "outbox_jobs_status_availableAt_createdAt_idx" ON "outbox_jobs"("status", "availableAt", "createdAt");
CREATE INDEX "outbox_jobs_status_lockedAt_idx" ON "outbox_jobs"("status", "lockedAt");
