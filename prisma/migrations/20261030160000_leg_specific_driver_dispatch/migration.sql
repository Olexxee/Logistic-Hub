-- Add leg-scoped driver offers and per-leg fare acceptance snapshots.
ALTER TABLE "driver_offers"
  ADD COLUMN "deliveryLegId" TEXT;

ALTER TABLE "delivery_legs"
  ADD COLUMN "driverFareMinor" BIGINT,
  ADD COLUMN "fareAcceptanceIdempotencyKey" TEXT,
  ADD COLUMN "fareAcceptancePayloadHash" TEXT;

ALTER TABLE "driver_offers"
  ADD CONSTRAINT "driver_offers_delivery_leg_id_fkey"
  FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "driver_offers_delivery_leg_id_status_expires_at_idx"
  ON "driver_offers"("deliveryLegId", "status", "expiresAt");

CREATE UNIQUE INDEX "delivery_legs_fare_acceptance_idempotency_key_key"
  ON "delivery_legs"("fareAcceptanceIdempotencyKey");
