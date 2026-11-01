import test from "node:test";
import assert from "node:assert/strict";
import { createFinanceService } from "../src/modules/finance/finance.service.js";

function fixture({ cancellation = false } = {}) {
  const refund = {
    id: "refund-1",
    publicReference: "REF-TEST",
    paymentAttemptId: "payment-1",
    parcelBookingId: cancellation ? "parcel-1" : null,
    rideBookingId: null,
    amountMinor: 4300n,
    currency: "NGN",
    reason: "Parcel arrived damaged",
    status: "PENDING_REVIEW",
    requestedByUserId: "customer-1",
    reviewedByUserId: null,
    providerReference: null,
    idempotencyKey: cancellation ? "cancel-refund-1234567890ABCDEF" : "customer-refund-12345678",
    providerResponse: null,
    paymentAttempt: { id: "payment-1", status: "SUCCEEDED", providerReference: "PAY-REF-1", amountMinor: 4300n },
  };
  const booking = { id: "parcel-1", status: "CANCELLATION_PENDING", cancellationReason: "Customer requested cancellation" };
  const priorEvent = { fromStatus: "IN_TRANSIT" };
  const calls = { audits: [], bookingEvents: [], providerCalls: 0 };
  const tx = {
    refundRequest: {
      findUnique: async () => refund,
      updateMany: async ({ data }) => { Object.assign(refund, data); return { count: 1 }; },
      update: async ({ data }) => { Object.assign(refund, data); return refund; },
    },
    operationalAuditEvent: { create: async ({ data }) => { calls.audits.push(data); return data; } },
    parcelBooking: {
      findUnique: async () => booking,
      update: async ({ data }) => { Object.assign(booking, data); return booking; },
    },
    bookingEvent: {
      findFirst: async () => priorEvent,
      create: async ({ data }) => { calls.bookingEvents.push(data); return data; },
    },
  };
  const prismaClient = {
    refundRequest: { findUnique: async () => refund },
    $transaction: async callback => callback(tx),
  };
  return { refund, booking, calls, prismaClient };
}

test("refund approval remains disabled until REFUNDS_ENABLED is explicitly enabled", async () => {
  const { refund, calls, prismaClient } = fixture();
  const service = createFinanceService({
    prismaClient, secretKey: "paystack-test-secret", refundsEnabled: false,
    fetchImpl: async () => { calls.providerCalls += 1; },
  });
  await assert.rejects(
    () => service.reviewRefund({ id: refund.id, user: { id: "admin-1", role: "ADMIN" }, decision: "APPROVE", reviewNote: "Reviewed and approved" }),
    error => error.code === "REFUNDS_DISABLED" && error.statusCode === 503,
  );
  assert.equal(refund.status, "PENDING_REVIEW");
  assert.equal(calls.providerCalls, 0);
});

test("admin rejection restores a paid cancellation to its prior booking state and audits it", async () => {
  const { refund, booking, calls, prismaClient } = fixture({ cancellation: true });
  const service = createFinanceService({ prismaClient, refundsEnabled: false });
  const result = await service.reviewRefund({
    id: refund.id, user: { id: "admin-1", role: "ADMIN" },
    decision: "REJECT", reviewNote: "Cancellation is not eligible under policy",
  });
  assert.equal(result.status, "REJECTED");
  assert.equal(booking.status, "IN_TRANSIT");
  assert.equal(booking.cancellationReason, null);
  assert.equal(calls.bookingEvents.length, 1);
  assert.equal(calls.bookingEvents[0].eventType, "CANCELLATION_REJECTED");
  assert.equal(calls.bookingEvents[0].fromStatus, "CANCELLATION_PENDING");
  assert.equal(calls.bookingEvents[0].toStatus, "IN_TRANSIT");
  assert.ok(calls.audits.some(event => event.action === "REFUND_REQUEST_REJECTED"));
});

test("only admins can approve or reject a refund request", async () => {
  const { refund, prismaClient } = fixture();
  const service = createFinanceService({ prismaClient, refundsEnabled: false });
  await assert.rejects(
    () => service.reviewRefund({ id: refund.id, user: { id: "support-1", role: "SUPPORT" }, decision: "REJECT", reviewNote: "Not eligible for refund" }),
    error => error.code === "FORBIDDEN",
  );
});

test("approved refund is submitted to Paystack and the provider refund identifier is stored", async () => {
  const { refund, calls, prismaClient } = fixture();
  const service = createFinanceService({
    prismaClient, secretKey: "paystack-test-secret", refundsEnabled: true,
    fetchImpl: async (url, options) => {
      calls.providerCalls += 1;
      assert.equal(url, "https://api.paystack.co/refund");
      assert.equal(options.headers.Authorization, "Bearer paystack-test-secret");
      const body = JSON.parse(options.body);
      assert.equal(body.transaction, "PAY-REF-1");
      assert.equal(body.amount, 4300);
      return { ok: true, json: async () => ({ status: true, data: { id: 87654, status: "pending", amount: 4300, currency: "NGN" } }) };
    },
  });
  const result = await service.reviewRefund({
    id: refund.id, user: { id: "admin-1", role: "ADMIN" },
    decision: "APPROVE", reviewNote: "Refund approved after evidence review",
  });
  assert.equal(calls.providerCalls, 1);
  assert.equal(refund.status, "PROCESSING");
  assert.equal(refund.providerReference, "87654");
  assert.equal(result.providerReference, "87654");
  assert.equal(result.amountMinor, "4300");
});

test("ambiguous provider network failure leaves refund locked for reconciliation", async () => {
  const { refund, prismaClient } = fixture();
  const service = createFinanceService({
    prismaClient, secretKey: "paystack-test-secret", refundsEnabled: true,
    fetchImpl: async () => { throw new Error("socket timeout"); },
  });
  await assert.rejects(
    () => service.reviewRefund({
      id: refund.id, user: { id: "admin-1", role: "ADMIN" },
      decision: "APPROVE", reviewNote: "Refund approved after review",
    }),
    error => error.code === "REFUND_SUBMISSION_OUTCOME_UNKNOWN",
  );
  assert.equal(refund.status, "PROCESSING");
  assert.equal(refund.providerResponse.submissionOutcome, "UNKNOWN");
  await assert.rejects(
    () => service.reviewRefund({
      id: refund.id, user: { id: "admin-1", role: "ADMIN" },
      decision: "APPROVE", reviewNote: "Do not submit twice",
    }),
    error => error.code === "REFUND_STATE_CONFLICT",
  );
});
