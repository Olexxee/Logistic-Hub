import test from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/modules/custody/custody.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");
const booking = { id: "booking-1", senderId: "sender-1", paymentStatus: "SUCCEEDED", status: "IN_TRANSIT", recipientName: "Recipient", recipientPhone: "08000000000" };
const leg = {
  id: "leg-1", parcelBookingId: "booking-1", status: "IN_TRANSIT",
  originHubPointId: "hub-1", destinationHubPointId: "hub-2",
  parcelBooking: booking,
  assignments: [{ driverProfileId: "driver-1", driverProfile: { id: "driver-1", userId: "driver-user-1" } }],
  partnerAssignments: [],
};
function tx(overrides = {}) {
  const calls = { audits: [], cases: [], handovers: [] };
  const base = {
    user: { findUnique: async ({ where }) => ({ id: where.id, status: "ACTIVE", role: "CUSTOMER", emailVerifiedAt: now }), updateMany: async () => ({ count: 1 }) },
    deliveryLeg: { findUnique: async () => leg, findFirst: async () => null, updateMany: async () => ({ count: 1 }) },
    driverProfile: { findUnique: async () => ({ id: "driver-1", userId: "driver-user-1", verificationStatus: "VERIFIED" }), findMany: async () => [], update: async () => ({}) },
    hubPoint: { findUnique: async () => ({ id: "hub-1", status: "ACTIVE" }) },
    hubPointOperator: { findUnique: async () => null, findMany: async () => [], findFirst: async () => null, upsert: async ({ create }) => ({ id: "hub-operator-1", ...create }), update: async () => ({}), count: async () => 0 },
    transportPartner: { findUnique: async () => null },
    transportPartnerMember: { findUnique: async () => null, findMany: async () => [] },
    hubIntakeRecord: { findFirst: async () => ({ id: "hub-intake-1" }), count: async () => 0, aggregate: async () => ({ _sum: { weightGrams: 0, volumeCm3: 0 } }), create: async ({ data }) => ({ id: "hub-intake-1", ...data }), update: async ({ where, data }) => ({ id: where.id, ...data }) },
    custodyHandover: {
      findFirst: async () => null,
      findUnique: async () => null,
      create: async ({ data }) => { const value = { id: "handover-1", status: "PENDING_CONFIRMATION", ...data }; calls.handovers.push(value); return value; },
      update: async ({ where, data }) => ({ id: where.id, status: data.status, ...data }),
    },
    operationalCase: { create: async ({ data }) => { const value = { id: "case-1", ...data }; calls.cases.push(value); return value; } },
    bookingEvent: { create: async () => ({}) },
    parcelBooking: { update: async () => ({}) },
    driverAssignment: { findFirst: async () => null, updateMany: async () => ({ count: 1 }) },
    driverPayout: { upsert: async () => ({ id: "driver-payout-1" }) },
    operationalAuditEvent: { create: async ({ data }) => { calls.audits.push(data); return data; } },
    $queryRaw: async () => [],
    $transaction: async callback => callback(base),
  };
  Object.assign(base, overrides);
  return { db: base, calls };
}

test("sender can initiate a pending handover to an assigned driver", async () => {
  const { db, calls } = tx();
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.createHandover({
    parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "DRIVER", toPartyId: "driver-1",
    conditionAtRelease: "Sealed, no visible damage",
  }, "sender-1");
  assert.equal(result.handover.status, "PENDING_CONFIRMATION");
  assert.equal(result.handover.initiatedByUserId, "sender-1");
  assert.equal(calls.audits[0].action, "CUSTODY_HANDOVER_INITIATED");
});

test("unassigned driver cannot be used as a custody party", async () => {
  const { db } = tx({ driverProfile: { findUnique: async () => ({ id: "driver-2", userId: "driver-user-2" }) } });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(service.createHandover({
    parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "DRIVER", toPartyId: "driver-2",
    conditionAtRelease: "Sealed",
  }, "sender-1"), error => error.code === "INVALID_CUSTODY_PARTY");
});

test("receiving driver rejection creates an operational case transactionally", async () => {
  const handover = {
    id: "handover-1", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "sender-1", fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "DRIVER", toPartyId: "driver-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
  };
  const { db, calls } = tx({
    custodyHandover: {
      findUnique: async () => handover,
      update: async ({ where, data }) => ({ id: where.id, ...handover, ...data }),
      findFirst: async () => null,
      create: async ({ data }) => ({ id: "new-handover", ...data }),
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.confirmHandover({
    handoverId: "handover-1", userId: "driver-user-1",
    conditionAtReceipt: "Outer packaging torn",
    rejectReason: "Parcel condition differs from release record.",
  });
  assert.equal(result.handover.status, "REJECTED");
  assert.equal(result.operationalCase.type, "FAILED_HANDOVER");
  assert.equal(result.operationalCase.priority, "HIGH");
  assert.equal(calls.cases.length, 1);
  assert.equal(calls.audits[0].action, "CUSTODY_HANDOVER_REJECTED");
});

test("a user who is not the receiving driver cannot confirm a handover", async () => {
  const handover = {
    id: "handover-1", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "sender-1", toPartyType: "DRIVER", toPartyId: "driver-1",
    status: "PENDING_CONFIRMATION", expiresAt: new Date("2026-10-31T12:00:00.000Z"),
    parcelBooking: booking,
  };
  const { db } = tx({
    custodyHandover: { findUnique: async () => handover, update: async () => ({}), findFirst: async () => null, create: async () => ({}) },
    driverProfile: { findUnique: async () => ({ id: "driver-1", userId: "someone-else", verificationStatus: "VERIFIED" }), findMany: async () => [] },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(service.confirmHandover({ handoverId: "handover-1", userId: "intruder-1" }), error => error.statusCode === 403);
});

test("releasing user cannot confirm their own handover", async () => {
  const handover = {
    id: "handover-1", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "sender-1", toPartyType: "DRIVER", toPartyId: "driver-1",
    status: "PENDING_CONFIRMATION", expiresAt: new Date("2026-10-31T12:00:00.000Z"),
    parcelBooking: booking,
  };
  const { db } = tx({ custodyHandover: { findUnique: async () => handover } });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(service.confirmHandover({ handoverId: "handover-1", userId: "sender-1" }), error => error.code === "HANDOVER_SELF_CONFIRMATION");
});

test("admin can add an existing partner operator as a hub operator without downgrading their role", async () => {
  const { db } = tx({
    user: { findUnique: async () => ({ id: "operator-1", status: "ACTIVE", role: "PARTNER_OPERATOR", emailVerifiedAt: now }) },
    hubPoint: { findUnique: async () => ({ id: "hub-1", status: "ACTIVE" }) },
    hubPointOperator: {
      upsert: async ({ create }) => ({ id: "hub-operator-1", ...create }),
    },
  });
  let roleUpdates = 0;
  db.user.update = async () => { roleUpdates += 1; };
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.addHubOperator({ hubPointId: "hub-1", userId: "operator-1", actorUserId: "admin-1" });
  assert.equal(result.operator.isActive, true);
  assert.equal(roleUpdates, 0);
});


test("verified booking recipient can be the receiving custody party", async () => {
  const { db, calls } = tx({
    user: {
      findUnique: async ({ where }) => where.id === "recipient-1"
        ? { id: "recipient-1", status: "ACTIVE", role: "CUSTOMER", emailVerifiedAt: now, phone: "08000000000", phoneVerifiedAt: now }
        : { id: where.id, status: "ACTIVE", role: "CUSTOMER", emailVerifiedAt: now },
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.createHandover({
    parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "RECIPIENT", toPartyId: "recipient-1",
    conditionAtRelease: "Parcel sealed",
  }, "sender-1");
  assert.equal(result.handover.toPartyType, "RECIPIENT");
  assert.equal(calls.audits[0].action, "CUSTODY_HANDOVER_INITIATED");
});

test("recipient account with a mismatched phone cannot be a custody party", async () => {
  const { db } = tx({
    user: {
      findUnique: async ({ where }) => where.id === "recipient-1"
        ? { id: "recipient-1", status: "ACTIVE", role: "CUSTOMER", emailVerifiedAt: now, phone: "08011111111", phoneVerifiedAt: now }
        : { id: where.id, status: "ACTIVE", role: "CUSTOMER", emailVerifiedAt: now },
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(service.createHandover({
    parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "RECIPIENT", toPartyId: "recipient-1",
    conditionAtRelease: "Parcel sealed",
  }, "sender-1"), error => error.code === "RECIPIENT_VERIFICATION_REQUIRED");
});

test("confirmed destination hub handover completes partner assignment and creates one payable", async () => {
  const handover = {
    id: "handover-partner-1", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "partner-user-1", fromPartyType: "TRANSPORT_PARTNER", fromPartyId: "partner-1",
    toPartyType: "HUB", toPartyId: "hub-2", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
  };
  const calls = { assignmentUpdates: [], legUpdates: [], payables: [], audits: [] };
  const partnerLeg = { ...leg, destinationHubPointId: "hub-2", partnerAssignments: [{ partnerId: "partner-1", status: "IN_TRANSIT" }] };
  const { db } = tx({
    user: { findUnique: async ({ where }) => ({ id: where.id, status: "ACTIVE", role: "HUB_OPERATOR", emailVerifiedAt: now, phone: null, phoneVerifiedAt: null }) },
    custodyHandover: { findUnique: async () => handover, update: async ({ where, data }) => ({ id: where.id, ...handover, ...data }) },
    deliveryLeg: {
      findUnique: async () => partnerLeg,
      updateMany: async ({ where, data }) => { calls.legUpdates.push({ where, data }); return { count: 1 }; },
      findFirst: async () => null,
    },
    hubPoint: { findUnique: async () => ({ id: "hub-2", status: "ACTIVE" }) },
    hubPointOperator: { findUnique: async () => ({ hubPointId: "hub-2", userId: "hub-user-1", isActive: true }) },
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" }) },
    transportPartnerMember: { findUnique: async () => ({ partnerId: "partner-1", userId: "partner-user-1", isActive: true }) },
    partnerDeliveryAssignment: {
      findFirst: async () => ({ id: "partner-assignment-1", partnerId: "partner-1", agreementId: "agreement-1", deliveryLegId: "leg-1", status: "IN_TRANSIT", agreedTransportChargeMinor: 450000n, currency: "NGN" }),
      updateMany: async ({ where, data }) => { calls.assignmentUpdates.push({ where, data }); return { count: 1 }; },
    },
    partnerPayable: {
      upsert: async ({ where, create }) => { calls.payables.push({ where, create }); return { id: "payable-1", amountMinor: create.amountMinor, currency: create.currency }; },
    },
    operationalAuditEvent: { create: async ({ data }) => { calls.audits.push(data); return data; } },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.confirmHandover({
    handoverId: handover.id, userId: "hub-user-1", conditionAtReceipt: "Sealed and intact", weightGrams: 450,
  });
  assert.equal(result.handover.status, "CONFIRMED");
  assert.equal(calls.assignmentUpdates[0].data.status, "COMPLETED");
  assert.equal(calls.legUpdates[0].data.status, "COMPLETED");
  assert.equal(calls.payables[0].create.sourceChargeMinor, 450000n);
  assert.equal(calls.payables[0].create.amountMinor, 450000n);
  assert.equal(calls.audits.some(item => item.action === "PARTNER_EXECUTION_COMPLETED_AND_PAYABLE_CREATED"), true);
});


test("admin can record an off-platform verified recipient phone with an audit trail", async () => {
  const calls = { audits: [], updates: [] };
  const { db } = tx({
    user: {
      findUnique: async ({ where }) => ({ id: where.id, status: "ACTIVE", role: "CUSTOMER", emailVerifiedAt: now, phone: "08000000000", phoneVerifiedAt: null }),
      update: async ({ where, data }) => { calls.updates.push({ where, data }); return { id: where.id, ...data }; },
    },
    operationalAuditEvent: { create: async ({ data }) => { calls.audits.push(data); return data; } },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.setRecipientPhoneVerification({
    userId: "recipient-1", verified: true, verificationMethod: "CALLBACK",
    reason: "Recipient number confirmed by an outbound verification call.",
    actorUserId: "admin-1",
  });
  assert.equal(result.user.phoneVerifiedAt, now);
  assert.equal(calls.updates[0].data.phoneVerifiedAt, now);
  assert.equal(calls.audits[0].action, "USER_PHONE_VERIFIED_BY_ADMIN");
});

test("admin cannot verify a user without a phone number", async () => {
  const { db } = tx({
    user: { findUnique: async ({ where }) => ({ id: where.id, status: "ACTIVE", role: "CUSTOMER", emailVerifiedAt: now, phone: null, phoneVerifiedAt: null }) },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.setRecipientPhoneVerification({
    userId: "recipient-1", verified: true, verificationMethod: "CALLBACK",
    reason: "Attempted phone verification.",
    actorUserId: "admin-1",
  });
  assert.equal(result.blocker, "USER_PHONE_REQUIRED");
});
