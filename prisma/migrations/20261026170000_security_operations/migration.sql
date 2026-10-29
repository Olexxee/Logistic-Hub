ALTER TABLE "ride_bookings" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
ALTER TYPE "VerificationAction" ADD VALUE IF NOT EXISTS 'RIDE_COMPLETION';

-- Normalize the tables created by the preceding persistent-rate-limit migration
-- to the Prisma field names used by the current schema. Do not recreate them.
ALTER TABLE "auth_sessions" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE "auth_sessions" RENAME COLUMN "refresh_token_hash" TO "tokenHash";
ALTER TABLE "auth_sessions" RENAME COLUMN "expires_at" TO "expiresAt";
ALTER TABLE "auth_sessions" RENAME COLUMN "revoked_at" TO "revokedAt";
ALTER TABLE "auth_sessions" RENAME COLUMN "last_used_at" TO "lastUsedAt";
ALTER TABLE "auth_sessions" RENAME COLUMN "user_agent" TO "userAgent";
ALTER TABLE "auth_sessions" RENAME COLUMN "ip_hash" TO "ipHash";
ALTER TABLE "auth_sessions" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "auth_sessions" RENAME COLUMN "updated_at" TO "updatedAt";
ALTER INDEX "auth_sessions_refresh_token_hash_key" RENAME TO "auth_sessions_tokenHash_key";
ALTER INDEX "auth_sessions_user_id_revoked_at_expires_at_idx" RENAME TO "auth_sessions_userId_revokedAt_expiresAt_idx";
ALTER INDEX "auth_sessions_expires_at_idx" RENAME TO "auth_sessions_expiresAt_idx";
ALTER TABLE "auth_sessions" RENAME CONSTRAINT "auth_sessions_user_id_fkey" TO "auth_sessions_userId_fkey";

ALTER TABLE "rate_limit_buckets" RENAME COLUMN "request_count" TO "count";
ALTER TABLE "rate_limit_buckets" RENAME COLUMN "window_started_at" TO "windowStartedAt";
ALTER TABLE "rate_limit_buckets" RENAME COLUMN "expires_at" TO "windowEndsAt";
ALTER TABLE "rate_limit_buckets" RENAME COLUMN "updated_at" TO "updatedAt";
ALTER INDEX "rate_limit_buckets_expires_at_idx" RENAME TO "rate_limit_buckets_windowEndsAt_idx";

CREATE TABLE "provider_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3),
  "processingError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_webhook_events_provider_providerEventId_key" ON "provider_webhook_events"("provider", "providerEventId");
CREATE INDEX "provider_webhook_events_provider_processedAt_receivedAt_idx" ON "provider_webhook_events"("provider", "processedAt", "receivedAt");

CREATE TABLE "support_tickets" (
  "id" TEXT NOT NULL,
  "publicReference" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "bookingType" TEXT,
  "bookingId" TEXT,
  "category" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_tickets_publicReference_key" ON "support_tickets"("publicReference");
CREATE INDEX "support_tickets_customerId_status_createdAt_idx" ON "support_tickets"("customerId", "status", "createdAt");
CREATE INDEX "support_tickets_status_priority_createdAt_idx" ON "support_tickets"("status", "priority", "createdAt");
CREATE INDEX "support_tickets_assignedToUserId_status_idx" ON "support_tickets"("assignedToUserId", "status");

CREATE TABLE "refund_requests" (
 "id" TEXT NOT NULL,
 "publicReference" TEXT NOT NULL,
 "paymentAttemptId" TEXT NOT NULL,
 "amountMinor" BIGINT NOT NULL,
 "currency" TEXT NOT NULL DEFAULT 'NGN',
 "reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
 "requestedByUserId" TEXT NOT NULL,
 "reviewedByUserId" TEXT,
 "providerReference" TEXT,
 "idempotencyKey" TEXT NOT NULL,
 "providerResponse" JSONB,
 "reviewedAt" TIMESTAMP(3),
 "processedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refund_requests_publicReference_key" ON "refund_requests"("publicReference");
CREATE UNIQUE INDEX "refund_requests_providerReference_key" ON "refund_requests"("providerReference");
CREATE UNIQUE INDEX "refund_requests_idempotencyKey_key" ON "refund_requests"("idempotencyKey");
CREATE INDEX "refund_requests_status_createdAt_idx" ON "refund_requests"("status","createdAt");
CREATE INDEX "refund_requests_paymentAttemptId_status_idx" ON "refund_requests"("paymentAttemptId","status");
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
