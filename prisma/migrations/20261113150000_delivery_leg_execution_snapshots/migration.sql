CREATE TABLE "delivery_leg_execution_snapshots" (
  "id" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "executorType" TEXT NOT NULL,
  "selectedDriverProfileId" TEXT,
  "selectedVehicleId" TEXT,
  "selectedPartnerId" TEXT,
  "partnerAgreementId" TEXT,
  "partnerRateCardId" TEXT,
  "executionCostMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "costSource" TEXT NOT NULL,
  "costSourceVersion" INTEGER,
  "assessmentSnapshot" JSONB NOT NULL,
  "routeSnapshot" JSONB NOT NULL,
  "packageSnapshot" JSONB NOT NULL,
  "selectedByUserId" TEXT NOT NULL,
  "selectedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_leg_execution_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_leg_execution_snapshots_deliveryLegId_fkey"
    FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_leg_execution_snapshots_version_check" CHECK ("version" > 0),
  CONSTRAINT "delivery_leg_execution_snapshots_cost_check" CHECK ("executionCostMinor" > 0),
  CONSTRAINT "delivery_leg_execution_snapshots_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "delivery_leg_execution_snapshots_executor_check" CHECK (
    ("executorType" = 'PLATFORM_DRIVER'
      AND "selectedDriverProfileId" IS NOT NULL
      AND "selectedVehicleId" IS NOT NULL
      AND "selectedPartnerId" IS NULL
      AND "partnerAgreementId" IS NULL
      AND "partnerRateCardId" IS NULL)
    OR
    ("executorType" = 'TRANSPORT_PARTNER'
      AND "selectedDriverProfileId" IS NULL
      AND "selectedVehicleId" IS NULL
      AND "selectedPartnerId" IS NOT NULL
      AND "partnerAgreementId" IS NOT NULL
      AND "partnerRateCardId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "delivery_leg_execution_snapshots_idempotencyKey_key"
  ON "delivery_leg_execution_snapshots"("idempotencyKey");
CREATE UNIQUE INDEX "delivery_leg_execution_snapshots_leg_version_key"
  ON "delivery_leg_execution_snapshots"("deliveryLegId", "version");
CREATE INDEX "delivery_leg_execution_snapshots_leg_created_idx"
  ON "delivery_leg_execution_snapshots"("deliveryLegId", "createdAt");
CREATE INDEX "delivery_leg_execution_snapshots_executor_idx"
  ON "delivery_leg_execution_snapshots"("executorType", "selectedDriverProfileId", "selectedPartnerId");

CREATE FUNCTION prevent_delivery_leg_execution_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Delivery leg execution snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "delivery_leg_execution_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "delivery_leg_execution_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_delivery_leg_execution_snapshot_mutation();
