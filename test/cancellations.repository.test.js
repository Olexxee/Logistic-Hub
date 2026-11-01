import test from "node:test";
import assert from "node:assert/strict";
import { createCancellationsRepository } from "../src/modules/cancellations/cancellations.repository.js";

function fixture({ status = "MATCHING", paymentStatus = "INITIALIZED", ownerId = "customer-1", assignments = [] } = {}) {
  const booking = {
    id: "booking-1",
    senderId: ownerId,
    passengerId: ownerId,
    status,
    paymentStatus,
    publicReference: "LH-PCL-TEST01",
  };
  const calls = {
    bookingUpdates: [],
    offerUpdates: [],
    assignmentReads: 0,
    assignmentUpdates: [],
    driverUpdates: [],
    supportTickets: [],
    bookingEvents: [],
    refundRequests: [],
    refundAudits: [],
  };
  const tx = {
    parcelBooking: {
      findFirst: async ({ where }) => where.id === booking.id && where.senderId === ownerId ? booking : null,
      update: async ({ data }) => { calls.bookingUpdates.push(data); Object.assign(booking, data); return booking; },
    },
    rideBooking: {
      findFirst: async ({ where }) => where.id === booking.id && where.passengerId === ownerId ? booking : null,
      update: async ({ data }) => { calls.bookingUpdates.push(data); Object.assign(booking, data); return booking; },
    },
    driverOffer: {
      updateMany: async (args) => { calls.offerUpdates.push(args); return { count: 1 }; },
    },
    driverAssignment: {
      findMany: async () => { calls.assignmentReads += 1; return assignments; },
      update: async ({ where, data }) => { calls.assignmentUpdates.push({ where, data }); },
    },
    driverProfile: {
      update: async ({ where, data }) => { calls.driverUpdates.push({ where, data }); },
    },
    supportTicket: {
      create: async ({ data }) => { calls.supportTickets.push(data); return data; },
    },
    paymentAttempt: {
      findFirst: async () => paymentStatus === "SUCCEEDED" ? { id: "payment-1", providerReference: "PAY-REF-1", amountMinor: 5000n, currency: "NGN" } : null,
    },
    refundRequest: {
      aggregate: async () => ({ _sum: { amountMinor: 0n } }),
      create: async ({ data }) => { calls.refundRequests.push(data); return { id: "refund-1", ...data }; },
    },
    operationalAuditEvent: {
      create: async ({ data }) => { calls.refundAudits.push(data); return data; },
    },
    bookingEvent: {
      create: async ({ data }) => { calls.bookingEvents.push(data); return data; },
    },
  };
  const prismaClient = { $transaction: async (callback) => callback(tx) };
  return { booking, calls, repository: createCancellationsRepository(prismaClient) };
}

test("unpaid parcel cancellation cancels booking, withdraws offers and releases assigned drivers", async () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const { calls, repository } = fixture({
    status: "MATCHING",
    paymentStatus: "INITIALIZED",
    assignments: [{ id: "assignment-1", driverProfileId: "driver-profile-1" }],
  });

  const result = await repository.cancel({
    bookingType: "PARCEL",
    bookingId: "booking-1",
    userId: "customer-1",
    reason: "I entered the wrong destination",
    now,
  });

  assert.equal(result.status, "CANCELLED");
  assert.equal(result.refundReviewRequired, false);
  assert.equal(result.supportTicketReference, null);
  assert.equal(calls.bookingUpdates[0].status, "CANCELLED");
  assert.equal(calls.bookingUpdates[0].cancelledAt, now);
  assert.equal(calls.bookingUpdates[0].cancellationReason, "I entered the wrong destination");
  assert.equal(calls.offerUpdates.length, 1);
  assert.deepEqual(calls.offerUpdates[0].data, { status: "WITHDRAWN", respondedAt: now });
  assert.equal(calls.assignmentReads, 1);
  assert.equal(calls.assignmentUpdates.length, 1);
  assert.equal(calls.assignmentUpdates[0].data.status, "CANCELLED");
  assert.deepEqual(calls.driverUpdates[0], {
    where: { id: "driver-profile-1" },
    data: { isAvailable: true },
  });
  assert.equal(calls.supportTickets.length, 0);
  assert.equal(calls.bookingEvents[0].eventType, "BOOKING_CANCELLED");
  assert.equal(calls.bookingEvents[0].toStatus, "CANCELLED");
});

test("paid cancellation enters review and creates a support ticket without issuing a refund", async () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const { calls, repository } = fixture({
    status: "IN_TRANSIT",
    paymentStatus: "SUCCEEDED",
  });

  const result = await repository.cancel({
    bookingType: "PARCEL",
    bookingId: "booking-1",
    userId: "customer-1",
    reason: "The recipient is no longer available",
    now,
  });

  assert.equal(result.status, "CANCELLATION_PENDING");
  assert.equal(result.refundReviewRequired, true);
  assert.equal(result.supportTicketReference, "SUP-CANCEL-LH-PCL-TEST01");
  assert.ok(result.refundRequestReference);
  assert.equal(calls.refundRequests.length, 1);
  assert.equal(calls.refundRequests[0].status, "PENDING_REVIEW");
  assert.equal(calls.refundRequests[0].providerResponse.source, "CANCELLATION");
  assert.equal(calls.refundRequests[0].amountMinor, 5000n);
  assert.equal(calls.refundAudits[0].action, "CANCELLATION_REFUND_REQUESTED");
  assert.equal(calls.bookingUpdates[0].status, "CANCELLATION_PENDING");
  assert.equal(calls.bookingUpdates[0].cancelledAt, undefined);
  assert.equal(calls.offerUpdates.length, 0);
  assert.equal(calls.assignmentReads, 0);
  assert.equal(calls.supportTickets.length, 1);
  assert.equal(calls.supportTickets[0].category, "REFUND");
  assert.equal(calls.supportTickets[0].priority, "HIGH");
  assert.match(calls.supportTickets[0].description, /No provider refund has been issued/i);
  assert.equal(calls.bookingEvents[0].eventType, "CANCELLATION_REVIEW_REQUESTED");
  assert.equal(calls.bookingEvents[0].toStatus, "CANCELLATION_PENDING");
});

test("terminal bookings are returned as conflicts without side effects", async () => {
  const { calls, repository } = fixture({ status: "COMPLETED", paymentStatus: "SUCCEEDED" });

  const result = await repository.cancel({
    bookingType: "PARCEL",
    bookingId: "booking-1",
    userId: "customer-1",
    reason: "Please cancel this completed delivery",
    now: new Date("2026-10-30T12:00:00.000Z"),
  });

  assert.deepEqual(result, { conflict: true, status: "COMPLETED" });
  assert.equal(calls.bookingUpdates.length, 0);
  assert.equal(calls.supportTickets.length, 0);
  assert.equal(calls.bookingEvents.length, 0);
});

test("booking ownership is enforced before cancellation", async () => {
  const { calls, repository } = fixture({ ownerId: "different-customer" });

  const result = await repository.cancel({
    bookingType: "PARCEL",
    bookingId: "booking-1",
    userId: "customer-1",
    reason: "I no longer need this delivery",
    now: new Date("2026-10-30T12:00:00.000Z"),
  });

  assert.equal(result, null);
  assert.equal(calls.bookingUpdates.length, 0);
  assert.equal(calls.bookingEvents.length, 0);
});

test("a second cancellation request is rejected while the first is awaiting review", async () => {
  const { calls, repository } = fixture({
    status: "CANCELLATION_PENDING",
    paymentStatus: "SUCCEEDED",
  });
  const result = await repository.cancel({
    bookingType: "PARCEL",
    bookingId: "booking-1",
    userId: "customer-1",
    reason: "Please cancel this booking again",
    now: new Date("2026-10-30T12:00:00.000Z"),
  });
  assert.deepEqual(result, { conflict: true, status: "CANCELLATION_PENDING" });
  assert.equal(calls.bookingUpdates.length, 0);
  assert.equal(calls.refundRequests.length, 0);
  assert.equal(calls.supportTickets.length, 0);
});
