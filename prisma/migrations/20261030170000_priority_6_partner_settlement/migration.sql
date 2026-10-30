CREATE TYPE "PartnerPayableStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'IN_BATCH', 'RECONCILED', 'DISPUTED', 'VOIDED');
CREATE TYPE "PartnerSettlementBatchStatus" AS ENUM ('DRAFT', 'APPROVED', 'RECONCILIATION_REQUIRED', 'RECONCILED', 'VOIDED');
CREATE TYPE "PartnerReconciliationOutcome" AS ENUM ('MATCHED', 'VARIANCE', 'DISPUTED');
CREATE TYPE "PartnerPayableAdjustmentType" AS ENUM ('INCREASE', 'DECREASE', 'REVERSAL');

CREATE TABLE "partner_payables" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "partnerDeliveryAssignmentId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "deliveryLegId" TEXT NOT NULL,
  "sourceChargeMinor" BIGINT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "PartnerPayableStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_payables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_payables_source_positive_check" CHECK ("sourceChargeMinor" > 0),
  CONSTRAINT "partner_payables_amount_nonnegative_check" CHECK ("amountMinor" >= 0)
);
CREATE UNIQUE INDEX "partner_payables_partnerDeliveryAssignmentId_key" ON "partner_payables"("partnerDeliveryAssignmentId");
CREATE INDEX "partner_payables_partnerId_status_generatedAt_idx" ON "partner_payables"("partnerId", "status", "generatedAt");
CREATE INDEX "partner_payables_agreementId_generatedAt_idx" ON "partner_payables"("agreementId", "generatedAt");
CREATE INDEX "partner_payables_deliveryLegId_idx" ON "partner_payables"("deliveryLegId");
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_partnerDeliveryAssignmentId_fkey" FOREIGN KEY ("partnerDeliveryAssignmentId") REFERENCES "partner_delivery_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "partner_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_deliveryLegId_fkey" FOREIGN KEY ("deliveryLegId") REFERENCES "delivery_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "partner_payable_adjustments" (
  "id" TEXT NOT NULL,
  "payableId" TEXT NOT NULL,
  "type" "PartnerPayableAdjustmentType" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_payable_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_payable_adjustments_amount_positive_check" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "partner_payable_adjustments_idempotencyKey_key" ON "partner_payable_adjustments"("idempotencyKey");
CREATE INDEX "partner_payable_adjustments_payableId_createdAt_idx" ON "partner_payable_adjustments"("payableId", "createdAt");
CREATE INDEX "partner_payable_adjustments_approvedAt_appliedAt_idx" ON "partner_payable_adjustments"("approvedAt", "appliedAt");
ALTER TABLE "partner_payable_adjustments" ADD CONSTRAINT "partner_payable_adjustments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "partner_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_payable_adjustments" ADD CONSTRAINT "partner_payable_adjustments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_payable_adjustments" ADD CONSTRAINT "partner_payable_adjustments_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "partner_settlement_batches" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "totalAmountMinor" BIGINT NOT NULL,
  "status" "PartnerSettlementBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "reconciledByUserId" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "externalReference" TEXT,
  "reconciliationOutcome" "PartnerReconciliationOutcome",
  "reconciledAmountMinor" BIGINT,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_settlement_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_settlement_batches_total_nonnegative_check" CHECK ("totalAmountMinor" > 0),
  CONSTRAINT "partner_settlement_batches_period_check" CHECK ("periodStart" < "periodEnd")
);
CREATE UNIQUE INDEX "partner_settlement_batches_reference_key" ON "partner_settlement_batches"("reference");
CREATE UNIQUE INDEX "partner_settlement_batches_idempotencyKey_key" ON "partner_settlement_batches"("idempotencyKey");
CREATE INDEX "partner_settlement_batches_partnerId_currency_status_period_idx" ON "partner_settlement_batches"("partnerId", "currency", "status", "periodStart", "periodEnd");
ALTER TABLE "partner_settlement_batches" ADD CONSTRAINT "partner_settlement_batches_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "transport_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_settlement_batches" ADD CONSTRAINT "partner_settlement_batches_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_settlement_batches" ADD CONSTRAINT "partner_settlement_batches_reconciledByUserId_fkey" FOREIGN KEY ("reconciledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "partner_settlement_batch_items" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "payableId" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_settlement_batch_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_settlement_batch_items_amount_positive_check" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "partner_settlement_batch_items_payableId_key" ON "partner_settlement_batch_items"("payableId");
CREATE INDEX "partner_settlement_batch_items_batchId_idx" ON "partner_settlement_batch_items"("batchId");
ALTER TABLE "partner_settlement_batch_items" ADD CONSTRAINT "partner_settlement_batch_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "partner_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_settlement_batch_items" ADD CONSTRAINT "partner_settlement_batch_items_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "partner_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "partner_settlement_reconciliations" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "outcome" "PartnerReconciliationOutcome" NOT NULL,
  "expectedAmountMinor" BIGINT NOT NULL,
  "actualAmountMinor" BIGINT NOT NULL,
  "externalReference" TEXT,
  "evidence" JSONB,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_settlement_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_settlement_reconciliations_expected_nonnegative_check" CHECK ("expectedAmountMinor" > 0),
  CONSTRAINT "partner_settlement_reconciliations_actual_nonnegative_check" CHECK ("actualAmountMinor" >= 0)
);
CREATE INDEX "partner_settlement_reconciliations_batchId_createdAt_idx" ON "partner_settlement_reconciliations"("batchId", "createdAt");
ALTER TABLE "partner_settlement_reconciliations" ADD CONSTRAINT "partner_settlement_reconciliations_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "partner_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_settlement_reconciliations" ADD CONSTRAINT "partner_settlement_reconciliations_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
