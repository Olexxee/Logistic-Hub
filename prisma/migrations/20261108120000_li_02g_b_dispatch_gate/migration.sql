ALTER TABLE "parcel_bookings"
ADD COLUMN "integrationDispatchAuthorizedAt" TIMESTAMP(3);

ALTER TABLE "parcel_bookings"
ADD COLUMN "integrationPackingEvidenceFrozenAt" TIMESTAMP(3);
