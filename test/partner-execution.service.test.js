import test from "node:test";
import assert from "node:assert/strict";
import { createPartnerExecutionService } from "../src/modules/partner-execution/partner-execution.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");
function transaction(tx) {
  return { ...tx, $transaction: async callback => callback(tx) };
}

test("partner assignment uses the accepted contracted quote and is audited transactionally", async () => {
  const audit = [];
  const created = [];
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => { created.push(data); return { id: "assignment-1", ...data }; },
    },
    deliveryLeg: {
      findUnique: async () => ({
        id: "leg-1", type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT",
        parcelBookingId: "booking-1", parcelBooking: { id: "booking-1", paymentStatus: "SUCCEEDED", status: "AWAITING_PAYMENT" },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    shipmentQuote: {
      findFirst: async () => ({ id: "quote-1", partnerAgreementId: "agreement-1", transportChargeMinor: 450000n, currency: "NGN" }),
    },
    transportPartner: {
      findUnique: async () => ({ id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" }),
    },
    partnerAgreement: {
      findUnique: async () => ({
        id: "agreement-1", partnerId: "partner-1", status: "ACTIVE", currency: "NGN",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveUntil: null,
        partner: { id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" },
      }),
    },
    operationalAuditEvent: { create: async ({ data }) => { audit.push(data); } },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.assignLeg({
    deliveryLegId: "leg-1", partnerId: "partner-1", idempotencyKey: "assign-leg-0001", actorUserId: "admin-1",
  });
  assert.equal(result.replay, false);
  assert.equal(created[0].agreedTransportChargeMinor, 450000n);
  assert.equal(created[0].agreementId, "agreement-1");
  assert.equal(audit[0].action, "PARTNER_LEG_ASSIGNED");
});

test("partner assignment is blocked until payment is verified", async () => {
  const tx = {
    partnerDeliveryAssignment: { findUnique: async () => null },
    deliveryLeg: { findUnique: async () => ({
      id: "leg-1", type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT",
      parcelBookingId: "booking-1", parcelBooking: { id: "booking-1", paymentStatus: "PENDING" },
    }) },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.assignLeg({
    deliveryLegId: "leg-1", partnerId: "partner-1", idempotencyKey: "assign-leg-0002", actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "BOOKING_NOT_PAID");
});

test("idempotency key cannot be reused for another leg or partner", async () => {
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => ({ id: "assignment-1", deliveryLegId: "leg-other", partnerId: "partner-1" }),
    },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  await assert.rejects(
    service.assignLeg({ deliveryLegId: "leg-1", partnerId: "partner-1", idempotencyKey: "assign-leg-0003", actorUserId: "admin-1" }),
    error => error.code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("partner member can accept and start only its own assignment", async () => {
  const audit = [];
  let assignmentStatus = "ASSIGNED";
  let legStatus = "ASSIGNED";
  const assignment = { id: "assignment-1", partnerId: "partner-1", deliveryLegId: "leg-1", status: "ASSIGNED" };
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => ({ ...assignment, status: assignmentStatus, partner: {}, deliveryLeg: {} }),
      updateMany: async ({ where, data }) => {
        if (assignmentStatus !== where.status) return { count: 0 };
        assignmentStatus = data.status;
        return { count: 1 };
      },
    },
    transportPartnerMember: {
      findUnique: async () => ({ partnerId: "partner-1", userId: "operator-1", isActive: true }),
    },
    deliveryLeg: {
      updateMany: async ({ where, data }) => {
        if (legStatus !== where.status) return { count: 0 };
        legStatus = data.status;
        return { count: 1 };
      },
    },
    operationalAuditEvent: { create: async ({ data }) => { audit.push(data); } },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const accepted = await service.acceptAssignment({ assignmentId: "assignment-1", userId: "operator-1" });
  assert.equal(accepted.assignment.status, "ACCEPTED");
  const started = await service.startAssignment({ assignmentId: "assignment-1", userId: "operator-1" });
  assert.equal(started.assignment.status, "IN_TRANSIT");
  assert.equal(legStatus, "IN_TRANSIT");
  assert.equal(audit.length, 2);
});

test("a user without an active partner membership cannot accept an assignment", async () => {
  const tx = {
    partnerDeliveryAssignment: {
      findUnique: async () => ({ id: "assignment-1", partnerId: "partner-1", deliveryLegId: "leg-1", status: "ASSIGNED" }),
    },
    transportPartnerMember: { findUnique: async () => null },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  await assert.rejects(
    service.acceptAssignment({ assignmentId: "assignment-1", userId: "intruder-1" }),
    error => error.statusCode === 403 && error.code === "PARTNER_MEMBERSHIP_REQUIRED",
  );
});


test("partner assignment queue is scoped to active memberships and paginated", async () => {
  let capturedFindMany;
  let capturedCount;
  const rows = [{ id: "assignment-1", status: "ASSIGNED" }];
  const tx = {
    transportPartnerMember: {
      findMany: async args => {
        assert.equal(args.where.userId, "operator-1");
        assert.equal(args.where.isActive, true);
        return [{ partnerId: "partner-1" }, { partnerId: "partner-2" }];
      },
    },
    partnerDeliveryAssignment: {
      findMany: async args => { capturedFindMany = args; return rows; },
      count: async args => { capturedCount = args; return 31; },
    },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  const result = await service.listMyAssignments({ userId: "operator-1", page: 2, limit: 10 });

  assert.deepEqual(capturedFindMany.where, { partnerId: { in: ["partner-1", "partner-2"] } });
  assert.equal(capturedFindMany.skip, 10);
  assert.equal(capturedFindMany.take, 10);
  assert.deepEqual(capturedCount, { where: { partnerId: { in: ["partner-1", "partner-2"] } } });
  assert.deepEqual(result, {
    items: rows,
    pagination: { page: 2, limit: 10, total: 31, totalPages: 4 },
  });
});

test("partner assignment queue rejects users without active partner memberships", async () => {
  const tx = {
    transportPartnerMember: { findMany: async () => [] },
  };
  const service = createPartnerExecutionService({ prismaClient: transaction(tx), clock: () => now });
  await assert.rejects(
    service.listMyAssignments({ userId: "operator-2", page: 1, limit: 20 }),
    error => error.statusCode === 403 && error.code === "PARTNER_MEMBERSHIP_REQUIRED",
  );
});
