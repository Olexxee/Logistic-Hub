import test from "node:test";
import assert from "node:assert/strict";
import { createPartnerPricingAdminService } from "../src/modules/partner-pricing/partner-pricing.admin.service.js";

function serviceWith(tx) {
  return createPartnerPricingAdminService({ prismaClient: { ...tx, $transaction: async callback => callback(tx) }, clock: () => new Date("2026-10-30T12:00:00.000Z") });
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
    transportPartnerMember: { count: async () => 1 },
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


test("partner suspension is blocked while assignments are active", async () => {
  const tx = {
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" }) },
    partnerDeliveryAssignment: { count: async () => 1 },
  };
  const result = await serviceWith(tx).setPartnerStatus({ partnerId: "partner-1", input: { status: "SUSPENDED" }, actorUserId: "admin-1" });
  assert.equal(result.blocker, "PARTNER_HAS_ACTIVE_ASSIGNMENTS");
});

test("partner suspension suspends active agreements and audits the dependent transition", async () => {
  const events = [];
  let agreementUpdates = 0;
  const tx = {
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED", verifiedAt: new Date("2026-10-01T00:00:00Z") }),
      update: async ({ data }) => ({ id: "partner-1", ...data }),
    },
    partnerDeliveryAssignment: { count: async () => 0 },
    partnerAgreement: {
      findMany: async () => [{ id: "agreement-1", status: "ACTIVE" }],
      updateMany: async () => { agreementUpdates += 1; return { count: 1 }; },
    },
    operationalAuditEvent: { create: async ({ data }) => { events.push(data); } },
  };
  const result = await serviceWith(tx).setPartnerStatus({ partnerId: "partner-1", input: { status: "SUSPENDED" }, actorUserId: "admin-1" });
  assert.equal(result.partner.status, "SUSPENDED");
  assert.equal(agreementUpdates, 1);
  assert.equal(events.some(event => event.action === "PARTNER_AGREEMENT_SUSPENDED_WITH_PARTNER"), true);
});

test("partner closure is blocked while agreements remain open", async () => {
  const tx = {
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "SUSPENDED", verificationStatus: "VERIFIED" }) },
    partnerDeliveryAssignment: { count: async () => 0 },
    transportPartnerMember: { count: async () => 0 },
    partnerAgreement: { count: async () => 1 },
    partnerPayable: { count: async () => 0 },
  };
  const result = await serviceWith(tx).setPartnerStatus({ partnerId: "partner-1", input: { status: "CLOSED" }, actorUserId: "admin-1" });
  assert.equal(result.blocker, "PARTNER_HAS_OPEN_AGREEMENTS");
});


test("partner activation is blocked until an active verified owner exists", async () => {
  let updateCalled = false;
  const tx = {
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "PENDING", verificationStatus: "VERIFIED", verifiedAt: null }),
      update: async () => { updateCalled = true; },
    },
    transportPartnerMember: { count: async () => 0 },
  };
  const result = await serviceWith(tx).setPartnerStatus({
    partnerId: "partner-1", input: { status: "ACTIVE" }, actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "PARTNER_OWNER_REQUIRED");
  assert.equal(updateCalled, false);
});
