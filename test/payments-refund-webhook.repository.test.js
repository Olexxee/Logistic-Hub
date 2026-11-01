import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentsRepository } from "../src/modules/payments/payments.repository.js";

function fixture({ refundedTotal = 4300n, bookingStatus = "CANCELLATION_PENDING" } = {}) {
  const refund = {
    id: "refund-1", publicReference: "RF-CANCEL-TEST", providerReference: "87654",
    paymentAttemptId: "payment-1", parcelBookingId: "parcel-1", rideBookingId: null,
    amountMinor: 4300n, currency: "NGN", status: "PROCESSING",
    paymentAttempt: {
      id: "payment-1", amountMinor: 4300n, platformAllocationMinor: 500n,
      parcelBookingId: "parcel-1", rideBookingId: null, status: "SUCCEEDED",
    },
  };
  const booking = { id: "parcel-1", status: bookingStatus, paymentStatus: "SUCCEEDED" };
  const calls = { audits: [], bookingEvents: [], paymentAttemptUpdates: [], bookingUpdates: [] };
  const tx = {
    refundRequest: {
      findUnique: async () => refund,
      updateMany: async ({ data }) => {
        if (refund.status !== "PROCESSING") return { count: 0 };
        Object.assign(refund, data);
        return { count: 1 };
      },
      aggregate: async () => ({ _sum: { amountMinor: refundedTotal } }),
    },
    operationalAuditEvent: { create: async ({ data }) => { calls.audits.push(data); return data; } },
    paymentAttempt: { update: async ({ data }) => { calls.paymentAttemptUpdates.push(data); Object.assign(refund.paymentAttempt, data); } },
    parcelBooking: {
      findUnique: async () => ({ ...booking }),
      update: async ({ data }) => { calls.bookingUpdates.push(data); Object.assign(booking, data); return booking; },
    },
    bookingEvent: { create: async ({ data }) => { calls.bookingEvents.push(data); return data; } },
    ledgerEntry: { findFirst: async () => ({ id: "already-posted" }) },
  };
  const prismaClient = { $transaction: async callback => callback(tx) };
  return { refund, booking, calls, repository: createPaymentsRepository(prismaClient) };
}

test("provider-confirmed full refund reverses payment and finalizes a pending cancellation", async () => {
  const { refund, booking, calls, repository } = fixture();
  const result = await repository.updateRefundFromWebhook({
    providerReference: "87654",
    status: "PROCESSED",
    providerResponse: { event: "refund.processed", id: "87654" },
  });
  assert.deepEqual(result, { count: 1 });
  assert.equal(refund.status, "PROCESSED");
  assert.equal(refund.paymentAttempt.status, "REVERSED");
  assert.equal(booking.paymentStatus, "REVERSED");
  assert.equal(booking.status, "CANCELLED");
  assert.equal(calls.paymentAttemptUpdates.length, 1);
  assert.equal(calls.bookingUpdates[0].status, "CANCELLED");
  assert.equal(calls.bookingEvents[0].eventType, "CANCELLATION_APPROVED");
  assert.equal(calls.audits[0].action, "REFUND_PROVIDER_CONFIRMED");

  const replay = await repository.updateRefundFromWebhook({
    providerReference: "87654",
    status: "PROCESSED",
    providerResponse: { event: "refund.processed", id: "87654" },
  });
  assert.deepEqual(replay, { count: 0 });
  assert.equal(calls.bookingEvents.length, 1);
});

test("partial refund does not reverse the payment or cancel the booking", async () => {
  const { refund, booking, calls, repository } = fixture({ refundedTotal: 2000n });
  const result = await repository.updateRefundFromWebhook({
    providerReference: "87654",
    status: "PROCESSED",
    providerResponse: { event: "refund.processed", id: "87654" },
  });
  assert.deepEqual(result, { count: 1 });
  assert.equal(refund.status, "PROCESSED");
  assert.equal(refund.paymentAttempt.status, "SUCCEEDED");
  assert.equal(booking.paymentStatus, "SUCCEEDED");
  assert.equal(booking.status, "CANCELLATION_PENDING");
  assert.equal(calls.paymentAttemptUpdates.length, 0);
  assert.equal(calls.bookingUpdates.length, 0);
  assert.equal(calls.bookingEvents.length, 0);
});
