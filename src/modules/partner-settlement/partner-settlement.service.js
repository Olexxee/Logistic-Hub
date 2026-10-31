import { randomBytes } from "node:crypto";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/app-error.js";
import { createPartnerSettlementRepository } from "./partner-settlement.repository.js";

function toMinor(value) {
  try {
    const amount = BigInt(value);
    if (amount < 0n) throw new Error("negative");
    return amount;
  } catch {
    throw new ConflictError("A non-negative integer minor-unit amount is required.", "INVALID_AMOUNT");
  }
}
const audit = (tx, actorUserId, entityType, entityId, action, before, after, reason) =>
  tx.operationalAuditEvent.create({ data: { actorUserId, entityType, entityId, action, before, after, reason } });

function serializePayable(row) {
  return {
    ...row,
    sourceChargeMinor: row.sourceChargeMinor.toString(),
    amountMinor: row.amountMinor.toString(),
    assignment: row.assignment ? {
      ...row.assignment,
      agreedTransportChargeMinor: row.assignment.agreedTransportChargeMinor.toString(),
    } : undefined,
    batchItem: row.batchItem ? {
      ...row.batchItem,
      amountMinor: row.batchItem.amountMinor.toString(),
      batch: row.batchItem.batch,
    } : row.batchItem,
  };
}
function serializeBatch(row) {
  return {
    ...row,
    totalAmountMinor: row.totalAmountMinor.toString(),
    reconciledAmountMinor: row.reconciledAmountMinor?.toString() ?? null,
    items: row.items?.map((item) => ({
      ...item,
      amountMinor: item.amountMinor.toString(),
      payable: item.payable ? { ...item.payable, amountMinor: item.payable.amountMinor.toString() } : item.payable,
    })),
    reconciliations: row.reconciliations?.map((item) => ({
      ...item,
      expectedAmountMinor: item.expectedAmountMinor.toString(),
      actualAmountMinor: item.actualAmountMinor.toString(),
    })),
  };
}

export function createPartnerSettlementService({ prismaClient, clock = () => new Date() }) {
  const repo = createPartnerSettlementRepository({ prismaClient });
  return {
    async listAdminPayables({ status, partnerId, limit = 100 }) {
      return (await repo.listPayables({
        ...(status ? { status } : {}),
        ...(partnerId ? { partnerId } : {}),
      }, limit)).map(serializePayable);
    },

    async listMyPayables({ userId, status, limit = 100 }) {
      const memberships = await prismaClient.transportPartnerMember.findMany({
        where: { userId, isActive: true, partner: { status: "ACTIVE", verificationStatus: "VERIFIED" } },
        select: { partnerId: true },
      });
      const partnerIds = memberships.map((item) => item.partnerId);
      if (!partnerIds.length) throw new ForbiddenError("An active verified partner membership is required.");
      return (await repo.listPayables({
        partnerId: { in: partnerIds },
        ...(status ? { status } : {}),
      }, limit)).map(serializePayable);
    },

    async approvePayable({ payableId, actorUserId }) {
      return repo.transaction(async (tx) => {
        const current = await tx.partnerPayable.findUnique({ where: { id: payableId } });
        if (!current) throw new NotFoundError("Partner payable not found.");
        if (current.status === "APPROVED") return { payable: serializePayable(current), replay: true };
        if (current.status !== "PENDING_APPROVAL") {
          throw new ConflictError("Only pending partner payables can be approved.", "PAYABLE_NOT_APPROVABLE");
        }
        const changed = await tx.partnerPayable.updateMany({
          where: { id: payableId, status: "PENDING_APPROVAL" },
          data: { status: "APPROVED", approvedByUserId: actorUserId, approvedAt: clock() },
        });
        if (changed.count !== 1) throw new ConflictError("Partner payable changed while being approved.", "PAYABLE_STATE_CONFLICT");
        const payable = await tx.partnerPayable.findUnique({ where: { id: payableId } });
        await audit(tx, actorUserId, "PARTNER_PAYABLE", payableId, "PARTNER_PAYABLE_APPROVED",
          { status: current.status }, { status: payable.status, amountMinor: payable.amountMinor.toString(), currency: payable.currency });
        return { payable: serializePayable(payable), replay: false };
      });
    },

    async createAdjustment({ payableId, type, amountMinor, reason, idempotencyKey, actorUserId }) {
      const amount = toMinor(amountMinor);
      if (amount <= 0n) throw new ConflictError("Adjustment amount must be greater than zero.", "INVALID_ADJUSTMENT_AMOUNT");
      return repo.transaction(async (tx) => {
        const existing = await tx.partnerPayableAdjustment.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.payableId !== payableId || existing.type !== type || existing.amountMinor !== amount || existing.reason !== reason) {
            throw new ConflictError("Idempotency-Key was already used for a different adjustment.", "IDEMPOTENCY_KEY_REUSED");
          }
          return { adjustment: { ...existing, amountMinor: existing.amountMinor.toString() }, replay: true };
        }
        const payable = await tx.partnerPayable.findUnique({ where: { id: payableId } });
        if (!payable) throw new NotFoundError("Partner payable not found.");
        if (!["PENDING_APPROVAL", "APPROVED"].includes(payable.status)) {
          throw new ConflictError("A payable cannot be adjusted after it enters a settlement batch or is reconciled.", "PAYABLE_NOT_ADJUSTABLE");
        }
        if (type === "DECREASE" && amount >= payable.amountMinor) {
          throw new ConflictError("Use REVERSAL to void the full payable; a decrease must leave a positive balance.", "FULL_DECREASE_REQUIRES_REVERSAL");
        }
        if (type === "REVERSAL" && amount !== payable.amountMinor) {
          throw new ConflictError("A reversal must equal the full current payable amount.", "REVERSAL_AMOUNT_MISMATCH");
        }
        const adjustment = await tx.partnerPayableAdjustment.create({ data: {
          payableId, type, amountMinor: amount, reason, idempotencyKey, createdByUserId: actorUserId,
        } });
        await audit(tx, actorUserId, "PARTNER_PAYABLE_ADJUSTMENT", adjustment.id, "PARTNER_PAYABLE_ADJUSTMENT_CREATED",
          null, { payableId, type, amountMinor: amount.toString(), reason });
        return { adjustment: { ...adjustment, amountMinor: adjustment.amountMinor.toString() }, replay: false };
      });
    },

    async approveAdjustment({ adjustmentId, actorUserId }) {
      return repo.transaction(async (tx) => {
        const adjustment = await tx.partnerPayableAdjustment.findUnique({
          where: { id: adjustmentId }, include: { payable: true },
        });
        if (!adjustment) throw new NotFoundError("Partner payable adjustment not found.");
        if (adjustment.appliedAt) return { adjustment: { ...adjustment, amountMinor: adjustment.amountMinor.toString() }, replay: true };
        if (adjustment.createdByUserId === actorUserId) {
          throw new ForbiddenError("A different administrator must approve this financial adjustment.");
        }
        if (adjustment.approvedAt) throw new ConflictError("Adjustment approval is already recorded.", "ADJUSTMENT_ALREADY_APPROVED");
        const payable = adjustment.payable;
        if (!["PENDING_APPROVAL", "APPROVED"].includes(payable.status)) {
          throw new ConflictError("The payable is no longer eligible for adjustment.", "PAYABLE_NOT_ADJUSTABLE");
        }
        let nextAmount = payable.amountMinor;
        let nextStatus = payable.status;
        if (adjustment.type === "INCREASE") nextAmount += adjustment.amountMinor;
        if (adjustment.type === "DECREASE") {
          if (adjustment.amountMinor >= nextAmount) throw new ConflictError("A decrease must leave a positive payable; use a reversal instead.", "ADJUSTMENT_EXCEEDS_PAYABLE");
          nextAmount -= adjustment.amountMinor;
        }
        if (adjustment.type === "REVERSAL") {
          if (adjustment.amountMinor !== nextAmount) throw new ConflictError("Payable changed after the reversal was requested.", "REVERSAL_AMOUNT_MISMATCH");
          nextAmount = 0n;
          nextStatus = "VOIDED";
        }
        const now = clock();
        const approved = await tx.partnerPayableAdjustment.updateMany({
          where: { id: adjustmentId, approvedAt: null, appliedAt: null },
          data: { approvedByUserId: actorUserId, approvedAt: now, appliedAt: now },
        });
        if (approved.count !== 1) throw new ConflictError("Adjustment changed while being approved.", "ADJUSTMENT_STATE_CONFLICT");
        await tx.partnerPayable.update({ where: { id: payable.id }, data: { amountMinor: nextAmount, status: nextStatus } });
        await audit(tx, actorUserId, "PARTNER_PAYABLE", payable.id, "PARTNER_PAYABLE_ADJUSTED",
          { amountMinor: payable.amountMinor.toString(), status: payable.status },
          { amountMinor: nextAmount.toString(), status: nextStatus, adjustmentId }, adjustment.reason);
        const result = await tx.partnerPayableAdjustment.findUnique({ where: { id: adjustmentId } });
        return { adjustment: { ...result, amountMinor: result.amountMinor.toString() }, replay: false };
      });
    },

    async createBatch({ partnerId, periodStart, periodEnd, idempotencyKey, actorUserId }) {
      const start = new Date(periodStart);
      const end = new Date(periodEnd);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
        throw new ConflictError("Settlement period must have a valid start before its end.", "INVALID_SETTLEMENT_PERIOD");
      }
      return repo.transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "transport_partners" WHERE "id" = ${partnerId} FOR UPDATE`;
        const existing = await tx.partnerSettlementBatch.findUnique({ where: { idempotencyKey }, include: { items: true } });
        if (existing) {
          if (existing.partnerId !== partnerId || existing.periodStart.getTime() !== start.getTime() || existing.periodEnd.getTime() !== end.getTime()) {
            throw new ConflictError("Idempotency-Key was already used for a different settlement batch.", "IDEMPOTENCY_KEY_REUSED");
          }
          return { batches: [serializeBatch(existing)], replay: true };
        }
        const partner = await tx.transportPartner.findUnique({ where: { id: partnerId } });
        if (!partner) throw new NotFoundError("Transport partner not found.");
        if (partner.status === "CLOSED") throw new ConflictError("Settlement batches cannot be created for a closed transport partner.", "PARTNER_CLOSED");
        const payables = await tx.partnerPayable.findMany({
          where: { partnerId, status: "APPROVED", generatedAt: { gte: start, lt: end }, batchItem: null, amountMinor: { gt: 0n } },
          orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
        });
        if (!payables.length) throw new ConflictError("No approved, unbatched partner payables exist in this period.", "NO_ELIGIBLE_PAYABLES");
        const currencies = [...new Set(payables.map((item) => item.currency))];
        if (currencies.length !== 1) throw new ConflictError("A settlement batch must contain exactly one currency.", "MIXED_SETTLEMENT_CURRENCY");
        const total = payables.reduce((sum, item) => sum + item.amountMinor, 0n);
        if (total <= 0n) throw new ConflictError("Settlement batch total must be greater than zero.", "EMPTY_SETTLEMENT_BATCH");
        const batch = await tx.partnerSettlementBatch.create({ data: {
          partnerId, reference: `PSB-${randomBytes(6).toString("hex").toUpperCase()}`,
          idempotencyKey, currency: currencies[0], periodStart: start, periodEnd: end,
          totalAmountMinor: total,
        } });
        await tx.partnerSettlementBatchItem.createMany({ data: payables.map((item) => ({
          batchId: batch.id, payableId: item.id, amountMinor: item.amountMinor,
        })) });
        const changed = await tx.partnerPayable.updateMany({
          where: { id: { in: payables.map((item) => item.id) }, status: "APPROVED", batchItem: null },
          data: { status: "IN_BATCH" },
        });
        if (changed.count !== payables.length) throw new ConflictError("One or more payables were claimed by another settlement batch.", "PAYABLE_BATCH_CONFLICT");
        await audit(tx, actorUserId, "PARTNER_SETTLEMENT_BATCH", batch.id, "PARTNER_SETTLEMENT_BATCH_CREATED",
          null, { partnerId, currency: batch.currency, totalAmountMinor: total.toString(), payableCount: payables.length, periodStart: start.toISOString(), periodEnd: end.toISOString() });
        const result = await tx.partnerSettlementBatch.findUnique({ where: { id: batch.id }, include: { items: true } });
        return { batches: [serializeBatch(result)], replay: false };
      });
    },

    async approveBatch({ batchId, actorUserId }) {
      return repo.transaction(async (tx) => {
        const current = await tx.partnerSettlementBatch.findUnique({ where: { id: batchId } });
        if (!current) throw new NotFoundError("Partner settlement batch not found.");
        if (current.status === "APPROVED") return { batch: serializeBatch(current), replay: true };
        if (current.status !== "DRAFT") throw new ConflictError("Only draft settlement batches can be approved.", "BATCH_NOT_APPROVABLE");
        const changed = await tx.partnerSettlementBatch.updateMany({
          where: { id: batchId, status: "DRAFT" },
          data: { status: "APPROVED", approvedByUserId: actorUserId, approvedAt: clock() },
        });
        if (changed.count !== 1) throw new ConflictError("Settlement batch changed while being approved.", "BATCH_STATE_CONFLICT");
        const batch = await tx.partnerSettlementBatch.findUnique({ where: { id: batchId } });
        await audit(tx, actorUserId, "PARTNER_SETTLEMENT_BATCH", batchId, "PARTNER_SETTLEMENT_BATCH_APPROVED",
          { status: current.status }, { status: batch.status, totalAmountMinor: batch.totalAmountMinor.toString() });
        return { batch: serializeBatch(batch), replay: false };
      });
    },

    async reconcileBatch({ batchId, outcome, actualAmountMinor, externalReference, evidence, note, actorUserId }) {
      const actual = toMinor(actualAmountMinor);
      return repo.transaction(async (tx) => {
        const batch = await tx.partnerSettlementBatch.findUnique({ where: { id: batchId }, include: { items: true } });
        if (!batch) throw new NotFoundError("Partner settlement batch not found.");
        if (!["APPROVED", "RECONCILIATION_REQUIRED"].includes(batch.status)) {
          throw new ConflictError("Only approved or exception batches can be reconciled.", "BATCH_NOT_RECONCILABLE");
        }
        if (outcome === "MATCHED" && (actual !== batch.totalAmountMinor || !externalReference?.trim())) {
          throw new ConflictError("A matched reconciliation requires the exact expected amount and an external statement or transfer reference.", "RECONCILIATION_MATCH_INVALID");
        }
        if (outcome === "VARIANCE" && actual === batch.totalAmountMinor) {
          throw new ConflictError("A variance outcome requires an amount different from the expected total.", "RECONCILIATION_VARIANCE_INVALID");
        }
        const now = clock();
        await tx.partnerSettlementReconciliation.create({ data: {
          batchId, actorUserId, outcome, expectedAmountMinor: batch.totalAmountMinor,
          actualAmountMinor: actual, externalReference: externalReference ?? null,
          evidence: evidence ?? undefined, note: note ?? null,
        } });
        const matched = outcome === "MATCHED";
        const updated = await tx.partnerSettlementBatch.update({ where: { id: batchId }, data: {
          status: matched ? "RECONCILED" : "RECONCILIATION_REQUIRED",
          reconciliationOutcome: outcome, reconciledAmountMinor: actual,
          externalReference: externalReference ?? null, evidence: evidence ?? undefined,
          reconciledByUserId: actorUserId, reconciledAt: now,
        } });
        await tx.partnerPayable.updateMany({
          where: { id: { in: batch.items.map((item) => item.payableId) }, status: { in: ["IN_BATCH", "DISPUTED"] } },
          data: matched ? { status: "RECONCILED", reconciledAt: now } : { status: "DISPUTED", reconciledAt: null },
        });
        await audit(tx, actorUserId, "PARTNER_SETTLEMENT_BATCH", batchId,
          matched ? "PARTNER_SETTLEMENT_BATCH_RECONCILED" : "PARTNER_SETTLEMENT_BATCH_EXCEPTION",
          { status: batch.status, reconciliationOutcome: batch.reconciliationOutcome },
          { status: updated.status, reconciliationOutcome: outcome, expectedAmountMinor: batch.totalAmountMinor.toString(), actualAmountMinor: actual.toString(), externalReference: externalReference ?? null }, note);
        return { batch: serializeBatch(updated), outcome };
      });
    },

    async listAdminBatches({ status, partnerId, limit = 100 }) {
      return (await repo.listBatches({
        ...(status ? { status } : {}),
        ...(partnerId ? { partnerId } : {}),
      }, limit)).map(serializeBatch);
    },
  };
}
