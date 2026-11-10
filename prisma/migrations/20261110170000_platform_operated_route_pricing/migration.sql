CREATE TYPE "PlatformRouteRateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "platform_route_availability" (
 "id" TEXT NOT NULL, "originServiceZoneId" TEXT NOT NULL, "destinationServiceZoneId" TEXT NOT NULL,
 "serviceType" "ServiceType" NOT NULL DEFAULT 'PARCEL_DELIVERY', "isEnabled" BOOLEAN NOT NULL DEFAULT false,
 "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "platform_route_availability_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "platform_route_availability_origin_fkey" FOREIGN KEY ("originServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "platform_route_availability_destination_fkey" FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_route_availability_route_service_key" ON "platform_route_availability"("originServiceZoneId","destinationServiceZoneId","serviceType");
CREATE INDEX "platform_route_availability_effective_idx" ON "platform_route_availability"("serviceType","isEnabled","startsAt","endsAt");

CREATE TABLE "platform_route_rates" (
 "id" TEXT NOT NULL, "originServiceZoneId" TEXT NOT NULL, "destinationServiceZoneId" TEXT NOT NULL,
 "serviceType" "ServiceType" NOT NULL DEFAULT 'PARCEL_DELIVERY', "parcelCategory" TEXT NOT NULL,
 "minWeightGrams" INTEGER NOT NULL DEFAULT 0, "maxWeightGrams" INTEGER, "maxLengthMm" INTEGER,
 "maxWidthMm" INTEGER, "maxHeightMm" INTEGER, "currency" TEXT NOT NULL DEFAULT 'NGN',
 "customerTransportChargeMinor" BIGINT NOT NULL, "platformChargeMinor" BIGINT NOT NULL DEFAULT 0,
 "driverPayoutMinor" BIGINT NOT NULL, "estimatedTransitMinutes" INTEGER, "version" INTEGER NOT NULL DEFAULT 1,
 "status" "PlatformRouteRateStatus" NOT NULL DEFAULT 'DRAFT', "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "effectiveUntil" TIMESTAMP(3), "publishedAt" TIMESTAMP(3), "createdByUserId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "platform_route_rates_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "platform_route_rates_origin_fkey" FOREIGN KEY ("originServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "platform_route_rates_destination_fkey" FOREIGN KEY ("destinationServiceZoneId") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "platform_route_rates_amounts_check" CHECK ("customerTransportChargeMinor">0 AND "platformChargeMinor">=0 AND "driverPayoutMinor">0),
 CONSTRAINT "platform_route_rates_weight_check" CHECK ("maxWeightGrams" IS NULL OR "maxWeightGrams">="minWeightGrams"),
 CONSTRAINT "platform_route_rates_dates_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil">"effectiveFrom")
);
CREATE INDEX "platform_route_rates_route_package_status_idx" ON "platform_route_rates"("originServiceZoneId","destinationServiceZoneId","serviceType","parcelCategory","status");
CREATE INDEX "platform_route_rates_effective_idx" ON "platform_route_rates"("status","effectiveFrom","effectiveUntil");
