ALTER TABLE "driver_assignments" ADD COLUMN "vehicleId" TEXT;
ALTER TABLE "driver_offers" ADD COLUMN "vehicleId" TEXT;
ALTER TABLE "delivery_leg_offers" ADD COLUMN "vehicleId" TEXT;

ALTER TABLE "driver_assignments"
  ADD CONSTRAINT "driver_assignments_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "driver_offers"
  ADD CONSTRAINT "driver_offers_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_leg_offers"
  ADD CONSTRAINT "delivery_leg_offers_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "driver_assignments_vehicleId_status_idx" ON "driver_assignments"("vehicleId", "status");
CREATE INDEX "driver_offers_vehicleId_status_idx" ON "driver_offers"("vehicleId", "status");
CREATE INDEX "delivery_leg_offers_vehicleId_status_idx" ON "delivery_leg_offers"("vehicleId", "status");
