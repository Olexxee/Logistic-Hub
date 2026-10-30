import test from "node:test";
import assert from "node:assert/strict";
import { createPartnerSettlementService } from "../src/modules/partner-settlement/partner-settlement.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");
function db(tx) {
  return { ...tx, $transaction: async callback => callback(tx) };
}

test("settlement batch total and line items are derived from approved payable records", async () => {
  const payableRows = [
    { id: "payable-1", amountMinor: 120000n, currency: "NGN", generatedAt: new Date("2026-10-20T00:00:00.000Z") },
    { id: "payable-2", amountMinor: 85000n, currency: "NGN", generatedAt: new Date("2026-10-21T00:00:00.000Z") },
  ];
  const created = [];
  const itemRows = [];
  let findBatchCount = 0;
  const batch = {
    id: "batch-1", partnerId: "partner-1", reference: "PSB-TEST",
    idempotencyKey: "batch-key-00001", currency: "NGN",
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-11-01T00:00:00.000Z"),
    totalAmountMinor: 205000n, status: "DRAFT",
  };
  const tx = {
    partnerSettlementBatch: {
      findUnique: async () => (++findBatchCount === 1 ? null : { ...batch, items: itemRows }),
      create: async ({ data }) => { created.push(data); return { ...batch, ...data }; },
    },
    transportPartner: { findUnique: async () => ({ id: "partner-1" }) },
    partnerPayable: {
      findMany: async () => payableRows,
      updateMany: async () => ({ count: payableRows.length }),
    },
    partnerSettlementBatchItem: {
      createMany: async ({ data }) => { itemRows.push(...data); return { count: data.length }; },
    },
    operationalAuditEvent: { create: async () => ({}) },
  };
  const service = createPartnerSettlementService({ prismaClient: db(tx), clock: () => now });
  const result = await service.createBatch({
    partnerId: "partner-1",
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    idempotencyKey: "batch-key-00001",
    actorUserId: "admin-1",
  });
  assert.equal(created[0].totalAmountMinor, 205000n);
  assert.deepEqual(itemRows.map(row => row.amountMinor), [120000n, 85000n]);
  assert.equal(result.batches[0].totalAmountMinor, "205000");
});

test("matched reconciliation requires exact amount and external reference", async () => {
  const tx = {
    partnerSettlementBatch: {
      findUnique: async () => ({
        id: "batch-1", status: "APPROVED", totalAmountMinor: 205000n, items: [{ payableId: "payable-1" }],
      }),
    },
    partnerSettlementReconciliation: { create: async () => { throw new Error("must not write invalid match"); } },
  };
  const service = createPartnerSettlementService({ prismaClient: db(tx), clock: () => now });
  await assert.rejects(
    service.reconcileBatch({
      batchId: "batch-1", outcome: "MATCHED", actualAmountMinor: "204999",
      externalReference: "bank-ref-1", actorUserId: "admin-1",
    }),
    error => error.code === "RECONCILIATION_MATCH_INVALID",
  );
});
