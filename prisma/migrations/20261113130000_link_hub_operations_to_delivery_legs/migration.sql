-- Bind each additional hub operation to the exact delivery leg and booking.
-- The composite foreign key prevents an operation from referencing a leg belonging
-- to a different booking.
ALTER TABLE "hub_additional_operations"
  ADD COLUMN "deliveryLegId" TEXT NOT NULL;

CREATE UNIQUE INDEX "delivery_legs_id_parcelBookingId_key"
  ON "delivery_legs" ("id", "parcelBookingId");

CREATE INDEX "hub_additional_operations_deliveryLegId_status_idx"
  ON "hub_additional_operations" ("deliveryLegId", "status");

ALTER TABLE "hub_additional_operations"
  ADD CONSTRAINT "hub_additional_operations_deliveryLegId_parcelBookingId_fkey"
  FOREIGN KEY ("deliveryLegId", "parcelBookingId")
  REFERENCES "delivery_legs" ("id", "parcelBookingId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
