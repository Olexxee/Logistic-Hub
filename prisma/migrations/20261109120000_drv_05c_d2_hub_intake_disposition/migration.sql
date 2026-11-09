CREATE TYPE "HubIntakeDispositionDecision" AS ENUM ('HOLD_FOR_INVESTIGATION', 'CONTINUE_DELIVERY');
CREATE TYPE "HubIntakeDispositionStatus" AS ENUM ('HELD', 'ROUTE_APPROVED', 'RELEASED');

CREATE TABLE "hub_intake_dispositions" (
  "id" TEXT NOT NULL,
  "intakeRecordId" TEXT NOT NULL,
  "hubRecoveryId" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "sourceDeliveryLegId" TEXT NOT NULL,
  "hubPointId" TEXT NOT NULL,
  "decision" "HubIntakeDispositionDecision" NOT NULL,
  "status" "HubIntakeDispositionStatus" NOT NULL DEFAULT 'HELD',
  "reason" TEXT NOT NULL,
  "destinationServiceZoneId" TEXT,
  "destinationHubPointId" TEXT,
  "nextDeliveryLegId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "releasedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hub_intake_dispositions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hub_intake_dispositions_intakeRecordId_key" ON "hub_intake_dispositions"("intakeRecordId");
CREATE UNIQUE INDEX "hub_intake_dispositions_hubRecoveryId_key" ON "hub_intake_dispositions"("hubRecoveryId");
CREATE UNIQUE INDEX "hub_intake_dispositions_nextDeliveryLegId_key" ON "hub_intake_dispositions"("nextDeliveryLegId");
CREATE INDEX "hub_intake_dispositions_hub_status_created_idx" ON "hub_intake_dispositions"("hubPointId", "status", "createdAt");
CREATE INDEX "hub_intake_dispositions_booking_created_idx" ON "hub_intake_dispositions"("parcelBookingId", "createdAt");

ALTER TABLE "hub_intake_dispositions"
  ADD CONSTRAINT "hub_intake_dispositions_intakeRecordId_fkey"
    FOREIGN KEY ("intakeRecordId") REFERENCES "hub_intake_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_hubRecoveryId_fkey"
    FOREIGN KEY ("hubRecoveryId") REFERENCES "driver_assignment_hub_recoveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_parcelBookingId_fkey"
    FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_sourceDeliveryLegId_fkey"
    FOREIGN KEY ("sourceDeliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_nextDeliveryLegId_fkey"
    FOREIGN KEY ("nextDeliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_hubPointId_fkey"
    FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_destinationServiceZoneId_fkey"
    FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_destinationHubPointId_fkey"
    FOREIGN KEY ("destinationHubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_intake_dispositions_releasedByUserId_fkey"
    FOREIGN KEY ("releasedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
