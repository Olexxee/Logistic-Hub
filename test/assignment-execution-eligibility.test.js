import test from "node:test";
import assert from "node:assert/strict";
import { createAssignmentsRepository } from "../src/modules/assignments/assignments.repository.js";

const now = new Date("2026-11-09T10:00:00.000Z");
const baseAssignment = (overrides = {}) => ({
  id: "assignment_1",
  parcelBookingId: "booking_1",
  rideBookingId: null,
  deliveryLegId: null,
  driverProfileId: "driver_profile_1",
  vehicleId: "vehicle_1",
  status: "ACCEPTED",
  agreedFareMinor: 2500n,
  currency: "NGN",
  driverProfile: {
    id: "driver_profile_1",
    userId: "driver_user_1",
    verificationStatus: "VERIFIED",
    kycTier: "FULL",
    suspendedAt: null,
  },
  parcelBooking: {
    id: "booking_1",
    senderId: "sender_1",
    pickupServiceZoneId: "zone_origin",
    destinationServiceZoneId: "zone_destination",
    status: "PICKUP_VERIFICATION_PENDING",
  },
  rideBooking: null,
  deliveryLeg: null,
  ...overrides,
});

test("pickup arrival is blocked when current driver capability or identity eligibility has changed", async () => {
  let profileQuery;
  let vehicleQuery;
  let assignmentWrites = 0;
  const assignment = baseAssignment();
  const tx = {
    serviceZone: { findMany: async () => [{ id: "zone_origin" }, { id: "zone_destination" }] },
    driverAssignment: {
      findUnique: async () => assignment,
      updateMany: async () => { assignmentWrites += 1; return { count: 1 }; },
    },
    driverProfile: {
      findFirst: async args => { profileQuery = args.where; return null; },
    },
    vehicle: {
      findFirst: async args => { vehicleQuery = args.where; return { id: "vehicle_1" }; },
    },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "ARRIVED_AT_PICKUP",
    now,
  });

  assert.equal(result.ineligible.code, "DRIVER_EXECUTION_ELIGIBILITY_CHANGED");
  assert.equal(assignmentWrites, 0);
  assert.equal(profileQuery.id, assignment.driverProfileId);
  assert.equal(profileQuery.suspendedAt, null);
  assert.deepEqual(profileQuery.capabilities.some, {
    capability: "LOCAL_DISPATCH",
    status: "APPROVED",
  });
  assert.equal(vehicleQuery, undefined);
});

test("pickup arrival is blocked when the exact assigned vehicle loses its approved suitability", async () => {
  const assignment = baseAssignment();
  let vehicleWhere;
  const tx = {
    serviceZone: { findMany: async () => [{ id: "zone_origin" }, { id: "zone_destination" }] },
    driverAssignment: {
      findUnique: async () => assignment,
      updateMany: async () => ({ count: 1 }),
    },
    driverProfile: { findFirst: async () => ({ id: "driver_profile_1" }) },
    vehicle: { findFirst: async args => { vehicleWhere = args.where; return null; } },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "ARRIVED_AT_PICKUP",
    now,
  });

  assert.equal(result.ineligible.code, "VEHICLE_EXECUTION_ELIGIBILITY_CHANGED");
  assert.equal(vehicleWhere.id, assignment.vehicleId);
  assert.equal(vehicleWhere.driverProfileId, assignment.driverProfileId);
  assert.equal(vehicleWhere.isActive, true);
  assert.equal(vehicleWhere.verificationStatus, "VERIFIED");
  assert.deepEqual(vehicleWhere.serviceCapabilities.some, {
    capability: "LOCAL_DISPATCH",
    status: "APPROVED",
  });
});

test("execution eligibility is evaluated against active service zones before pickup", async () => {
  const assignment = baseAssignment();
  let profileReads = 0;
  const tx = {
    serviceZone: { findMany: async () => [{ id: "zone_origin" }] },
    driverAssignment: { findUnique: async () => assignment },
    driverProfile: { findFirst: async () => { profileReads += 1; return null; } },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "ARRIVED_AT_PICKUP",
    now,
  });

  assert.equal(result.ineligible.code, "SERVICE_ZONE_UNAVAILABLE");
  assert.equal(profileReads, 0);
});

test("same-zone parcel assignments remain valid when their single zone is active", async () => {
  const assignment = baseAssignment({
    parcelBooking: {
      id: "booking_1",
      senderId: "sender_1",
      pickupServiceZoneId: "zone_same",
      destinationServiceZoneId: "zone_same",
      status: "PICKUP_VERIFICATION_PENDING",
    },
  });
  const tx = {
    serviceZone: { findMany: async args => {
      assert.deepEqual(args.where.id.in, ["zone_same"]);
      return [{ id: "zone_same" }];
    } },
    driverAssignment: { findUnique: async () => assignment },
    driverProfile: { findFirst: async () => null },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "ARRIVED_AT_PICKUP",
    now,
  });

  assert.equal(result.ineligible.code, "DRIVER_EXECUTION_ELIGIBILITY_CHANGED");
});

test("partner-only delivery legs cannot enter local-driver pickup execution", async () => {
  const assignment = baseAssignment({
    deliveryLeg: { id: "leg_1", type: "HUB_TRANSFER" },
  });
  let profileReads = 0;
  const tx = {
    driverAssignment: {
      findUnique: async () => assignment,
      updateMany: async () => ({ count: 1 }),
    },
    driverProfile: { findFirst: async () => { profileReads += 1; return null; } },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "ARRIVED_AT_PICKUP",
    now,
  });

  assert.equal(result.ineligible.code, "LEG_REQUIRES_PARTNER_EXECUTION");
  assert.equal(profileReads, 0);
});

test("post-pickup parcel progression is not blocked by later driver suspension", async () => {
  const assignment = baseAssignment({
    status: "PICKUP_CONFIRMED",
    driverProfile: {
      id: "driver_profile_1",
      userId: "driver_user_1",
      verificationStatus: "VERIFIED",
      kycTier: "FULL",
      suspendedAt: new Date("2026-11-09T09:59:00.000Z"),
    },
  });
  let profileEligibilityReads = 0;
  let updatedStatus;
  const tx = {
    driverAssignment: {
      findUnique: async () => assignment,
      updateMany: async args => {
        updatedStatus = args.data.status;
        return { count: 1 };
      },
    },
    driverProfile: {
      findFirst: async () => { profileEligibilityReads += 1; return null; },
    },
    parcelBooking: { update: async () => ({}) },
    bookingEvent: { create: async () => ({}) },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "IN_PROGRESS",
    now,
  });

  assert.equal(result.status, "IN_PROGRESS");
  assert.equal(updatedStatus, "IN_PROGRESS");
  assert.equal(profileEligibilityReads, 0);
});

test("pickup verification refuses custody transfer when parcel execution eligibility is no longer valid", async () => {
  const assignment = baseAssignment({ status: "ARRIVED_AT_PICKUP" });
  let tokenReads = 0;
  let tokenWrites = 0;
  const tx = {
    serviceZone: { findMany: async () => [{ id: "zone_origin" }, { id: "zone_destination" }] },
    driverAssignment: { findUnique: async () => assignment },
    driverProfile: { findFirst: async () => null },
    vehicle: { findFirst: async () => ({ id: "vehicle_1" }) },
    verificationToken: {
      findFirst: async () => { tokenReads += 1; return { id: "token_1", failedAttempts: 0, tokenHash: "valid_hash" }; },
      updateMany: async () => { tokenWrites += 1; return { count: 1 }; },
    },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.verifyCode({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    action: "PICKUP",
    tokenHash: "valid_hash",
    now,
  });

  assert.equal(result.ineligible.code, "DRIVER_EXECUTION_ELIGIBILITY_CHANGED");
  assert.equal(tokenReads, 0);
  assert.equal(tokenWrites, 0);
});

test("serializable assignment checks retry PostgreSQL serialization conflicts", async () => {
  const assignment = baseAssignment({
    deliveryLeg: { id: "leg_1", type: "HUB_TRANSFER" },
  });
  let attempts = 0;
  let transactionOptions;
  const tx = {
    driverAssignment: { findUnique: async () => assignment },
  };
  const client = {
    $transaction: async (callback, options) => {
      attempts += 1;
      transactionOptions = options;
      if (attempts === 1) throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
      return callback(tx);
    },
  };
  const repository = createAssignmentsRepository(client);

  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "ARRIVED_AT_PICKUP",
    now,
  });

  assert.equal(attempts, 2);
  assert.equal(transactionOptions.isolationLevel, "Serializable");
  assert.equal(result.ineligible.code, "LEG_REQUIRES_PARTNER_EXECUTION");
});

test("delivery verification completes existing parcel custody and records an eligibility exception", async () => {
  const assignment = baseAssignment({
    status: "ARRIVED_AT_DESTINATION",
    driverProfile: {
      id: "driver_profile_1",
      userId: "driver_user_1",
      verificationStatus: "VERIFIED",
      kycTier: "FULL",
      suspendedAt: new Date("2026-11-09T09:59:00.000Z"),
    },
    parcelBooking: { id: "booking_1", senderId: "sender_1", pickupServiceZoneId: "zone_origin", destinationServiceZoneId: "zone_destination", status: "DELIVERY_VERIFICATION_PENDING" },
  });
  const events = [];
  let assignmentStatus;
  let bookingStatus;
  const tx = {
    serviceZone: { findMany: async () => [{ id: "zone_origin" }, { id: "zone_destination" }] },
    driverAssignment: {
      findUnique: async () => assignment,
      update: async (_args) => { assignmentStatus = "COMPLETED"; return {}; },
    },
    driverProfile: {
      findFirst: async () => null,
      update: async () => ({}),
    },
    vehicle: { findFirst: async () => null },
    verificationToken: {
      findFirst: async () => ({ id: "token_1", failedAttempts: 0, tokenHash: "valid_hash" }),
      updateMany: async () => ({ count: 1 }),
    },
    parcelBooking: {
      update: async args => { bookingStatus = args.data.status; return {}; },
    },
    bookingEvent: {
      create: async args => { events.push(args.data); return {}; },
    },
    driverPayout: { upsert: async () => ({}) },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.verifyCode({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    action: "DELIVERY",
    tokenHash: "valid_hash",
    now,
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(assignmentStatus, "COMPLETED");
  assert.equal(bookingStatus, "COMPLETED");
  assert.equal(events.some(event => event.eventType === "IN_CUSTODY_ELIGIBILITY_EXCEPTION_COMPLETED"), true);
  const exception = events.find(event => event.eventType === "IN_CUSTODY_ELIGIBILITY_EXCEPTION_COMPLETED");
  assert.equal(exception.metadata.policy, "ALLOW_EXISTING_CUSTODY_COMPLETION");
  assert.equal(exception.metadata.reasonCode, "DRIVER_EXECUTION_ELIGIBILITY_CHANGED");
});


test("Admin safety hold blocks driver assignment transitions before any lifecycle mutation", async () => {
  const assignment = baseAssignment({
    executionHoldAt: new Date("2026-11-09T09:59:00.000Z"),
    executionHoldReason: "Incident review",
  });
  let writes = 0;
  const tx = {
    driverAssignment: {
      findUnique: async () => assignment,
      updateMany: async () => { writes += 1; return { count: 1 }; },
    },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "IN_PROGRESS",
    now,
  });

  assert.equal(result.held, true);
  assert.equal(result.holdAt.toISOString(), assignment.executionHoldAt.toISOString());
  assert.equal(writes, 0);
});

test("Admin safety hold blocks pickup and delivery verification before reading or consuming codes", async () => {
  for (const action of ["PICKUP", "DELIVERY"]) {
    const assignment = baseAssignment({
      status: action === "PICKUP" ? "ARRIVED_AT_PICKUP" : "ARRIVED_AT_DESTINATION",
      executionHoldAt: new Date("2026-11-09T09:59:00.000Z"),
    });
    let tokenReads = 0;
    let tokenWrites = 0;
    const tx = {
      driverAssignment: { findUnique: async () => assignment },
      verificationToken: {
        findFirst: async () => { tokenReads += 1; return { id: "token_1", failedAttempts: 0, tokenHash: "valid_hash" }; },
        updateMany: async () => { tokenWrites += 1; return { count: 1 }; },
      },
    };
    const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

    const result = await repository.verifyCode({
      assignmentId: assignment.id,
      driverUserId: "driver_user_1",
      action,
      tokenHash: "valid_hash",
      now,
    });

    assert.equal(result.held, true);
    assert.equal(tokenReads, 0);
    assert.equal(tokenWrites, 0);
  }
});

test("verification code issuance is blocked while assignment is on safety hold", async () => {
  const assignment = baseAssignment({
    status: "ARRIVED_AT_PICKUP",
    executionHoldAt: new Date("2026-11-09T09:59:00.000Z"),
  });
  let tokenWrites = 0;
  const tx = {
    $queryRaw: async () => [],
    driverAssignment: { findUnique: async () => assignment },
    verificationToken: {
      updateMany: async () => { tokenWrites += 1; return { count: 1 }; },
      create: async () => { tokenWrites += 1; return {}; },
    },
  };
  const repository = createAssignmentsRepository({ $transaction: callback => callback(tx) });

  const result = await repository.issueCode({
    assignment,
    action: "PICKUP",
    tokenHash: "hash",
    expiresAt: new Date(now.getTime() + 60000),
    now,
  });

  assert.equal(result.held, true);
  assert.equal(tokenWrites, 0);
});
