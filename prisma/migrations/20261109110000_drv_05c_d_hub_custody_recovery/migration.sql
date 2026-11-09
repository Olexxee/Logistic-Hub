CREATE TYPE "DriverAssignmentHubRecoveryStatus" AS ENUM ('PENDING_RECEIPT', 'CONFIRMED', 'CANCELLED');

CREATE TABLE "driver_assignment_hub_recoveries" (
  "id" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "sourceAssignmentId" TEXT NOT NULL,
  "hubPointId" TEXT NOT NULL,
  "operationalCaseId" TEXT NOT NULL,
  "initiatedByUserId" TEXT NOT NULL,
  "status" "DriverAssignmentHubRecoveryStatus" NOT NULL DEFAULT 'PENDING_RECEIPT',
  "reason" TEXT NOT NULL,
  "hubIntakeRecordId" TEXT,
  "receivedByUserId" TEXT,
  "receivedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "driver_assignment_hub_recoveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "driver_assignment_hub_recoveries_hubIntakeRecordId_key"
  ON "driver_assignment_hub_recoveries"("hubIntakeRecordId");
CREATE INDEX "drv_asgn_hub_rec_source_status_created_idx"
  ON "driver_assignment_hub_recoveries"("sourceAssignmentId", "status", "createdAt");
CREATE INDEX "drv_asgn_hub_rec_hub_status_created_idx"
  ON "driver_assignment_hub_recoveries"("hubPointId", "status", "createdAt");
CREATE INDEX "drv_asgn_hub_rec_case_created_idx"
  ON "driver_assignment_hub_recoveries"("operationalCaseId", "createdAt");

ALTER TABLE "driver_assignment_hub_recoveries"
  ADD CONSTRAINT "driver_assignment_hub_recoveries_parcelBookingId_fkey"
  FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_hub_recoveries_deliveryLegId_fkey"
  FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_hub_recoveries_sourceAssignmentId_fkey"
  FOREIGN KEY ("sourceAssignmentId") REFERENCES "driver_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_hub_recoveries_hubPointId_fkey"
  FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_hub_recoveries_operationalCaseId_fkey"
  FOREIGN KEY ("operationalCaseId") REFERENCES "operational_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_hub_recoveries_initiatedByUserId_fkey"
  FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_hub_recoveries_receivedByUserId_fkey"
  FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_hub_recoveries_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_hub_recoveries_hubIntakeRecordId_fkey"
  FOREIGN KEY ("hubIntakeRecordId") REFERENCES "hub_intake_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
