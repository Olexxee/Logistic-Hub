CREATE TYPE "DeliveryLegType" AS ENUM (
  'DIRECT',
  'LOCAL_PICKUP',
  'HUB_TRANSFER',
  'INTERSTATE_TRANSPORT',
  'FINAL_MILE'
);

CREATE TYPE "DeliveryLegStatus" AS ENUM (
  'PLANNED',
  'AWAITING_PAYMENT',
  'ASSIGNED',
  'PICKUP_VERIFICATION_PENDING',
  'IN_TRANSIT',
  'DELIVERY_VERIFICATION_PENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "delivery_legs" (
  "id" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "DeliveryLegType" NOT NULL,
  "status" "DeliveryLegStatus" NOT NULL DEFAULT 'PLANNED',
  "originServiceZoneId" TEXT NOT NULL,
  "destinationServiceZoneId" TEXT NOT NULL,
  "plannedAt" TIMESTAMP(3),
  "assignedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_legs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "driver_assignments"
  ADD COLUMN "deliveryLegId" TEXT;

CREATE UNIQUE INDEX "delivery_legs_parcelBookingId_sequence_key"
  ON "delivery_legs"("parcelBookingId", "sequence");

CREATE INDEX "delivery_legs_status_plannedAt_idx"
  ON "delivery_legs"("status", "plannedAt");

CREATE INDEX "delivery_legs_route_status_idx"
  ON "delivery_legs"("originServiceZoneId", "destinationServiceZoneId", "status");

CREATE INDEX "driver_assignments_deliveryLegId_status_idx"
  ON "driver_assignments"("deliveryLegId", "status");

CREATE UNIQUE INDEX "driver_assignments_one_active_per_delivery_leg"
  ON "driver_assignments"("deliveryLegId")
  WHERE "deliveryLegId" IS NOT NULL
    AND "status" NOT IN ('COMPLETED', 'CANCELLED', 'FAILED');

ALTER TABLE "delivery_legs"
  ADD CONSTRAINT "delivery_legs_positive_sequence"
  CHECK ("sequence" > 0),
  ADD CONSTRAINT "delivery_legs_valid_completion"
  CHECK ("completedAt" IS NULL OR "startedAt" IS NOT NULL),
  ADD CONSTRAINT "delivery_legs_valid_failure"
  CHECK ("status" <> 'FAILED' OR NULLIF(BTRIM("failureReason"), '') IS NOT NULL);

ALTER TABLE "delivery_legs"
  ADD CONSTRAINT "delivery_legs_parcelBookingId_fkey"
  FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_legs_originServiceZoneId_fkey"
  FOREIGN KEY ("originServiceZoneId") REFERENCES "service_zones"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_legs_destinationServiceZoneId_fkey"
  FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "driver_assignments"
  ADD CONSTRAINT "driver_assignments_deliveryLegId_fkey"
  FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "verification_tokens"
  ADD COLUMN "deliveryLegId" TEXT;

CREATE INDEX "verification_tokens_deliveryLegId_action_status_idx"
  ON "verification_tokens"("deliveryLegId", "action", "status");

ALTER TABLE "verification_tokens"
  ADD CONSTRAINT "verification_tokens_deliveryLegId_fkey"
  FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
