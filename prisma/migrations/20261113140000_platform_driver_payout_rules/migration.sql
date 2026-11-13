CREATE TABLE "platform_driver_payout_rules" (
  "id" TEXT NOT NULL,
  "serviceZoneId" TEXT NOT NULL,
  "legType" "DeliveryLegType" NOT NULL,
  "parcelCategory" TEXT NOT NULL,
  "minWeightGrams" INTEGER NOT NULL DEFAULT 0,
  "maxWeightGrams" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "driverPayoutMinor" BIGINT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "PlatformRouteRateStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_driver_payout_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_driver_payout_rules_leg_type_check"
    CHECK ("legType" IN ('LOCAL_PICKUP', 'FINAL_MILE')),
  CONSTRAINT "platform_driver_payout_rules_category_check"
    CHECK (length(trim("parcelCategory")) > 0),
  CONSTRAINT "platform_driver_payout_rules_weight_check"
    CHECK ("minWeightGrams" >= 0 AND ("maxWeightGrams" IS NULL OR "maxWeightGrams" > "minWeightGrams")),
  CONSTRAINT "platform_driver_payout_rules_amount_check"
    CHECK ("driverPayoutMinor" > 0),
  CONSTRAINT "platform_driver_payout_rules_version_check"
    CHECK ("version" > 0),
  CONSTRAINT "platform_driver_payout_rules_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "platform_driver_payout_rules_effective_check"
    CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
);

CREATE UNIQUE INDEX "platform_driver_payout_rules_scope_version_key"
  ON "platform_driver_payout_rules" ("serviceZoneId", "legType", "parcelCategory", "currency", "version");
CREATE INDEX "platform_driver_payout_rules_scope_status_idx"
  ON "platform_driver_payout_rules" ("serviceZoneId", "legType", "parcelCategory", "currency", "status");
CREATE INDEX "platform_driver_payout_rules_status_effective_idx"
  ON "platform_driver_payout_rules" ("status", "effectiveFrom", "effectiveUntil");

ALTER TABLE "platform_driver_payout_rules"
  ADD CONSTRAINT "platform_driver_payout_rules_serviceZoneId_fkey"
  FOREIGN KEY ("serviceZoneId") REFERENCES "service_zones"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
