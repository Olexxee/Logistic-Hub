import test from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/modules/custody/custody.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");
const booking = {
  id: "booking-1", senderId: "sender-1", paymentStatus: "SUCCEEDED",
  status: "IN_TRANSIT", recipientName: "Recipient", recipientPhone: "08000000000",
};
const leg = {
  id: "leg-1", parcelBookingId: "booking-1", sequence: 1, type: "LOCAL_PICKUP",
  status: "PICKUP_VERIFICATION_PENDING", originHubPointId: "hub-1",
  destinationHubPointId: "hub-2", parcelBooking: booking,
  assignments: [{
    id: "driver-assignment-1", driverProfileId: "driver-1", status: "ARRIVED_AT_PICKUP",
    driverProfile: { id: "driver-1", userId: "driver-user-1" },
  }],
  partnerAssignments: [],
};
function setup(overrides = {}) {
  const calls = { handovers: [], cases: [], audits: [], assignmentUpdates: [], events: [], locks: [] };
  const db = {
    user: {
      findUnique: async ({ where }) => ({
        id: where.id, status: "ACTIVE", role: "HUB_OPERATOR",
        emailVerifiedAt: now, phone: null, phoneVerifiedAt: null,
      }),
    },
    hubPoint: { findUnique: async ({ where }) => ({ id: where.id, status: "ACTIVE" }) },
    hubPointOperator: {
      findUnique: async () => ({ hubPointId: "hub-1", userId: "hub-user-1", isActive: true }),
      findMany: async () => [{ hubPointId: "hub-1" }],
    },
    deliveryLeg: { findUnique: async () => leg, findMany: async () => [], updateMany: async () => ({ count: 1 }), findFirst: async () => null },
    driverProfile: { findUnique: async () => ({ id: "driver-1", userId: "driver-user-1", verificationStatus: "VERIFIED" }), findMany: async () => [], update: async () => ({}) },
    transportPartner: { findUnique: async () => ({ id: "partner-1", status: "ACTIVE", verificationStatus: "VERIFIED" }) },
    transportPartnerMember: { findUnique: async () => ({ isActive: true }), findMany: async () => [] },
    hubIntakeRecord: { findFirst: async () => ({ id: "hub-intake-1" }), count: async () => 0, aggregate: async () => ({ _sum: { weightGrams: 0, volumeCm3: 0 } }), create: async ({ data }) => ({ id: "hub-intake-1", ...data }), update: async ({ where, data }) => ({ id: where.id, ...data }) },
    custodyHandover: {
      findFirst: async () => null,
      findUnique: async () => null,
      findMany: async () => [],
      create: async ({ data }) => {
        const handover = { id: "handover-1", status: "PENDING_CONFIRMATION", ...data };
        calls.handovers.push(handover);
        return handover;
      },
      update: async ({ where, data }) => ({ id: where.id, status: data.status, ...data }),
    },
    operationalCase: { findFirst: async () => null, create: async ({ data }) => { const item = { id: "case-1", ...data }; calls.cases.push(item); return item; } },
    operationalAuditEvent: { create: async ({ data }) => { calls.audits.push(data); return data; } },
    parcelBooking: { update: async () => ({}) },
    bookingEvent: { create: async ({ data }) => { calls.events.push(data); return data; } },
    driverAssignment: {
      findFirst: async () => ({ id: "driver-assignment-1", status: "ARRIVED_AT_PICKUP", driverProfileId: "driver-1", agreedFareMinor: 25000n, currency: "NGN" }),
      updateMany: async ({ where, data }) => { calls.assignmentUpdates.push({ where, data }); return { count: 1 }; },
    },
    driverPayout: { upsert: async () => ({ id: "payout-1" }) },
    partnerDeliveryAssignment: { findFirst: async () => null, updateMany: async () => ({ count: 1 }) },
    partnerPayable: { upsert: async () => ({ id: "payable-1", amountMinor: 45000n, currency: "NGN" }) },
    $queryRaw: async (strings, ...values) => { calls.locks.push({ sql: strings.join("?"), values }); return []; },
    $transaction: async callback => callback(db),
  };
  Object.assign(db, overrides);
  return { db, calls };
}

test("hub queue is scoped to active memberships and paginates", async () => {
  const { db } = setup({
    custodyHandover: {
      findMany: async args => {
        assert.deepEqual(args.where, {
          toPartyType: "HUB", toPartyId: { in: ["hub-1"] }, status: "PENDING_CONFIRMATION",
        });
        return [{ id: "handover-1" }, { id: "handover-2" }];
      },
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.listHubHandovers({
    userId: "hub-user-1", direction: "incoming", status: "PENDING_CONFIRMATION", limit: 1,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.nextCursor, "handover-1");
});

test("hub operator cannot query another hub's handover queue", async () => {
  const { db } = setup();
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.listHubHandovers({ userId: "hub-user-1", hubPointId: "hub-foreign" }),
    error => error.statusCode === 403,
  );
});

test("hub release requires a driver assignment that has arrived at pickup", async () => {
  const { db, calls } = setup();
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.createHubHandover({
    hubPointId: "hub-1", deliveryLegId: "leg-1", toPartyType: "DRIVER",
    toPartyId: "driver-1", conditionAtRelease: "Parcel sealed and label intact",
  }, "hub-user-1");
  assert.equal(result.handover.fromPartyType, "HUB");
  assert.equal(result.handover.fromPartyId, "hub-1");
  assert.equal(result.handover.toPartyId, "driver-1");
  assert.equal(calls.audits[0].action, "CUSTODY_HANDOVER_INITIATED");
});

test("hub cannot release custody to a driver who has not arrived", async () => {
  const { db } = setup({
    deliveryLeg: { findUnique: async () => ({
      ...leg, assignments: [{ ...leg.assignments[0], status: "ACCEPTED" }],
    }) },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.createHubHandover({
    hubPointId: "hub-1", deliveryLegId: "leg-1", toPartyType: "DRIVER",
    toPartyId: "driver-1", conditionAtRelease: "Parcel sealed",
  }, "hub-user-1");
  assert.equal(result.blocker, "DRIVER_NOT_ARRIVED_AT_HUB");
});

test("repeated active hub exception reports return the existing correlated case", async () => {
  const existing = { id: "case-existing", publicReference: "CASE-EXISTING", type: "DAMAGED_PARCEL", status: "IN_PROGRESS" };
  const { db, calls } = setup({
    operationalCase: {
      findFirst: async ({ where }) => where?.hubPointId
        ? existing
        : null,
      create: async ({ data }) => { const item = { id: "case-new", ...data }; calls.cases.push(item); return item; },
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.reportHubException({
    hubPointId: "hub-1", deliveryLegId: "leg-1", type: "DAMAGED_PARCEL",
    priority: "HIGH", title: "Packaging damaged",
    description: "The outer packaging was torn when the parcel arrived.",
  }, "hub-user-1");
  assert.equal(result.replay, true);
  assert.equal(result.operationalCase.id, "case-existing");
  assert.equal(calls.cases.length, 0);
  assert.equal(calls.audits.length, 0);
});

test("hub exception report is tied to an actively operated hub on the delivery leg", async () => {
  const { db, calls } = setup();
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.reportHubException({
    hubPointId: "hub-1", deliveryLegId: "leg-1", type: "DAMAGED_PARCEL",
    priority: "HIGH", title: "Packaging damaged",
    description: "The outer packaging was torn when the parcel arrived.",
  }, "hub-user-1");
  assert.equal(result.operationalCase.status, "OPEN");
  assert.equal(calls.cases.length, 1);
  assert.equal(calls.cases[0].hubPointId, "hub-1");
  assert.equal(calls.audits[0].action, "HUB_OPERATIONAL_EXCEPTION_REPORTED");
});

test("hub operator cannot report an exception against a hub unrelated to the leg", async () => {
  const { db } = setup({
    deliveryLeg: { findUnique: async () => ({ ...leg, originHubPointId: "hub-3", destinationHubPointId: "hub-4" }) },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.reportHubException({
    hubPointId: "hub-1", deliveryLegId: "leg-1", type: "MISSING_PARCEL",
    title: "Parcel missing", description: "The parcel is not present in the intake area.",
  }, "hub-user-1");
  assert.equal(result.notFound, true);
});


test("hub confirmation moves the receiving driver to pickup-confirmed", async () => {
  const handover = {
    id: "handover-from-hub", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "hub-user-1", fromPartyType: "HUB", fromPartyId: "hub-1",
    toPartyType: "DRIVER", toPartyId: "driver-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
  };
  const { db, calls } = setup({
    custodyHandover: { findUnique: async () => handover, update: async ({ where, data }) => ({ id: where.id, ...handover, ...data }) },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.confirmHandover({ handoverId: handover.id, userId: "driver-user-1", conditionAtReceipt: "Sealed and intact" });
  assert.equal(result.handover.status, "CONFIRMED");
  assert.equal(calls.assignmentUpdates[0].where.status, "ARRIVED_AT_PICKUP");
  assert.equal(calls.assignmentUpdates[0].data.status, "PICKUP_CONFIRMED");
  assert.equal(calls.events[0].eventType, "HUB_PICKUP_CUSTODY_CONFIRMED");
});

test("hub receipt of an arrived driver activates the next planned leg", async () => {
  const handover = {
    id: "handover-to-hub", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "driver-user-1", fromPartyType: "DRIVER", fromPartyId: "driver-1",
    toPartyType: "HUB", toPartyId: "hub-2", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
  };
  const updates = [];
  const { db, calls } = setup({
    custodyHandover: { findUnique: async () => handover, update: async ({ where, data }) => ({ id: where.id, ...handover, ...data }) },
    deliveryLeg: {
      findUnique: async () => ({
        ...leg, status: "DELIVERY_VERIFICATION_PENDING", sequence: 1,
        destinationHubPointId: "hub-2",
        assignments: [{ id: "driver-assignment-1", driverProfileId: "driver-1", status: "ARRIVED_AT_DESTINATION", driverProfile: { id: "driver-1", userId: "driver-user-1" } }],
      }),
      updateMany: async ({ where, data }) => { updates.push({ where, data }); return { count: 1 }; },
      findFirst: async () => ({ id: "leg-2", status: "PLANNED" }),
    },
    hubIntakeRecord: { findFirst: async () => null, count: async () => 0, aggregate: async () => ({ _sum: { weightGrams: 0, volumeCm3: 0 } }), create: async ({ data }) => ({ id: "intake-next-leg", ...data }) },
    driverAssignment: {
      findFirst: async () => ({ id: "driver-assignment-1", status: "ARRIVED_AT_DESTINATION", driverProfileId: "driver-1", agreedFareMinor: 25000n, currency: "NGN" }),
      updateMany: async ({ where, data }) => { calls.assignmentUpdates.push({ where, data }); return { count: 1 }; },
    },
  });
  db.deliveryLeg.updateMany = async ({ where, data }) => { updates.push({ where, data }); return { count: 1 }; };
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.confirmHandover({ handoverId: handover.id, userId: "hub-user-1", conditionAtReceipt: "Sealed and intact", weightGrams: 700 });
  assert.equal(result.handover.status, "CONFIRMED");
  assert.equal(calls.assignmentUpdates[0].data.status, "COMPLETED");
  assert.equal(updates.some(item => item.data.status === "COMPLETED"), true);
  assert.equal(updates.some(item => item.data.status === "READY_FOR_ASSIGNMENT"), true);
  assert.equal(calls.events[0].eventType, "HUB_DESTINATION_CUSTODY_CONFIRMED");
});


test("hub intake rejects a parcel that exceeds configured aggregate weight capacity", async () => {
  const handover = {
    id: "handover-capacity", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "driver-user-1", fromPartyType: "DRIVER", fromPartyId: "driver-1",
    toPartyType: "HUB", toPartyId: "hub-2", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
  };
  const { db, calls } = setup({
    custodyHandover: { findUnique: async () => handover, update: async ({ where, data }) => ({ id: where.id, ...handover, ...data }) },
    hubPoint: { findUnique: async ({ where }) => ({ id: where.id, status: "ACTIVE", acceptedParcelTypes: null, capacityConfig: { maxWeightGrams: 500 } }) },
    deliveryLeg: { findUnique: async () => ({
      ...leg, status: "DELIVERY_VERIFICATION_PENDING", sequence: 1,
      destinationHubPointId: "hub-2",
      assignments: [{ id: "driver-assignment-1", driverProfileId: "driver-1", status: "ARRIVED_AT_DESTINATION", driverProfile: { id: "driver-1", userId: "driver-user-1" } }],
    }) },
    driverAssignment: { findFirst: async () => ({ id: "driver-assignment-1", status: "ARRIVED_AT_DESTINATION", driverProfileId: "driver-1", agreedFareMinor: 25000n, currency: "NGN" }), updateMany: async () => ({ count: 1 }) },
    hubIntakeRecord: {
      findFirst: async () => null,
      count: async () => 1,
      aggregate: async () => ({ _sum: { weightGrams: 400, volumeCm3: 0 } }),
      create: async ({ data }) => { calls.handovers.push(data); return { id: "intake-new", ...data }; },
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.confirmHandover({ handoverId: handover.id, userId: "hub-user-1", conditionAtReceipt: "Parcel intact", weightGrams: 200 }),
    error => error.statusCode === 409 && error.code === "HUB_WEIGHT_CAPACITY_EXCEEDED",
  );
  assert.equal(calls.handovers.length, 0);
});


test("handover creation locks the delivery leg before checking for an existing pending handover", async () => {
  const { db, calls } = setup({
    custodyHandover: {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: "handover-locked", status: "PENDING_CONFIRMATION", ...data }),
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await service.createHubHandover({
    hubPointId: "hub-1", deliveryLegId: "leg-1", toPartyType: "DRIVER",
    toPartyId: "driver-1", conditionAtRelease: "Sealed",
  }, "hub-user-1");
  assert.equal(calls.locks.some(lock => lock.sql.includes('FROM "delivery_legs"') && lock.values.includes("leg-1")), true);
});

test("handover decisions lock and reload the handover before confirming custody", async () => {
  const handover = {
    id: "handover-locked", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "sender-1", fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "HUB", toPartyId: "hub-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
    conditionAtRelease: "Sealed",
  };
  const order = [];
  const { db, calls } = setup({
    $queryRaw: async (strings, ...values) => { order.push("lock"); calls.locks.push({ sql: strings.join("?"), values }); return []; },
    custodyHandover: {
      findUnique: async () => { order.push("read"); return handover; },
      update: async ({ where, data }) => ({ id: where.id, ...handover, ...data }),
    },
    hubPoint: { findUnique: async () => ({ id: "hub-1", status: "ACTIVE", acceptedParcelTypes: [], capacityConfig: {} }) },
    hubIntakeRecord: {
      findFirst: async () => null,
      count: async () => 0,
      aggregate: async () => ({ _sum: { weightGrams: 0, volumeCm3: 0 } }),
      create: async ({ data }) => ({ id: "intake-1", ...data }),
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await service.confirmHandover({
    handoverId: handover.id, userId: "hub-user-1", conditionAtReceipt: "Sealed",
    weightGrams: 200,
  });
  assert.deepEqual(order.slice(0, 2), ["lock", "read"]);
  assert.equal(calls.locks.some(lock => lock.sql.includes('FROM "custody_handovers"') && lock.values.includes(handover.id)), true);
});

test("hub intake requires all dimensions when a partial measurement is submitted", async () => {
  const handover = {
    id: "handover-dimensions", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "sender-1", fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "HUB", toPartyId: "hub-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
    conditionAtRelease: "Sealed",
  };
  const { db, calls } = setup({
    custodyHandover: { findUnique: async () => handover },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.confirmHandover({ handoverId: handover.id, userId: "hub-user-1", weightGrams: 200, lengthMm: 100 }),
    error => error.statusCode === 409 && error.code === "HUB_INTAKE_DIMENSIONS_INCOMPLETE",
  );
  assert.equal(calls.handovers.length, 0);
});


test("hub intake rejects parcels when the active parcel-count capacity is full", async () => {
  const handover = {
    id: "handover-count-capacity", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "sender-1", fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "HUB", toPartyId: "hub-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
    conditionAtRelease: "Sealed",
  };
  const { db, calls } = setup({
    custodyHandover: { findUnique: async () => handover },
    hubPoint: { findUnique: async () => ({ id: "hub-1", status: "ACTIVE", acceptedParcelTypes: [], capacityConfig: { maxParcels: 1 } }) },
    hubIntakeRecord: { findFirst: async () => null, count: async () => 1, aggregate: async () => ({ _sum: { weightGrams: 0, volumeCm3: 0 } }), create: async () => { throw new Error("must not create intake"); } },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.confirmHandover({ handoverId: handover.id, userId: "hub-user-1", weightGrams: 200, conditionAtReceipt: "Sealed" }),
    error => error.statusCode === 409 && error.code === "HUB_PARCEL_CAPACITY_EXCEEDED",
  );
  assert.equal(calls.audits.length, 0);
});

test("hub intake enforces configured aggregate volume capacity", async () => {
  const handover = {
    id: "handover-volume-capacity", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "sender-1", fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "HUB", toPartyId: "hub-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
    conditionAtRelease: "Sealed",
  };
  const { db } = setup({
    custodyHandover: { findUnique: async () => handover },
    hubPoint: { findUnique: async () => ({ id: "hub-1", status: "ACTIVE", acceptedParcelTypes: [], capacityConfig: { maxVolumeCm3: 1000 } }) },
    hubIntakeRecord: { findFirst: async () => null, count: async () => 0, aggregate: async () => ({ _sum: { weightGrams: 0, volumeCm3: 990 } }), create: async () => { throw new Error("must not create intake"); } },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.confirmHandover({
      handoverId: handover.id, userId: "hub-user-1", weightGrams: 200,
      lengthMm: 200, widthMm: 200, heightMm: 1, conditionAtReceipt: "Sealed",
    }),
    error => error.statusCode === 409 && error.code === "HUB_VOLUME_CAPACITY_EXCEEDED",
  );
});

test("hub cannot release a parcel without a received inventory record", async () => {
  const handover = {
    id: "handover-no-intake", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "hub-user-1", fromPartyType: "HUB", fromPartyId: "hub-1",
    toPartyType: "DRIVER", toPartyId: "driver-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
    conditionAtRelease: "Sealed",
  };
  const { db, calls } = setup({
    custodyHandover: { findUnique: async () => handover, update: async ({ where, data }) => ({ id: where.id, ...handover, ...data }) },
    hubIntakeRecord: { findFirst: async () => null },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.confirmHandover({ handoverId: handover.id, userId: "driver-user-1", conditionAtReceipt: "Sealed" }),
    error => error.statusCode === 409 && error.code === "HUB_INTAKE_REQUIRED",
  );
  assert.equal(calls.assignmentUpdates.length, 0);
});


test("hub dispatch release checks active membership before reading parcel state", async () => {
  const { db } = setup({
    hubPointOperator: {
      findUnique: async () => ({ hubPointId: "hub-1", userId: "hub-user-1", isActive: false }),
    },
    deliveryLeg: {
      findUnique: async () => { throw new Error("unauthorized caller must not read delivery leg"); },
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.createHubHandover({
      hubPointId: "hub-1", deliveryLegId: "leg-1", toPartyType: "DRIVER",
      toPartyId: "driver-1", conditionAtRelease: "Sealed",
    }, "hub-user-1"),
    error => error.statusCode === 403,
  );
});


test("hub handover creation revalidates active inventory after acquiring the delivery-leg lock", async () => {
  const { db, calls } = setup({
    hubIntakeRecord: { findFirst: async () => null },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.createHandover({
    parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    fromPartyType: "HUB", fromPartyId: "hub-1",
    toPartyType: "DRIVER", toPartyId: "driver-1",
    conditionAtRelease: "Sealed",
  }, "hub-user-1");
  assert.equal(result.blocker, "HUB_INTAKE_REQUIRED");
  assert.equal(calls.handovers.length, 0);
  assert.equal(calls.locks.some(lock => lock.sql.includes('FROM "delivery_legs"')), true);
});


test("hub intake prevents duplicate active inventory records for the same parcel and hub", async () => {
  const handover = {
    id: "handover-duplicate-intake", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "sender-1", fromPartyType: "SENDER", fromPartyId: "sender-1",
    toPartyType: "HUB", toPartyId: "hub-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
    conditionAtRelease: "Sealed",
  };
  const { db } = setup({
    custodyHandover: { findUnique: async () => handover },
    hubIntakeRecord: {
      findFirst: async () => ({ id: "already-received" }),
      create: async () => { throw new Error("duplicate intake must not be created"); },
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.confirmHandover({ handoverId: handover.id, userId: "hub-user-1", weightGrams: 200, conditionAtReceipt: "Sealed" }),
    error => error.statusCode === 409 && error.code === "HUB_INTAKE_ALREADY_ACTIVE",
  );
});


test("hub cannot release a parcel while a blocking operational case is unresolved", async () => {
  const { db, calls } = setup({
    operationalCase: {
      findFirst: async () => ({ id: "case-damaged-1", type: "DAMAGED_PARCEL", status: "OPEN" }),
    },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  const result = await service.createHandover({
    parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    fromPartyType: "HUB", fromPartyId: "hub-1",
    toPartyType: "DRIVER", toPartyId: "driver-1",
    conditionAtRelease: "Sealed",
  }, "hub-user-1");
  assert.equal(result.blocker, "HUB_OPERATIONAL_CASE_OPEN");
  assert.equal(calls.handovers.length, 0);
});


test("hub cannot confirm an already-created release while a blocking case is unresolved", async () => {
  const handover = {
    id: "handover-blocked-release", parcelBookingId: "booking-1", deliveryLegId: "leg-1",
    initiatedByUserId: "hub-user-1", fromPartyType: "HUB", fromPartyId: "hub-1",
    toPartyType: "DRIVER", toPartyId: "driver-1", status: "PENDING_CONFIRMATION",
    expiresAt: new Date("2026-10-31T12:00:00.000Z"), parcelBooking: booking,
  };
  const { db, calls } = setup({
    custodyHandover: { findUnique: async () => handover, update: async ({ where, data }) => ({ id: where.id, ...handover, ...data }) },
    operationalCase: { findFirst: async () => ({ id: "case-damaged-2", type: "DAMAGED_PARCEL", status: "OPEN" }) },
  });
  const service = createCustodyService({ prismaClient: db, clock: () => now });
  await assert.rejects(
    service.confirmHandover({ handoverId: handover.id, userId: "driver-user-1", conditionAtReceipt: "Packaging damaged" }),
    error => error.statusCode === 409 && error.code === "HUB_OPERATIONAL_CASE_OPEN",
  );
  assert.equal(calls.assignmentUpdates.length, 0);
});
