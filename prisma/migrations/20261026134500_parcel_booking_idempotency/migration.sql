ALTER TABLE "parcel_bookings"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "idempotencyPayloadHash" TEXT;

CREATE UNIQUE INDEX "parcel_bookings_idempotencyKey_key"
ON "parcel_bookings"("idempotencyKey");
