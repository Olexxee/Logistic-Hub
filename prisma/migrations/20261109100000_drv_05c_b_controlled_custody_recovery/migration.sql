CREATE TYPE "DriverAssignmentRecoveryStatus" AS ENUM (
  'PENDING_RELEASE',
  'PENDING_RECEIPT',
  'CONFIRMED',
  'CANCELLED'
);

ALTER TABLE "driver_assignments"
  ADD COLUMN "payoutReviewRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "driver_assignment_recoveries" (
  "id" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "sourceAssignmentId" TEXT NOT NULL,
  "replacementAssignmentId" TEXT,
  "replacementDriverProfileId" TEXT NOT NULL,
  "replacementVehicleId" TEXT NOT NULL,
  "operationalCaseId" TEXT NOT NULL,
  "initiatedByUserId" TEXT NOT NULL,
  "status" "DriverAssignmentRecoveryStatus" NOT NULL DEFAULT 'PENDING_RELEASE',
  "reason" TEXT NOT NULL,
  "releaseConfirmedByUserId" TEXT,
  "releaseConfirmedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  "releaseEvidence" JSONB,
  "exceptionAuthorizedByUserId" TEXT,
  "exceptionAuthorizedAt" TIMESTAMP(3),
  "exceptionReason" TEXT,
  "exceptionEvidence" JSONB,
  "receiptConfirmedByUserId" TEXT,
  "receiptConfirmedAt" TIMESTAMP(3),
  "receiptCondition" TEXT,
  "receiptEvidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "driver_assignment_recoveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "driver_assignment_recoveries_replacementAssignmentId_key"
  ON "driver_assignment_recoveries"("replacementAssignmentId");
CREATE INDEX "driver_assignment_recoveries_sourceAssignmentId_status_createdAt_idx"
  ON "driver_assignment_recoveries"("sourceAssignmentId", "status", "createdAt");
CREATE INDEX "driver_assignment_recoveries_deliveryLegId_status_createdAt_idx"
  ON "driver_assignment_recoveries"("deliveryLegId", "status", "createdAt");
CREATE INDEX "driver_assignment_recoveries_replacementDriverProfileId_status_idx"
  ON "driver_assignment_recoveries"("replacementDriverProfileId", "status");
CREATE INDEX "driver_assignment_recoveries_operationalCaseId_createdAt_idx"
  ON "driver_assignment_recoveries"("operationalCaseId", "createdAt");

ALTER TABLE "driver_assignment_recoveries"
  ADD CONSTRAINT "driver_assignment_recoveries_parcelBookingId_fkey"
    FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_deliveryLegId_fkey"
    FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_sourceAssignmentId_fkey"
    FOREIGN KEY ("sourceAssignmentId") REFERENCES "driver_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_replacementAssignmentId_fkey"
    FOREIGN KEY ("replacementAssignmentId") REFERENCES "driver_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_replacementDriverProfileId_fkey"
    FOREIGN KEY ("replacementDriverProfileId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_replacementVehicleId_fkey"
    FOREIGN KEY ("replacementVehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_operationalCaseId_fkey"
    FOREIGN KEY ("operationalCaseId") REFERENCES "operational_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_initiatedByUserId_fkey"
    FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_releaseConfirmedByUserId_fkey"
    FOREIGN KEY ("releaseConfirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_exceptionAuthorizedByUserId_fkey"
    FOREIGN KEY ("exceptionAuthorizedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_assignment_recoveries_receiptConfirmedByUserId_fkey"
    FOREIGN KEY ("receiptConfirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
