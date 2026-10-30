-- Reconcile the partially-applied security_operations migration with the current Prisma schema.
-- This is intentionally forward-only: existing tables and records are retained.

-- AuthSession: rename the columns created by the earlier snake_case migration.
ALTER TABLE public.auth_sessions RENAME COLUMN user_id TO "userId";
ALTER TABLE public.auth_sessions RENAME COLUMN refresh_token_hash TO "tokenHash";
ALTER TABLE public.auth_sessions RENAME COLUMN expires_at TO "expiresAt";
ALTER TABLE public.auth_sessions RENAME COLUMN revoked_at TO "revokedAt";
ALTER TABLE public.auth_sessions RENAME COLUMN last_used_at TO "lastUsedAt";
ALTER TABLE public.auth_sessions RENAME COLUMN user_agent TO "userAgent";
ALTER TABLE public.auth_sessions RENAME COLUMN ip_hash TO "ipHash";
ALTER TABLE public.auth_sessions RENAME COLUMN created_at TO "createdAt";
ALTER TABLE public.auth_sessions RENAME COLUMN updated_at TO "updatedAt";

ALTER INDEX public.auth_sessions_refresh_token_hash_key RENAME TO "auth_sessions_tokenHash_key";
ALTER INDEX public.auth_sessions_user_id_revoked_at_expires_at_idx
  RENAME TO "auth_sessions_userId_revokedAt_expiresAt_idx";
ALTER INDEX public.auth_sessions_expires_at_idx RENAME TO "auth_sessions_expiresAt_idx";
ALTER TABLE public.auth_sessions RENAME CONSTRAINT auth_sessions_user_id_fkey
  TO "auth_sessions_userId_fkey";

-- RateLimitBucket: align physical column names with Prisma model fields.
ALTER TABLE public.rate_limit_buckets RENAME COLUMN request_count TO "count";
ALTER TABLE public.rate_limit_buckets RENAME COLUMN window_started_at TO "windowStartedAt";
ALTER TABLE public.rate_limit_buckets RENAME COLUMN expires_at TO "windowEndsAt";
ALTER TABLE public.rate_limit_buckets RENAME COLUMN updated_at TO "updatedAt";
ALTER INDEX public.rate_limit_buckets_expires_at_idx
  RENAME TO "rate_limit_buckets_windowEndsAt_idx";

-- Complete the RideBooking model.
ALTER TABLE public.ride_bookings ADD COLUMN "cancellationReason" TEXT;

-- Align SupportTicket while retaining its existing parcel/ride booking links.
ALTER TABLE public.support_tickets RENAME COLUMN "requesterId" TO "customerId";
ALTER TABLE public.support_tickets ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.support_tickets ALTER COLUMN status TYPE TEXT USING status::TEXT;
ALTER TABLE public.support_tickets ALTER COLUMN status SET DEFAULT 'OPEN';
ALTER TABLE public.support_tickets ALTER COLUMN priority DROP DEFAULT;
ALTER TABLE public.support_tickets ALTER COLUMN priority TYPE TEXT USING priority::TEXT;
ALTER TABLE public.support_tickets ALTER COLUMN priority SET DEFAULT 'NORMAL';
ALTER TABLE public.support_tickets ADD COLUMN "bookingType" TEXT;
ALTER TABLE public.support_tickets ADD COLUMN "bookingId" TEXT;
ALTER TABLE public.support_tickets ADD COLUMN "resolvedAt" TIMESTAMP(3);

ALTER INDEX public.support_tickets_requesterId_status_createdAt_idx
  RENAME TO "support_tickets_customerId_status_createdAt_idx";
ALTER TABLE public.support_tickets RENAME CONSTRAINT support_tickets_requesterId_fkey
  TO "support_tickets_customerId_fkey";

CREATE INDEX "support_tickets_parcelBookingId_status_idx"
  ON public.support_tickets("parcelBookingId", status);
CREATE INDEX "support_tickets_rideBookingId_status_idx"
  ON public.support_tickets("rideBookingId", status);

-- Create the provider webhook idempotency/event ledger.
CREATE TABLE public.provider_webhook_events (
  id TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3),
  "processingError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provider_webhook_events_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX "provider_webhook_events_provider_providerEventId_key"
  ON public.provider_webhook_events(provider, "providerEventId");
CREATE INDEX "provider_webhook_events_provider_processedAt_receivedAt_idx"
  ON public.provider_webhook_events(provider, "processedAt", "receivedAt");

-- Create the current refund-request workflow separately from the legacy refunds table.
CREATE TABLE public.refund_requests (
  id TEXT NOT NULL,
  "publicReference" TEXT NOT NULL,
  "paymentAttemptId" TEXT NOT NULL,
  "parcelBookingId" TEXT,
  "rideBookingId" TEXT,
  "amountMinor" BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "requestedByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "providerReference" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "providerResponse" JSONB,
  "reviewedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT refund_requests_pkey PRIMARY KEY (id),
  CONSTRAINT refund_requests_paymentAttemptId_fkey
    FOREIGN KEY ("paymentAttemptId") REFERENCES public.payment_attempts(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT refund_requests_parcelBookingId_fkey
    FOREIGN KEY ("parcelBookingId") REFERENCES public.parcel_bookings(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT refund_requests_rideBookingId_fkey
    FOREIGN KEY ("rideBookingId") REFERENCES public.ride_bookings(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "refund_requests_publicReference_key"
  ON public.refund_requests("publicReference");
CREATE UNIQUE INDEX "refund_requests_providerReference_key"
  ON public.refund_requests("providerReference");
CREATE UNIQUE INDEX "refund_requests_idempotencyKey_key"
  ON public.refund_requests("idempotencyKey");
CREATE INDEX "refund_requests_status_createdAt_idx"
  ON public.refund_requests(status, "createdAt");
CREATE INDEX "refund_requests_paymentAttemptId_status_idx"
  ON public.refund_requests("paymentAttemptId", status);
CREATE INDEX "refund_requests_parcelBookingId_status_idx"
  ON public.refund_requests("parcelBookingId", status);
CREATE INDEX "refund_requests_rideBookingId_status_idx"
  ON public.refund_requests("rideBookingId", status);
