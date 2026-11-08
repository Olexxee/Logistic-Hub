CREATE TYPE "DriverServiceCapability" AS ENUM ('LOCAL_DISPATCH', 'PICKUP_COLLECTION', 'FINAL_MILE_DELIVERY');
CREATE TYPE "CapabilityApprovalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED');

CREATE TABLE "driver_capability_grants" (
  "id" TEXT NOT NULL,
  "driverProfileId" TEXT NOT NULL,
  "capability" "DriverServiceCapability" NOT NULL,
  "status" "CapabilityApprovalStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "driver_capability_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "driver_capability_grants_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "driver_capability_grants_driverProfileId_capability_key" ON "driver_capability_grants"("driverProfileId", "capability");
CREATE INDEX "driver_capability_grants_status_requestedAt_idx" ON "driver_capability_grants"("status", "requestedAt");

CREATE TABLE "vehicle_service_capabilities" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "capability" "DriverServiceCapability" NOT NULL,
  "status" "CapabilityApprovalStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_service_capabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_service_capabilities_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "vehicle_service_capabilities_vehicleId_capability_key" ON "vehicle_service_capabilities"("vehicleId", "capability");
CREATE INDEX "vehicle_service_capabilities_status_requestedAt_idx" ON "vehicle_service_capabilities"("status", "requestedAt");
