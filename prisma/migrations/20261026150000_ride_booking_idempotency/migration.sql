ALTER TABLE "ride_bookings"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "idempotencyPayloadHash" TEXT;

CREATE UNIQUE INDEX "ride_bookings_idempotencyKey_key"
ON "ride_bookings"("idempotencyKey");
