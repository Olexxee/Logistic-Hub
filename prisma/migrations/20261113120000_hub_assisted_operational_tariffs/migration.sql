CREATE TYPE "PlatformOperationalTariffScope" AS ENUM ('LOCAL_ZONE', 'HUB_PAIR', 'HUB_HANDLING');
CREATE TYPE "HubAdditionalOperationType" AS ENUM ('SPECIAL_SORTING', 'REPACKAGING');
CREATE TYPE "HubAdditionalOperationStatus" AS ENUM ('REQUESTED', 'AUTHORIZED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "platform_operational_tariffs" (
  "id" TEXT NOT NULL,
  "scope" "PlatformOperationalTariffScope" NOT NULL,
  "serviceType" "ServiceType" NOT NULL DEFAULT 'PARCEL_DELIVERY',
  "legType" "DeliveryLegType",
  "operationType" "HubAdditionalOperationType",
  "serviceZoneId" TEXT,
  "originHubPointId" TEXT,
  "destinationHubPointId" TEXT,
  "hubPointId" TEXT,
  "parcelCategory" TEXT NOT NULL,
  "minWeightGrams" INTEGER NOT NULL DEFAULT 0,
  "maxWeightGrams" INTEGER,
  "maxLengthMm" INTEGER,
  "maxWidthMm" INTEGER,
  "maxHeightMm" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "customerChargeMinor" BIGINT NOT NULL,
  "platformChargeMinor" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "PlatformRouteRateStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_operational_tariffs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_operational_tariffs_scope_locator_check" CHECK (
    ("scope" = 'LOCAL_ZONE' AND "serviceZoneId" IS NOT NULL AND "legType" IN ('LOCAL_PICKUP', 'FINAL_MILE')
      AND "originHubPointId" IS NULL AND "destinationHubPointId" IS NULL AND "hubPointId" IS NULL AND "operationType" IS NULL)
    OR
    ("scope" = 'HUB_PAIR' AND "serviceZoneId" IS NULL AND "legType" = 'INTERSTATE_TRANSPORT'
      AND "originHubPointId" IS NOT NULL AND "destinationHubPointId" IS NOT NULL AND "originHubPointId" <> "destinationHubPointId"
      AND "hubPointId" IS NULL AND "operationType" IS NULL)
    OR
    ("scope" = 'HUB_HANDLING' AND "serviceZoneId" IS NULL AND "legType" IS NULL
      AND "originHubPointId" IS NULL AND "destinationHubPointId" IS NULL AND "hubPointId" IS NOT NULL AND "operationType" IS NOT NULL)
  ),
  CONSTRAINT "platform_operational_tariffs_weight_check" CHECK ("minWeightGrams" >= 0 AND ("maxWeightGrams" IS NULL OR "maxWeightGrams" > "minWeightGrams")),
  CONSTRAINT "platform_operational_tariffs_charge_check" CHECK ("customerChargeMinor" > 0 AND "platformChargeMinor" >= 0),
  CONSTRAINT "platform_operational_tariffs_dimensions_check" CHECK (
    ("maxLengthMm" IS NULL OR "maxLengthMm" > 0) AND ("maxWidthMm" IS NULL OR "maxWidthMm" > 0) AND ("maxHeightMm" IS NULL OR "maxHeightMm" > 0)
  ),
  CONSTRAINT "platform_operational_tariffs_effective_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
);

CREATE TABLE "platform_operational_tariff_availability" (
  "id" TEXT NOT NULL,
  "scope" "PlatformOperationalTariffScope" NOT NULL,
  "serviceType" "ServiceType" NOT NULL DEFAULT 'PARCEL_DELIVERY',
  "legType" "DeliveryLegType",
  "operationType" "HubAdditionalOperationType",
  "serviceZoneId" TEXT,
  "originHubPointId" TEXT,
  "destinationHubPointId" TEXT,
  "hubPointId" TEXT,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_operational_tariff_availability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_operational_tariff_availability_scope_locator_check" CHECK (
    ("scope" = 'LOCAL_ZONE' AND "serviceZoneId" IS NOT NULL AND "legType" IN ('LOCAL_PICKUP', 'FINAL_MILE')
      AND "originHubPointId" IS NULL AND "destinationHubPointId" IS NULL AND "hubPointId" IS NULL AND "operationType" IS NULL)
    OR
    ("scope" = 'HUB_PAIR' AND "serviceZoneId" IS NULL AND "legType" = 'INTERSTATE_TRANSPORT'
      AND "originHubPointId" IS NOT NULL AND "destinationHubPointId" IS NOT NULL AND "originHubPointId" <> "destinationHubPointId"
      AND "hubPointId" IS NULL AND "operationType" IS NULL)
    OR
    ("scope" = 'HUB_HANDLING' AND "serviceZoneId" IS NULL AND "legType" IS NULL
      AND "originHubPointId" IS NULL AND "destinationHubPointId" IS NULL AND "hubPointId" IS NOT NULL AND "operationType" IS NOT NULL)
  ),
  CONSTRAINT "platform_operational_tariff_availability_effective_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE TABLE "hub_additional_operations" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "hubPointId" TEXT NOT NULL,
  "operationType" "HubAdditionalOperationType" NOT NULL,
  "status" "HubAdditionalOperationStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" TEXT NOT NULL,
  "evidence" JSONB,
  "requestedByUserId" TEXT NOT NULL,
  "authorizedByUserId" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "customerAuthorizedByUserId" TEXT,
  "customerAuthorizedAt" TIMESTAMP(3),
  "completedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hub_additional_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hub_additional_operations_idempotencyKey_key" ON "hub_additional_operations"("idempotencyKey");
CREATE UNIQUE INDEX "delivery_legs_id_parcelBookingId_key" ON "delivery_legs"("id", "parcelBookingId");
CREATE INDEX "platform_operational_tariffs_scope_serviceType_parcelCategory_status_idx" ON "platform_operational_tariffs"("scope", "serviceType", "parcelCategory", "status");
CREATE INDEX "platform_operational_tariffs_serviceZoneId_legType_status_idx" ON "platform_operational_tariffs"("serviceZoneId", "legType", "status");
CREATE INDEX "platform_operational_tariffs_originHubPointId_destinationHubPointId_status_idx" ON "platform_operational_tariffs"("originHubPointId", "destinationHubPointId", "status");
CREATE INDEX "platform_operational_tariffs_hubPointId_operationType_status_idx" ON "platform_operational_tariffs"("hubPointId", "operationType", "status");
CREATE INDEX "platform_operational_tariffs_status_effectiveFrom_effectiveUntil_idx" ON "platform_operational_tariffs"("status", "effectiveFrom", "effectiveUntil");
CREATE INDEX "platform_operational_tariff_availability_scope_serviceType_isEnabled_idx" ON "platform_operational_tariff_availability"("scope", "serviceType", "isEnabled");
CREATE INDEX "platform_operational_tariff_availability_serviceZoneId_legType_isEnabled_idx" ON "platform_operational_tariff_availability"("serviceZoneId", "legType", "isEnabled");
CREATE INDEX "platform_operational_tariff_availability_originHubPointId_destinationHubPointId_isEnabled_idx" ON "platform_operational_tariff_availability"("originHubPointId", "destinationHubPointId", "isEnabled");
CREATE INDEX "platform_operational_tariff_availability_hubPointId_operationType_isEnabled_idx" ON "platform_operational_tariff_availability"("hubPointId", "operationType", "isEnabled");
CREATE INDEX "hub_additional_operations_parcelBookingId_hubPointId_status_idx" ON "hub_additional_operations"("parcelBookingId", "hubPointId", "status");
CREATE INDEX "hub_additional_operations_deliveryLegId_status_idx" ON "hub_additional_operations"("deliveryLegId", "status");
CREATE INDEX "hub_additional_operations_hubPointId_operationType_status_idx" ON "hub_additional_operations"("hubPointId", "operationType", "status");

ALTER TABLE "platform_operational_tariffs" ADD CONSTRAINT "platform_operational_tariffs_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_operational_tariffs" ADD CONSTRAINT "platform_operational_tariffs_originHubPointId_fkey" FOREIGN KEY ("originHubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_operational_tariffs" ADD CONSTRAINT "platform_operational_tariffs_destinationHubPointId_fkey" FOREIGN KEY ("destinationHubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_operational_tariffs" ADD CONSTRAINT "platform_operational_tariffs_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_operational_tariffs" ADD CONSTRAINT "platform_operational_tariffs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform_operational_tariff_availability" ADD CONSTRAINT "platform_operational_tariff_availability_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_operational_tariff_availability" ADD CONSTRAINT "platform_operational_tariff_availability_originHubPointId_fkey" FOREIGN KEY ("originHubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_operational_tariff_availability" ADD CONSTRAINT "platform_operational_tariff_availability_destinationHubPointId_fkey" FOREIGN KEY ("destinationHubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_operational_tariff_availability" ADD CONSTRAINT "platform_operational_tariff_availability_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_additional_operations" ADD CONSTRAINT "hub_additional_operations_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_additional_operations" ADD CONSTRAINT "hub_additional_operations_deliveryLegId_parcelBookingId_fkey" FOREIGN KEY ("deliveryLegId", "parcelBookingId") REFERENCES "delivery_legs"("id", "parcelBookingId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_additional_operations" ADD CONSTRAINT "hub_additional_operations_hubPointId_fkey" FOREIGN KEY ("hubPointId") REFERENCES "hub_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_additional_operations" ADD CONSTRAINT "hub_additional_operations_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hub_additional_operations" ADD CONSTRAINT "hub_additional_operations_authorizedByUserId_fkey" FOREIGN KEY ("authorizedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NULLS are distinct in ordinary PostgreSQL unique indexes. Scope-specific partial
-- indexes enforce one availability row per exact locator without weakening scope checks.
CREATE UNIQUE INDEX "platform_operational_tariff_availability_local_unique"
  ON "platform_operational_tariff_availability" ("serviceZoneId", "legType", "serviceType")
  WHERE "scope" = 'LOCAL_ZONE';
CREATE UNIQUE INDEX "platform_operational_tariff_availability_hub_pair_unique"
  ON "platform_operational_tariff_availability" ("originHubPointId", "destinationHubPointId", "serviceType")
  WHERE "scope" = 'HUB_PAIR';
CREATE UNIQUE INDEX "platform_operational_tariff_availability_handling_unique"
  ON "platform_operational_tariff_availability" ("hubPointId", "operationType", "serviceType")
  WHERE "scope" = 'HUB_HANDLING';

ALTER TABLE "hub_additional_operations"
  ADD CONSTRAINT "hub_additional_operations_reason_check" CHECK (length(trim("reason")) > 0),
  ADD CONSTRAINT "hub_additional_operations_authorization_check" CHECK (
    ("status" = 'REQUESTED' AND "authorizedByUserId" IS NULL AND "authorizedAt" IS NULL AND "customerAuthorizedByUserId" IS NULL AND "customerAuthorizedAt" IS NULL AND "completedByUserId" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'AUTHORIZED' AND "authorizedByUserId" IS NOT NULL AND "authorizedAt" IS NOT NULL AND "customerAuthorizedByUserId" IS NOT NULL AND "customerAuthorizedAt" IS NOT NULL AND "completedByUserId" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'COMPLETED' AND "authorizedByUserId" IS NOT NULL AND "authorizedAt" IS NOT NULL AND "customerAuthorizedByUserId" IS NOT NULL AND "customerAuthorizedAt" IS NOT NULL AND "completedByUserId" IS NOT NULL AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
  );

ALTER TABLE "hub_additional_operations"
  ADD CONSTRAINT "hub_additional_operations_customer_authorizer_fkey" FOREIGN KEY ("customerAuthorizedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hub_additional_operations_completer_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep PostgreSQL object names aligned with Prisma's 63-character naming.
-- This prevents migrate diff from reporting drift after a clean migration.
ALTER TABLE "platform_operational_tariff_availability"
  RENAME CONSTRAINT "platform_operational_tariff_availability_destinationHubPointId_fkey"
  TO "platform_operational_tariff_availability_destinationHubPoi_fkey";

ALTER TABLE "hub_additional_operations"
  RENAME CONSTRAINT "hub_additional_operations_customer_authorizer_fkey"
  TO "hub_additional_operations_customerAuthorizedByUserId_fkey";
ALTER TABLE "hub_additional_operations"
  RENAME CONSTRAINT "hub_additional_operations_completer_fkey"
  TO "hub_additional_operations_completedByUserId_fkey";

ALTER INDEX "platform_operational_tariff_availability_hubPointId_operationTy"
  RENAME TO "platform_operational_tariff_availability_hubPointId_operati_idx";
ALTER INDEX "platform_operational_tariff_availability_originHubPointId_desti"
  RENAME TO "platform_operational_tariff_availability_originHubPointId_d_idx";
ALTER INDEX "platform_operational_tariff_availability_scope_serviceType_isEn"
  RENAME TO "platform_operational_tariff_availability_scope_serviceType__idx";
ALTER INDEX "platform_operational_tariff_availability_serviceZoneId_legType_"
  RENAME TO "platform_operational_tariff_availability_serviceZoneId_legT_idx";

ALTER INDEX "platform_operational_tariffs_hubPointId_operationType_status_id"
  RENAME TO "platform_operational_tariffs_hubPointId_operationType_statu_idx";
ALTER INDEX "platform_operational_tariffs_originHubPointId_destinationHubPoi"
  RENAME TO "platform_operational_tariffs_originHubPointId_destinationHu_idx";
ALTER INDEX "platform_operational_tariffs_scope_serviceType_parcelCategory_s"
  RENAME TO "platform_operational_tariffs_scope_serviceType_parcelCatego_idx";
ALTER INDEX "platform_operational_tariffs_status_effectiveFrom_effectiveUnti"
  RENAME TO "platform_operational_tariffs_status_effectiveFrom_effective_idx";
