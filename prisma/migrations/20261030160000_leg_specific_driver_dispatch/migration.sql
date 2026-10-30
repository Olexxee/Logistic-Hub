-- Add leg-scoped driver offers and per-leg fare acceptance snapshots.
ALTER TABLE "driver_offers"
  ADD COLUMN "delivery_leg_id" TEXT;

ALTER TABLE "delivery_legs"
  ADD COLUMN "driver_fare_minor" BIGINT,
  ADD COLUMN "fare_acceptance_idempotency_key" TEXT,
  ADD COLUMN "fare_acceptance_payload_hash" TEXT;

ALTER TABLE "driver_offers"
  ADD CONSTRAINT "driver_offers_delivery_leg_id_fkey"
  FOREIGN KEY ("delivery_leg_id") REFERENCES "delivery_legs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "driver_offers_delivery_leg_id_status_expires_at_idx"
  ON "driver_offers"("delivery_leg_id", "status", "expires_at");

CREATE UNIQUE INDEX "delivery_legs_fare_acceptance_idempotency_key_key"
  ON "delivery_legs"("fare_acceptance_idempotency_key");
