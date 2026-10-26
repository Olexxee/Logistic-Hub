ALTER TABLE "parcel_bookings"
ADD COLUMN "fareAcceptanceIdempotencyKey" TEXT,
ADD COLUMN "fareAcceptancePayloadHash" TEXT;

CREATE UNIQUE INDEX "parcel_bookings_fareAcceptanceIdempotencyKey_key"
ON "parcel_bookings"("fareAcceptanceIdempotencyKey");

ALTER TABLE "driver_offers"
ADD COLUMN "fareProposalIdempotencyKey" TEXT,
ADD COLUMN "fareProposalPayloadHash" TEXT;

CREATE UNIQUE INDEX "driver_offers_fareProposalIdempotencyKey_key"
ON "driver_offers"("fareProposalIdempotencyKey");
