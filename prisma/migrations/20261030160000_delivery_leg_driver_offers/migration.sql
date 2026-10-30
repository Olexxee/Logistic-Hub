-- Per-leg driver offers are distinct from booking-level offers.
-- This keeps sequential multi-leg assignment independent and preserves fare acceptance before payment.
CREATE TABLE "delivery_leg_offers" (
  "id" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "driverProfileId" TEXT NOT NULL,
  "status" "OfferStatus" NOT NULL DEFAULT 'OFFERED',
  "proposedFareMinor" BIGINT,
  "proposalIdempotencyKey" TEXT,
  "proposalPayloadHash" TEXT,
  "acceptanceIdempotencyKey" TEXT,
  "acceptancePayloadHash" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_leg_offers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_leg_offers_proposalIdempotencyKey_key"
  ON "delivery_leg_offers"("proposalIdempotencyKey");
CREATE UNIQUE INDEX "delivery_leg_offers_acceptanceIdempotencyKey_key"
  ON "delivery_leg_offers"("acceptanceIdempotencyKey");
CREATE INDEX "delivery_leg_offers_deliveryLegId_status_expiresAt_idx"
  ON "delivery_leg_offers"("deliveryLegId", "status", "expiresAt");
CREATE INDEX "delivery_leg_offers_driverProfileId_status_expiresAt_idx"
  ON "delivery_leg_offers"("driverProfileId", "status", "expiresAt");

ALTER TABLE "delivery_leg_offers"
  ADD CONSTRAINT "delivery_leg_offers_deliveryLegId_fkey"
  FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_leg_offers"
  ADD CONSTRAINT "delivery_leg_offers_driverProfileId_fkey"
  FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
