import { Router } from "express";
import { z } from "zod";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";

const id = z.string().trim().min(1).max(128);
const statusInput = z.object({
  status: z.enum(["IN_TRANSIT", "COMPLETED", "FAILED"]),
  reason: z.string().trim().min(5).max(500),
}).strict();
const settlementInput = z.object({
  paymentReference: z.string().trim().min(5).max(128),
  reason: z.string().trim().min(5).max(500),
}).strict();
function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
    details: issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  } });
}
function settlementResource(item) {
  return {
    id: item.id, deliveryLegId: item.deliveryLegId, payeeName: item.payeeName,
    payeePhone: item.payeePhone, amountMinor: item.amountMinor.toString(),
    currency: item.currency, status: item.status, reason: item.reason,
    paymentReference: item.paymentReference, settledAt: item.settledAt,
    createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}
export function createManualOperationalSettlementRouter({ prismaClient }) {
  const router = Router();

  router.get("/delivery-legs/:legId/manual-settlement", asyncWrapper(async (req, res) => {
    if (!id.safeParse(req.params.legId).success) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid delivery-leg identifier is required." } });
    const item = await prismaClient.manualOperationalSettlement.findUnique({ where: { deliveryLegId: req.params.legId } });
    if (!item) return res.status(404).json({ success: false, error: { code: "MANUAL_SETTLEMENT_NOT_FOUND", message: "No platform-managed driver settlement exists for this leg." } });
    return res.status(200).json({ success: true, data: { settlement: settlementResource(item) } });
  }));

  router.patch("/delivery-legs/:legId/platform-managed-status", asyncWrapper(async (req, res) => {
    if (!id.safeParse(req.params.legId).success) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid delivery-leg identifier is required." } });
    const parsed = statusInput.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const leg = await prismaClient.deliveryLeg.findUnique({ where: { id: req.params.legId }, include: {
      parcelBooking: { select: { id: true, paymentStatus: true } },
    } });
    if (!leg) return res.status(404).json({ success: false, error: { code: "DELIVERY_LEG_NOT_FOUND", message: "Delivery leg not found." } });
    if (leg.metadata?.pricingSource !== "ADMIN_OPERATIONAL_TRIP" || leg.metadata?.executionType !== "PLATFORM_MANAGED_DRIVER") {
      return res.status(409).json({ success: false, error: { code: "NOT_PLATFORM_MANAGED_LEG", message: "This leg is not assigned to a platform-managed driver." } });
    }
    if (leg.parcelBooking.paymentStatus !== "SUCCEEDED") return res.status(409).json({ success: false, error: { code: "BOOKING_NOT_PAID", message: "The customer payment must be confirmed before manual driver execution can progress." } });
    if (leg.status === parsed.data.status) return res.status(200).json({ success: true, data: { deliveryLegId: leg.id, status: leg.status, replay: true } });
    const allowed = leg.status === "ASSIGNED" ? ["IN_TRANSIT"] : leg.status === "IN_TRANSIT" ? ["COMPLETED", "FAILED"] : [];
    if (!allowed.includes(parsed.data.status)) return res.status(409).json({ success: false, error: { code: "INVALID_LEG_STATUS_TRANSITION", message: "Platform-managed legs must move from ASSIGNED to IN_TRANSIT, then to COMPLETED or FAILED." } });
    const now = new Date();
    const changed = await prismaClient.$transaction(async tx => {
      const updated = await tx.deliveryLeg.updateMany({
        where: { id: leg.id, status: leg.status },
        data: {
          status: parsed.data.status,
          ...(parsed.data.status === "IN_TRANSIT" ? { startedAt: now } : {}),
          ...(parsed.data.status === "COMPLETED" ? { completedAt: now } : {}),
          ...(parsed.data.status === "FAILED" ? { failureReason: parsed.data.reason } : {}),
        },
      });
      if (updated.count !== 1) return false;
      await tx.bookingEvent.create({ data: {
        parcelBookingId: leg.parcelBookingId, actorUserId: req.user.id,
        eventType: "PLATFORM_MANAGED_DELIVERY_LEG_STATUS_UPDATED",
        fromStatus: leg.status, toStatus: parsed.data.status,
        metadata: { deliveryLegId: leg.id, sequence: leg.sequence, reason: parsed.data.reason },
      } });
      await tx.operationalAuditEvent.create({ data: {
        actorUserId: req.user.id, entityType: "DELIVERY_LEG", entityId: leg.id,
        action: "PLATFORM_MANAGED_LEG_STATUS_UPDATED", reason: parsed.data.reason,
        before: { status: leg.status }, after: { status: parsed.data.status },
      } });
      return true;
    });
    if (!changed) return res.status(409).json({ success: false, error: { code: "DELIVERY_LEG_STATE_CONFLICT", message: "The leg changed while its status was being updated." } });
    return res.status(200).json({ success: true, data: { deliveryLegId: leg.id, status: parsed.data.status, replay: false } });
  }));

  router.post("/delivery-legs/:legId/manual-settlement/settle", asyncWrapper(async (req, res) => {
    if (!id.safeParse(req.params.legId).success) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid delivery-leg identifier is required." } });
    const parsed = settlementInput.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const result = await prismaClient.$transaction(async tx => {
      const item = await tx.manualOperationalSettlement.findUnique({ where: { deliveryLegId: req.params.legId }, include: {
        deliveryLeg: { include: { parcelBooking: { select: { paymentStatus: true } } } },
      } });
      if (!item) return { notFound: true };
      if (item.status === "PAID") return item.paymentReference === parsed.data.paymentReference ? { item, replay: true } : { conflict: "SETTLEMENT_ALREADY_PAID" };
      if (item.status !== "PENDING" || item.deliveryLeg.status !== "COMPLETED" || item.deliveryLeg.parcelBooking.paymentStatus !== "SUCCEEDED") {
        return { conflict: "SETTLEMENT_NOT_PAYABLE" };
      }
      const now = new Date();
      const priorReference = await tx.manualOperationalSettlement.findUnique({ where: { paymentReference: parsed.data.paymentReference } });
      if (priorReference && priorReference.id !== item.id) return { conflict: "PAYMENT_REFERENCE_ALREADY_USED" };
      const fundsCode = "OPERATIONAL_CUSTOMER_FUNDS_" + item.currency;
      const clearingCode = "MANUAL_DRIVER_SETTLEMENT_CLEARING_" + item.currency;
      const [funds, clearing] = await Promise.all([
        tx.ledgerAccount.upsert({ where: { code: fundsCode }, create: { code: fundsCode, name: "Operational customer funds held for fulfilment", type: "LIABILITY", currency: item.currency }, update: {} }),
        tx.ledgerAccount.upsert({ where: { code: clearingCode }, create: { code: clearingCode, name: "Manual driver settlement clearing", type: "ASSET", currency: item.currency }, update: {} }),
      ]);
      const balances = await tx.ledgerEntry.groupBy({ by: ["side"], where: { accountId: funds.id }, _sum: { amountMinor: true } });
      const credits = balances.find(row => row.side === "CREDIT")?._sum.amountMinor ?? 0n;
      const debits = balances.find(row => row.side === "DEBIT")?._sum.amountMinor ?? 0n;
      if (credits - debits < item.amountMinor) return { conflict: "OPERATIONAL_FUNDS_INSUFFICIENT" };
      const changed = await tx.manualOperationalSettlement.updateMany({
        where: { id: item.id, status: "PENDING" },
        data: { status: "PAID", paymentReference: parsed.data.paymentReference, settledAt: now, settledByUserId: req.user.id },
      });
      if (changed.count !== 1) return { conflict: "SETTLEMENT_STATE_CONFLICT" };
      const journalReference = "MANUAL-OPERATIONAL-DRIVER-SETTLEMENT:" + item.id;
      const posted = await tx.ledgerEntry.findFirst({ where: { journalReference }, select: { id: true } });
      if (!posted) {
        const common = { journalReference, currency: item.currency, description: "Admin-recorded manual payout to a platform-managed delivery driver", parcelBookingId: item.deliveryLeg.parcelBookingId };
        await tx.ledgerEntry.createMany({ data: [
          { ...common, accountId: funds.id, side: "DEBIT", amountMinor: item.amountMinor },
          { ...common, accountId: clearing.id, side: "CREDIT", amountMinor: item.amountMinor },
        ] });
      }
      await tx.operationalAuditEvent.create({ data: {
        actorUserId: req.user.id, entityType: "MANUAL_OPERATIONAL_SETTLEMENT", entityId: item.id,
        action: "MANUAL_OPERATIONAL_DRIVER_SETTLED", reason: parsed.data.reason,
        before: { status: item.status, paymentReference: item.paymentReference },
        after: { status: "PAID", paymentReference: parsed.data.paymentReference, amountMinor: item.amountMinor.toString(), currency: item.currency },
      } });
      await tx.bookingEvent.create({ data: {
        parcelBookingId: item.deliveryLeg.parcelBookingId, actorUserId: req.user.id,
        eventType: "MANUAL_OPERATIONAL_DRIVER_SETTLED",
        metadata: { deliveryLegId: item.deliveryLegId, settlementId: item.id, amountMinor: item.amountMinor.toString(), currency: item.currency },
      } });
      const updated = await tx.manualOperationalSettlement.findUnique({ where: { id: item.id } });
      return { item: updated, replay: false };
    });
    if (result.notFound) return res.status(404).json({ success: false, error: { code: "MANUAL_SETTLEMENT_NOT_FOUND", message: "No platform-managed driver settlement exists for this leg." } });
    if (result.conflict) return res.status(409).json({ success: false, error: {
      code: result.conflict,
      message: result.conflict === "OPERATIONAL_FUNDS_INSUFFICIENT" ? "Collected operational customer funds do not cover this manual driver payout." : result.conflict === "PAYMENT_REFERENCE_ALREADY_USED" ? "This payment reference has already been recorded for another settlement." : "This manual settlement cannot be completed in its current state.",
    } });
    return res.status(200).json({ success: true, data: { settlement: settlementResource(result.item), replay: result.replay } });
  }));

  return router;
}
