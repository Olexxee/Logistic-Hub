import test from "node:test";
import assert from "node:assert/strict";
import {
  createDriverAssignmentExpiryWorker,
  DRIVER_ASSIGNMENT_PAYMENT_EXPIRY_REASON,
} from "../src/shared/jobs/driver-assignment-expiry.service.js";

const now = new Date("2026-11-04T12:00:00.000Z");
const expiredAt = new Date(now.getTime() - 1_000);

function createHarness({
  assignment = {},
  paymentAttempt = null,
  assignmentUpdateCount = 1,
  legUpdateCount = 1,
  bookingUpdateCount = 1,
} = {}) {
  const calls = [];
  const defaultAssignment = {
    id: "assignment_1",
    parcelBookingId: "parcel_1",
    rideBookingId: null,
    deliveryLegId: "leg_1",
    driverProfileId: "driver_1",
    status: "AWAITING_PAYMENT",
    paymentExpiresAt: expiredAt,
    parcelBooking: {
      id: "parcel_1", publicReference: "LH-PCL-1",
      status: "AWAITING_PAYMENT", paymentStatus: "INITIALIZED",
    },
    rideBooking: null,
    deliveryLeg: { id: "leg_1", status: "AWAITING_PAYMENT" },
    ...assignment,
  };
  const tx = {
    $queryRaw: async () => [],
    driverAssignment: {
      findUnique: async () => defaultAssignment,
      updateMany: async (input) => { calls.push(["assignment.updateMany", input]); return { count: assignmentUpdateCount }; },
    },
    paymentAttempt: {
      findFirst: async (input) => { calls.push(["paymentAttempt.findFirst", input]); return paymentAttempt; },
    },
    deliveryLeg: {
      updateMany: async (input) => { calls.push(["deliveryLeg.updateMany", input]); return { count: legUpdateCount }; },
    },
    deliveryLegOffer: {
      updateMany: async (input) => { calls.push(["deliveryLegOffer.updateMany", input]); return { count: 1 }; },
    },
    driverOffer: {
      updateMany: async (input) => { calls.push(["driverOffer.updateMany", input]); return { count: 1 }; },
    },
    parcelBooking: {
      updateMany: async (input) => { calls.push(["parcelBooking.updateMany", input]); return { count: bookingUpdateCount }; },
    },
    rideBooking: {
      updateMany: async (input) => { calls.push(["rideBooking.updateMany", input]); return { count: bookingUpdateCount }; },
    },
    driverProfile: {
      updateMany: async (input) => { calls.push(["driverProfile.updateMany", input]); return { count: 1 }; },
    },
    bookingEvent: {
      create: async (input) => { calls.push(["bookingEvent.create", input]); return input; },
    },
  };
  const prismaClient = {
    driverAssignment: {
      findMany: async (input) => { calls.push(["assignment.findMany", input]); return [{ id: defaultAssignment.id }]; },
    },
    $transaction: async (callback) => callback(tx),
  };
  return { calls, worker: createDriverAssignmentExpiryWorker({ prismaClient, clock: () => now }) };
}

test("expired unpaid parcel reservation releases its leg, offer and eligible driver", async () => {
  const { worker, calls } = createHarness();
  const result = await worker.runOnce();
  assert.deepEqual(result, { scanned: 1, expired: 1 });
  assert.equal(calls.find(([name]) => name === "assignment.updateMany")[1].data.status, "FAILED");
  assert.equal(calls.find(([name]) => name === "assignment.updateMany")[1].data.failureReason, DRIVER_ASSIGNMENT_PAYMENT_EXPIRY_REASON);
  assert.equal(calls.find(([name]) => name === "deliveryLeg.updateMany")[1].data.status, "READY_FOR_ASSIGNMENT");
  assert.equal(calls.find(([name]) => name === "deliveryLegOffer.updateMany")[1].data.status, "EXPIRED");
  assert.equal(calls.find(([name]) => name === "driverProfile.updateMany")[1].data.isAvailable, true);
  assert.equal(calls.find(([name]) => name === "bookingEvent.create")[1].data.eventType, "ASSIGNMENT_PAYMENT_WINDOW_EXPIRED");
});

test("reservation expiry does not release a booking with a successful payment", async () => {
  const { worker, calls } = createHarness({
    assignment: { parcelBooking: {
      id: "parcel_1", publicReference: "LH-PCL-1",
      status: "AWAITING_PAYMENT", paymentStatus: "SUCCEEDED",
    } },
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { scanned: 1, expired: 0 });
  assert.equal(calls.some(([name]) => name === "assignment.updateMany"), false);
});

test("reservation expiry defers when a payment attempt exists and may still settle", async () => {
  const { worker, calls } = createHarness({ paymentAttempt: { id: "payment_attempt_1" } });
  const result = await worker.runOnce();
  assert.deepEqual(result, { scanned: 1, expired: 0 });
  assert.equal(calls.some(([name]) => name === "assignment.updateMany"), false);
});

test("expired ride reservation returns the ride to matching and expires the accepted offer", async () => {
  const { worker, calls } = createHarness({
    assignment: {
      parcelBookingId: null, rideBookingId: "ride_1", deliveryLegId: null,
      parcelBooking: null, deliveryLeg: null,
      rideBooking: {
        id: "ride_1", publicReference: "LH-RIDE-1",
        status: "AWAITING_PAYMENT", paymentStatus: "FAILED",
      },
    },
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { scanned: 1, expired: 1 });
  const rideUpdate = calls.find(([name]) => name === "rideBooking.updateMany")[1];
  assert.equal(rideUpdate.data.status, "MATCHING");
  assert.equal(rideUpdate.data.driverFareMinor, null);
  assert.equal(calls.find(([name]) => name === "driverOffer.updateMany")[1].data.status, "EXPIRED");
});

test("concurrent expiry worker loses the conditional assignment update without releasing related records", async () => {
  const { worker, calls } = createHarness({ assignmentUpdateCount: 0 });
  const result = await worker.runOnce();
  assert.deepEqual(result, { scanned: 1, expired: 0 });
  assert.equal(calls.some(([name]) => name === "deliveryLeg.updateMany"), false);
  assert.equal(calls.some(([name]) => name === "bookingEvent.create"), false);
});

test("expired parcel booking cannot be reset when its delivery leg changed concurrently", async () => {
  const { worker, calls } = createHarness({ legUpdateCount: 0 });
  await assert.rejects(worker.runOnce(), { code: "DELIVERY_LEG_RELEASE_CONFLICT" });
  assert.equal(calls.some(([name]) => name === "bookingEvent.create"), false);
});


test("payment attempt creation locks and rechecks the active assignment before creating a charge attempt", async () => {
  const { createPaymentsRepository } = await import("../src/modules/payments/payments.repository.js");
  const calls = [];
  const assignment = { id: "assignment_1", status: "AWAITING_PAYMENT", paymentExpiresAt: new Date(Date.now() + 60_000) };
  const attempt = { id: "attempt_1", idempotencyKey: "payment-key-0001" };
  const tx = {
    $queryRaw: async (...args) => { calls.push(["lock", args]); return []; },
    driverAssignment: {
      findFirst: async (input) => { calls.push(["findReservation", input]); return { id: assignment.id }; },
      findUnique: async (input) => { calls.push(["recheckReservation", input]); return assignment; },
    },
    paymentAttempt: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => { calls.push(["createAttempt", data]); return attempt; },
    },
  };
  const repository = createPaymentsRepository({ $transaction: async callback => callback(tx) });
  const result = await repository.createAttempt({
    parcelBookingId: "parcel_1",
    provider: "PAYSTACK",
    idempotencyKey: "payment-key-0001",
    status: "INITIALIZED",
    amountMinor: 1000n,
    currency: "NGN",
  });

  assert.equal(result.id, "attempt_1");
  assert.deepEqual(calls.map(([name]) => name), ["findReservation", "lock", "recheckReservation", "createAttempt"]);
});

test("payment attempt creation rejects a reservation that expired while waiting for its row lock", async () => {
  const { createPaymentsRepository } = await import("../src/modules/payments/payments.repository.js");
  const tx = {
    $queryRaw: async () => [],
    driverAssignment: {
      findFirst: async () => ({ id: "assignment_1" }),
      findUnique: async () => ({ status: "FAILED", paymentExpiresAt: new Date(Date.now() - 1_000) }),
    },
    paymentAttempt: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async () => { throw new Error("Must not create a payment attempt."); },
    },
  };
  const repository = createPaymentsRepository({ $transaction: async callback => callback(tx) });

  await assert.rejects(
    repository.createAttempt({
      parcelBookingId: "parcel_1",
      provider: "PAYSTACK",
      idempotencyKey: "payment-key-0002",
      status: "INITIALIZED",
      amountMinor: 1000n,
      currency: "NGN",
    }),
    { code: "ASSIGNMENT_RESERVATION_EXPIRED", statusCode: 409 },
  );
});
