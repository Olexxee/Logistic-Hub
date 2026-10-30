import test from "node:test";
import assert from "node:assert/strict";
import { createAssignmentsRepository } from "../src/modules/assignments/assignments.repository.js";
import { createParcelBookingsService } from "../src/modules/parcels/parcel-bookings.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");

test("delivery leg timeline is visible only to the booking sender and authorized operators", async () => {
  const legs = [{
    id: "leg_1",
    sequence: 1,
    type: "DIRECT",
    status: "ASSIGNED",
    originServiceZone: { id: "zone_ikeja", name: "Ikeja" },
    destinationServiceZone: { id: "zone_surulere", name: "Surulere" },
    plannedAt: now,
    assignedAt: now,
    startedAt: null,
    completedAt: null,
    failureReason: null,
    assignments: [{ id: "assignment_1", status: "ACCEPTED", acceptedAt: now, pickupAt: null, startedAt: null, completedAt: null }],
    createdAt: now,
    updatedAt: now,
  }];
  const repository = {
    findById: async () => ({ id: "booking_1", senderId: "sender_1" }),
    findDeliveryLegsByBookingId: async () => legs,
  };
  const service = createParcelBookingsService({ repository });
  const result = await service.listVisibleDeliveryLegs({
    bookingId: "booking_1",
    user: { id: "sender_1", role: "CUSTOMER" },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "DIRECT");
  assert.equal(result[0].origin.name, "Ikeja");
  assert.equal(result[0].destination.name, "Surulere");
  assert.equal(result[0].assignment.status, "ACCEPTED");
  await assert.rejects(
    service.listVisibleDeliveryLegs({ bookingId: "booking_1", user: { id: "other_user", role: "CUSTOMER" } }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("driver arrival moves the linked delivery leg to pickup verification pending", async () => {
  const legUpdates = [];
  const assignment = {
    id: "assignment_1",
    deliveryLegId: "leg_1",
    parcelBookingId: "booking_1",
    rideBookingId: null,
    driverProfileId: "driver_profile_1",
    driverProfile: { userId: "driver_user_1" },
    parcelBooking: { id: "booking_1", status: "DRIVER_ASSIGNED" },
    rideBooking: null,
    status: "ACCEPTED",
  };
  const tx = {
    driverAssignment: {
      findUnique: async () => assignment,
      update: async ({ data }) => ({ id: assignment.id, status: data.status, updatedAt: now }),
    },
    deliveryLeg: { update: async ({ where, data }) => { legUpdates.push({ where, data }); return {}; } },
    parcelBooking: { update: async () => ({}) },
    bookingEvent: { create: async () => ({}) },
  };
  const repository = createAssignmentsRepository({ $transaction: (callback) => callback(tx) });
  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_1",
    nextStatus: "ARRIVED_AT_PICKUP",
    now,
  });
  assert.equal(result.status, "ARRIVED_AT_PICKUP");
  assert.deepEqual(legUpdates[0], {
    where: { id: "leg_1" },
    data: { status: "PICKUP_VERIFICATION_PENDING" },
  });
});

test("pickup verification records parcel pickup separately from transit start", async () => {
  const legUpdates = [];
  const assignment = {
    id: "assignment_pickup",
    deliveryLegId: "leg_pickup",
    parcelBookingId: "booking_pickup",
    rideBookingId: null,
    driverProfileId: "driver_profile_pickup",
    driverProfile: { userId: "driver_user_pickup" },
    parcelBooking: { id: "booking_pickup", senderId: "sender_pickup", publicReference: "LH-PCL-PICKUP" },
    rideBooking: null,
    status: "ARRIVED_AT_PICKUP",
    agreedFareMinor: 1500n,
    currency: "NGN",
  };
  const tx = {
    driverAssignment: { findUnique: async () => assignment, update: async () => ({}) },
    verificationToken: { findFirst: async () => ({ id: "pickup_token" }), updateMany: async () => ({ count: 1 }) },
    deliveryLeg: { update: async ({ where, data }) => { legUpdates.push({ where, data }); return {}; } },
    parcelBooking: { update: async () => ({}) },
    bookingEvent: { create: async () => ({}) },
  };
  const repository = createAssignmentsRepository({ $transaction: (callback) => callback(tx) });
  const result = await repository.verifyCode({
    assignmentId: assignment.id,
    driverUserId: "driver_user_pickup",
    action: "PICKUP",
    tokenHash: "pickup-hash",
    now,
  });
  assert.equal(result.status, "PICKUP_CONFIRMED");
  assert.deepEqual(legUpdates[0], {
    where: { id: "leg_pickup" },
    data: { status: "IN_TRANSIT", pickedUpAt: now },
  });
});

test("starting the trip records the delivery leg transit start timestamp", async () => {
  const legUpdates = [];
  const assignment = {
    id: "assignment_start",
    deliveryLegId: "leg_start",
    parcelBookingId: "booking_start",
    rideBookingId: null,
    driverProfileId: "driver_profile_start",
    driverProfile: { userId: "driver_user_start" },
    parcelBooking: { id: "booking_start", status: "PICKED_UP" },
    rideBooking: null,
    status: "PICKUP_CONFIRMED",
  };
  const tx = {
    driverAssignment: {
      findUnique: async () => assignment,
      update: async ({ data }) => ({ id: assignment.id, status: data.status, updatedAt: now }),
    },
    deliveryLeg: { update: async ({ where, data }) => { legUpdates.push({ where, data }); return {}; } },
    parcelBooking: { update: async () => ({}) },
    bookingEvent: { create: async () => ({}) },
  };
  const repository = createAssignmentsRepository({ $transaction: (callback) => callback(tx) });
  const result = await repository.transition({
    assignmentId: assignment.id,
    driverUserId: "driver_user_start",
    nextStatus: "IN_PROGRESS",
    now,
  });
  assert.equal(result.status, "IN_PROGRESS");
  assert.deepEqual(legUpdates[0], {
    where: { id: "leg_start" },
    data: { status: "IN_TRANSIT", startedAt: now },
  });
});

test("verified recipient handover completes the linked delivery leg in the same transaction", async () => {
  const legUpdates = [];
  let tokenQuery;
  const assignment = {
    id: "assignment_2",
    deliveryLegId: "leg_2",
    parcelBookingId: "booking_2",
    rideBookingId: null,
    driverProfileId: "driver_profile_2",
    driverProfile: { userId: "driver_user_2" },
    parcelBooking: { id: "booking_2", senderId: "sender_2", publicReference: "LH-PCL-2" },
    rideBooking: null,
    status: "ARRIVED_AT_DESTINATION",
    agreedFareMinor: 2500n,
    currency: "NGN",
  };
  const tx = {
    driverAssignment: {
      findUnique: async () => assignment,
      update: async () => ({}),
    },
    verificationToken: {
      findFirst: async (query) => { tokenQuery = query; return { id: "token_1" }; },
      updateMany: async () => ({ count: 1 }),
    },
    deliveryLeg: { update: async ({ where, data }) => { legUpdates.push({ where, data }); return {}; } },
    parcelBooking: { update: async () => ({}) },
    bookingEvent: { create: async () => ({}) },
    driverProfile: { update: async () => ({}) },
    driverPayout: { upsert: async () => ({}) },
  };
  const repository = createAssignmentsRepository({ $transaction: (callback) => callback(tx) });
  const result = await repository.verifyCode({
    assignmentId: assignment.id,
    driverUserId: "driver_user_2",
    action: "DELIVERY",
    tokenHash: "sha256-hash",
    now,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(tokenQuery.where.deliveryLegId, "leg_2");
  assert.deepEqual(legUpdates[0], {
    where: { id: "leg_2" },
    data: { status: "COMPLETED", completedAt: now },
  });
});
