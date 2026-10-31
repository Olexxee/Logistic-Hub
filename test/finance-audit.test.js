import test from "node:test";
import assert from "node:assert/strict";
import { createFinanceRepository } from "../src/modules/finance/finance.repository.js";

test("refund review mutation and audit event share one transaction", async () => {
  let audit;
  const current = { id: "refund-1", status: "PENDING_REVIEW", providerReference: null };
  const prismaClient = {
    $transaction: callback => callback({
      refundRequest: {
        findUnique: async () => current,
        update: async ({ data }) => ({ ...current, ...data }),
      },
      operationalAuditEvent: { create: async ({ data }) => { audit = data; return { id: "audit-1" }; } },
    }),
  };
  const repo = createFinanceRepository(prismaClient);
  const updated = await repo.reviewRefund({ id: "refund-1", reviewerId: "admin-1", decision: "REJECT", note: "Duplicate request" });
  assert.equal(updated.status, "REJECTED");
  assert.equal(audit.actorUserId, "admin-1");
  assert.equal(audit.entityType, "REFUND_REQUEST");
  assert.equal(audit.action, "REFUND_REQUEST_REJECTED");
  assert.deepEqual(audit.before, { status: "PENDING_REVIEW" });
  assert.deepEqual(audit.after, { status: "REJECTED", reviewedByUserId: "admin-1" });
});

test("payout settlement confirmation is audited in its transaction", async () => {
  let audit;
  const current = { id: "payout-1", status: "ELIGIBLE", providerReference: null };
  const prismaClient = {
    $transaction: callback => callback({
      driverPayout: {
        findUnique: async () => current,
        update: async ({ data }) => ({ ...current, ...data }),
      },
      operationalAuditEvent: { create: async ({ data }) => { audit = data; return { id: "audit-2" }; } },
    }),
  };
  const repo = createFinanceRepository(prismaClient);
  const updated = await repo.confirmPayout({ id: "payout-1", providerReference: "bank-ref-1", actorUserId: "admin-1" });
  assert.equal(updated.status, "PAID");
  assert.equal(audit.actorUserId, "admin-1");
  assert.equal(audit.action, "DRIVER_PAYOUT_SETTLEMENT_CONFIRMED");
  assert.deepEqual(audit.before, { status: "ELIGIBLE", providerReference: null });
  assert.deepEqual(audit.after, { status: "PAID", providerReference: "bank-ref-1" });
});

test("provider refund webhook transition and system audit event share one transaction", async () => {
  const audits = [];
  let current = { id: "refund-webhook-1", status: "PROCESSING", providerReference: "provider-ref-1" };
  const prismaClient = {
    $transaction: callback => callback({
      refundRequest: {
        findMany: async () => current.status === "PROCESSED" ? [] : [{ ...current }],
        updateMany: async ({ where, data }) => {
          if (where.id !== current.id || where.status !== current.status) return { count: 0 };
          current = { ...current, ...data };
          return { count: 1 };
        },
      },
      operationalAuditEvent: {
        create: async ({ data }) => { audits.push(data); return { id: "system-audit-1" }; },
      },
    }),
  };
  const repo = createFinanceRepository(prismaClient);
  const result = await repo.updateRefundFromWebhook({
    providerReference: "provider-ref-1",
    status: "PROCESSED",
    providerResponse: { event: "refund.processed", id: "provider-ref-1" },
  });
  assert.deepEqual(result, { count: 1 });
  assert.equal(current.status, "PROCESSED");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorUserId, null);
  assert.equal(audits[0].entityId, "refund-webhook-1");
  assert.equal(audits[0].action, "REFUND_PROVIDER_WEBHOOK_STATUS_UPDATED");
  assert.deepEqual(audits[0].before, { status: "PROCESSING", providerReference: "provider-ref-1" });
  assert.deepEqual(audits[0].after, { status: "PROCESSED", providerReference: "provider-ref-1" });
  assert.equal(audits[0].metadata.actorType, "SYSTEM");
  assert.equal(audits[0].metadata.systemSource, "PAYSTACK_REFUND_WEBHOOK");

  const duplicate = await repo.updateRefundFromWebhook({
    providerReference: "provider-ref-1",
    status: "PROCESSED",
    providerResponse: { event: "refund.processed", id: "provider-ref-1" },
  });
  assert.deepEqual(duplicate, { count: 0 });
  assert.equal(audits.length, 1);
});
