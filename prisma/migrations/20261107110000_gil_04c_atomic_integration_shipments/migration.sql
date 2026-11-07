-- GIL-04C: atomic integration-owned shipment creation.
-- External customer collection is attested by the authenticated platform; Logistic Hub
-- records the attestation without creating a Paystack PaymentAttempt or ledger entry.

ALTER TYPE "BookingStatus" ADD VALUE 'AWAITING_PARTNER_ASSIGNMENT';
ALTER TYPE "IntegrationQuoteSessionStatus" ADD VALUE 'BOOKED';

-- Preserve caller package order so the package facts remain aligned with the
-- immutable package-rate snapshot, including packages without external refs.
ALTER TABLE "integration_quote_packages" ADD COLUMN "packageSequence" INTEGER;
WITH ordered_packages AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "quoteSessionId" ORDER BY "createdAt", "id") - 1 AS sequence
  FROM "integration_quote_packages"
)
UPDATE "integration_quote_packages" AS packages
SET "packageSequence" = ordered_packages.sequence
FROM ordered_packages
WHERE packages."id" = ordered_packages."id";
ALTER TABLE "integration_quote_packages" ALTER COLUMN "packageSequence" SET NOT NULL;

ALTER TABLE "parcel_booking_packages" ADD COLUMN "packageSequence" INTEGER;
WITH ordered_booking_packages AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "parcelBookingId" ORDER BY "createdAt", "id") - 1 AS sequence
  FROM "parcel_booking_packages"
)
UPDATE "parcel_booking_packages" AS packages
SET "packageSequence" = ordered_booking_packages.sequence
FROM ordered_booking_packages
WHERE packages."id" = ordered_booking_packages."id";
ALTER TABLE "parcel_booking_packages" ALTER COLUMN "packageSequence" SET NOT NULL;

CREATE UNIQUE INDEX "integration_quote_packages_quoteSessionId_packageSequence_key"
  ON "integration_quote_packages" ("quoteSessionId", "packageSequence");
CREATE UNIQUE INDEX "parcel_booking_packages_parcelBookingId_packageSequence_key"
  ON "parcel_booking_packages" ("parcelBookingId", "packageSequence");

CREATE TABLE "integration_payment_attestations" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "quoteSessionId" TEXT NOT NULL,
  "quoteOptionId" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "paymentProvider" TEXT NOT NULL,
  "externalPaymentReference" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryChargeMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "orderPaymentAmountMinor" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_payment_attestations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_payment_attestations_nonnegative_delivery_charge"
    CHECK ("deliveryChargeMinor" >= 0),
  CONSTRAINT "integration_payment_attestations_nonnegative_order_amount"
    CHECK ("orderPaymentAmountMinor" IS NULL OR "orderPaymentAmountMinor" >= 0)
);

CREATE UNIQUE INDEX "integration_payment_attestations_parcelBookingId_key"
  ON "integration_payment_attestations" ("parcelBookingId");
CREATE UNIQUE INDEX "integration_payment_attestations_clientId_paymentProvider_e_key"
  ON "integration_payment_attestations" ("clientId", "paymentProvider", "externalPaymentReference");
CREATE INDEX "integration_payment_attestations_clientId_verifiedAt_idx"
  ON "integration_payment_attestations" ("clientId", "verifiedAt");

ALTER TABLE "integration_payment_attestations"
  ADD CONSTRAINT "integration_payment_attestations_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_payment_attestations"
  ADD CONSTRAINT "integration_payment_attestations_quoteSessionId_fkey"
  FOREIGN KEY ("quoteSessionId") REFERENCES "integration_quote_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_payment_attestations"
  ADD CONSTRAINT "integration_payment_attestations_quoteOptionId_fkey"
  FOREIGN KEY ("quoteOptionId") REFERENCES "integration_quote_options"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_payment_attestations"
  ADD CONSTRAINT "integration_payment_attestations_parcelBookingId_fkey"
  FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
