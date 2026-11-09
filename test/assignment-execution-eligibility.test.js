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
    parcelBooking: { id: "booking_1", senderId: "sender_1", status: "DELIVERY_VERIFICATION_PENDING" },
  });
  const events = [];
  let assignmentStatus;
  let bookingStatus;
  const tx = {
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
