ALTER TABLE "ride_bookings"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "idempotencyPayloadHash" TEXT;

CREATE UNIQUE INDEX "ride_bookings_idempotencyKey_key"
ON "ride_bookings"("idempotencyKey");

ALTER TABLE "ride_bookings"
ADD COLUMN "fareAcceptanceIdempotencyKey" TEXT,
ADD COLUMN "fareAcceptancePayloadHash" TEXT;

CREATE UNIQUE INDEX "ride_bookings_fareAcceptanceIdempotencyKey_key"
ON "ride_bookings"("fareAcceptanceIdempotencyKey");
