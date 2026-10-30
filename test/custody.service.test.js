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
    deliveryLeg: { findUnique: async () => leg },
    driverProfile: { findUnique: async () => ({ id: "driver-1", userId: "driver-user-1", verificationStatus: "VERIFIED" }), findMany: async () => [] },
    hubPoint: { findUnique: async () => ({ id: "hub-1", status: "ACTIVE" }) },
    hubPointOperator: { findUnique: async () => null, findMany: async () => [], findFirst: async () => null, upsert: async ({ data }) => ({ id: "hub-operator-1", ...data }), update: async () => ({}), count: async () => 0 },
    transportPartner: { findUnique: async () => null },
    transportPartnerMember: { findUnique: async () => null, findMany: async () => [] },
    custodyHandover: {
      findFirst: async () => null,
      findUnique: async () => null,
      create: async ({ data }) => { const value = { id: "handover-1", ...data }; calls.handovers.push(value); return value; },
      update: async ({ where, data }) => ({ id: where.id, status: data.status, ...data }),
    },
    operationalCase: { create: async ({ data }) => { const value = { id: "case-1", ...data }; calls.cases.push(value); return value; } },
    operationalAuditEvent: { create: async ({ data }) => { calls.audits.push(data); return data; } },
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
    driverProfile: { findUnique: async () => ({ id: "driver-1", userId: "someone-else" }), findMany: async () => [] },
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
