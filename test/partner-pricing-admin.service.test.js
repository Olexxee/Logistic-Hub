import test from "node:test";
import assert from "node:assert/strict";
import { createPartnerPricingAdminService } from "../src/modules/partner-pricing/partner-pricing.admin.service.js";

function serviceWith(tx) {
  const client = { $queryRaw: async () => [], ...tx };
  return createPartnerPricingAdminService({
    prismaClient: { ...client, $transaction: async callback => callback(client) },
    clock: () => new Date("2026-10-30T12:00:00.000Z"),
  });
}

test("partner activation requires VERIFIED status", async () => {
  let updated = false;
  const tx = {
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "PENDING", verificationStatus: "PENDING", verifiedAt: null }),
      update: async () => { updated = true; },
    },
  };
  const result = await serviceWith(tx).setPartnerStatus({ partnerId: "partner-1", input: { status: "ACTIVE" }, actorUserId: "admin-1" });
  assert.equal(result.blocker, "PARTNER_NOT_VERIFIED");
  assert.equal(updated, false);
});

test("partner status transition persists an audit event in the same transaction", async () => {
  const events = [];
  const tx = {
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "PENDING", verificationStatus: "VERIFIED", verifiedAt: null }),
      update: async ({ data }) => ({ id: "partner-1", ...data }),
    },
    operationalAuditEvent: { create: async ({ data }) => { events.push(data); } },
  };
  const result = await serviceWith(tx).setPartnerStatus({ partnerId: "partner-1", input: { status: "ACTIVE" }, actorUserId: "admin-1" });
  assert.equal(result.partner.status, "ACTIVE");
  assert.equal(result.partner.verifiedAt.toISOString(), "2026-10-30T12:00:00.000Z");
  assert.equal(events[0].entityType, "TRANSPORT_PARTNER");
  assert.equal(events[0].action, "PARTNER_STATUS_UPDATED");
  assert.equal(events[0].actorUserId, "admin-1");
});

test("rate-card publishing is blocked when no active rates exist", async () => {
  const tx = {
    partnerRateCard: {
      findUnique: async () => ({
        id: "card-1", status: "DRAFT", effectiveFrom: new Date("2026-10-01T00:00:00Z"), effectiveUntil: null,
        agreement: {
          status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00Z"), effectiveUntil: null,
          partner: { status: "ACTIVE", verificationStatus: "VERIFIED" },
        },
        rates: [],
      }),
    },
  };
  const result = await serviceWith(tx).publishRateCard({ rateCardId: "card-1", actorUserId: "admin-1" });
  assert.equal(result.blocker, "NO_ACTIVE_RATES");
});


test("a closed partner cannot be reactivated", async () => {
  let updateCalled = false;
  const tx = {
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "CLOSED", verificationStatus: "VERIFIED", verifiedAt: new Date() }),
      update: async () => { updateCalled = true; },
    },
  };
  const result = await serviceWith(tx).setPartnerStatus({
    partnerId: "partner-1", input: { status: "ACTIVE" }, actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "PARTNER_CLOSED");
  assert.equal(updateCalled, false);
});

test("partner closure is blocked while active assignments remain", async () => {
  let updateCalled = false;
  const tx = {
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "SUSPENDED", verificationStatus: "VERIFIED", verifiedAt: new Date() }),
      update: async () => { updateCalled = true; },
    },
    transportPartnerMember: { count: async () => 0 },
    partnerAgreement: { count: async () => 0 },
    partnerDeliveryAssignment: { count: async () => 1 },
    partnerPayable: { count: async () => 0 },
    partnerSettlementBatch: { count: async () => 0 },
  };
  const result = await serviceWith(tx).setPartnerStatus({
    partnerId: "partner-1", input: { status: "CLOSED" }, actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "ACTIVE_PARTNER_ASSIGNMENTS_EXIST");
  assert.equal(updateCalled, false);
});

test("partner closure is blocked while outstanding payables remain", async () => {
  const tx = {
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "SUSPENDED", verificationStatus: "VERIFIED", verifiedAt: new Date() }),
      update: async () => { throw new Error("partner must not close with open payables"); },
    },
    transportPartnerMember: { count: async () => 0 },
    partnerAgreement: { count: async () => 0 },
    partnerDeliveryAssignment: { count: async () => 0 },
    partnerPayable: { count: async () => 2 },
    partnerSettlementBatch: { count: async () => 0 },
  };
  const result = await serviceWith(tx).setPartnerStatus({
    partnerId: "partner-1", input: { status: "CLOSED" }, actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "OPEN_PARTNER_PAYABLES_EXIST");
});

test("partner lifecycle mutations use serializable transactions", async () => {
  let options;
  const tx = {
    $queryRaw: async () => [],
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "PENDING", verificationStatus: "VERIFIED", verifiedAt: null }),
      update: async ({ data }) => ({ id: "partner-1", ...data }),
    },
    operationalAuditEvent: { create: async ({ data }) => ({ id: "audit-1", ...data }) },
  };
  const prismaClient = {
    ...tx,
    $transaction: async (callback, transactionOptions) => {
      options = transactionOptions;
      return callback(tx);
    },
  };
  const service = createPartnerPricingAdminService({ prismaClient, clock: () => new Date("2026-10-30T12:00:00.000Z") });
  await service.setPartnerStatus({ partnerId: "partner-1", input: { status: "ACTIVE" }, actorUserId: "admin-1" });
  assert.deepEqual(options, { isolationLevel: "Serializable" });
});
