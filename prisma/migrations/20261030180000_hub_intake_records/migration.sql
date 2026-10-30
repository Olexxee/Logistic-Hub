CREATE TYPE "HubIntakeStatus" AS ENUM ('RECEIVED', 'RELEASED', 'EXCEPTION');

CREATE TABLE "hub_intake_records" (
  "id" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "hubPointId" TEXT NOT NULL,
  "receivedByUserId" TEXT NOT NULL,
  "status" "HubIntakeStatus" NOT NULL DEFAULT 'RECEIVED',
  "weightGrams" INTEGER NOT NULL,
  "lengthMm" INTEGER,
  "widthMm" INTEGER,
  "heightMm" INTEGER,
  "volumeCm3" INTEGER,
  "conditionAtReceipt" TEXT NOT NULL,
  "evidence" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "exceptionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hub_intake_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hub_intake_records_weight_positive_check" CHECK ("weightGrams" > 0),
  CONSTRAINT "hub_intake_records_dimensions_positive_check" CHECK (
    ("lengthMm" IS NULL AND "widthMm" IS NULL AND "heightMm" IS NULL AND "volumeCm3" IS NULL)
    OR ("lengthMm" > 0 AND "widthMm" > 0 AND "heightMm" > 0 AND "volumeCm3" > 0)
  )
);

CREATE INDEX "hub_intake_records_hubPointId_status_receivedAt_idx"
  ON "hub_intake_records"("hubPointId", "status", "receivedAt");
CREATE INDEX "hub_intake_records_parcelBookingId_hubPointId_status_idx"
  ON "hub_intake_records"("parcelBookingId", "hubPointId", "status");
CREATE INDEX "hub_intake_records_deliveryLegId_hubPointId_idx"
  ON "hub_intake_records"("deliveryLegId", "hubPointId");

ALTER TABLE "hub_intake_records"
  ADD CONSTRAINT "hub_intake_records_parcelBookingId_fkey"
  FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_intake_records"
  ADD CONSTRAINT "hub_intake_records_deliveryLegId_fkey"
  FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_intake_records"
  ADD CONSTRAINT "hub_intake_records_hubPointId_fkey"
  FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_intake_records"
  ADD CONSTRAINT "hub_intake_records_receivedByUserId_fkey"
  FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
