CREATE TYPE "ManualOperationalSettlementStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

CREATE TABLE "manual_operational_settlements" (
  "id" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "payeeName" TEXT NOT NULL,
  "payeePhone" TEXT,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" "ManualOperationalSettlementStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "paymentReference" TEXT,
  "settledAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "settledByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manual_operational_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manual_operational_settlements_amountMinor_check" CHECK ("amountMinor" > 0)
);

CREATE UNIQUE INDEX "manual_operational_settlements_deliveryLegId_key" ON "manual_operational_settlements"("deliveryLegId");
CREATE UNIQUE INDEX "manual_operational_settlements_paymentReference_key" ON "manual_operational_settlements"("paymentReference");
CREATE INDEX "manual_operational_settlements_status_createdAt_idx" ON "manual_operational_settlements"("status", "createdAt");
CREATE INDEX "manual_operational_settlements_createdByUserId_createdAt_idx" ON "manual_operational_settlements"("createdByUserId", "createdAt");

ALTER TABLE "manual_operational_settlements"
  ADD CONSTRAINT "manual_operational_settlements_deliveryLegId_fkey"
  FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_operational_settlements"
  ADD CONSTRAINT "manual_operational_settlements_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_operational_settlements"
  ADD CONSTRAINT "manual_operational_settlements_settledByUserId_fkey"
  FOREIGN KEY ("settledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
