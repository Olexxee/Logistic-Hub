import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createPaymentsService } from "../src/modules/payments/payments.service.js";

const secretKey = "test-paystack-secret";
const actor = { id: "customer-1", role: "CUSTOMER" };

function serviceWith(repository, options = {}) {
  return createPaymentsService({
    prismaClient: {},
    repository,
    notifications: { createAndDeliver: async () => ({ emailStatus: "NOT_REQUESTED" }) },
    secretKey,
    enabled: false,
    refundsEnabled: false,
    ...options,
  });
}

test("refund request maps booking type, requires ownership repository validation and returns minor units as a string", async () => {
  let received;
  const refund = {
    id: "refund-1", publicReference: "RF-TEST", amountMinor: 4300n,
    currency: "NGN", status: "PENDING_REVIEW",
  };
  const service = serviceWith({
    createRefundRequest: async input => { received = input; return { refund, replay: false }; },
  });
  const result = await service.createRefundRequest({
    bookingType: "PARCEL_DELIVERY", bookingId: "parcel-1", reason: "Parcel was damaged",
    user: actor, idempotencyKey: "refund-key-0001",
  });
  assert.equal(received.bookingType, "PARCEL");
  assert.equal(received.bookingId, "parcel-1");
  assert.equal(received.userId, actor.id);
  assert.equal(received.idempotencyKey, "refund-key-0001");
  assert.equal(result.amountMinor, "4300");
  assert.equal(result.replay, false);
});

test("refund request rejects missing idempotency keys", async () => {
  const service = serviceWith({});
  await assert.rejects(
    () => service.createRefundRequest({
      bookingType: "PASSENGER_RIDE", bookingId: "ride-1", reason: "Trip was cancelled",
      user: actor, idempotencyKey: "bad",
    }),
    error => error.code === "IDEMPOTENCY_KEY_REQUIRED",
  );
});

test("refund processing remains disabled by default and does not call the provider", async () => {
  let prepared = false;
  let providerCalled = false;
  const service = serviceWith({
    prepareRefundProcessing: async () => { prepared = true; },
  }, { fetchImpl: async () => { providerCalled = true; } });
  await assert.rejects(
    () => service.processRefund({ refundId: "refund-1", actor: { id: "admin-1", role: "ADMIN" } }),
    error => error.code === "REFUNDS_DISABLED" && error.statusCode === 503,
  );
  assert.equal(prepared, false);
  assert.equal(providerCalled, false);
});

test("admin refund processing submits a pending refund once and stores the provider refund ID", async () => {
  let providerCalls = 0;
  let saved;
  const refund = {
    id: "refund-1", publicReference: "RF-TEST", amountMinor: 4300n, currency: "NGN",
    reason: "Parcel was damaged", status: "PROCESSING",
    paymentAttempt: { providerReference: "PAY-REF-1", status: "SUCCEEDED" },
  };
  const repository = {
    prepareRefundProcessing: async () => ({ refund, replay: false }),
    saveRefundProviderResult: async input => { saved = input; return { ...refund, providerReference: input.providerReference, providerResponse: input.providerResponse }; },
  };
  const service = serviceWith(repository, {
    refundsEnabled: true,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      assert.equal(url, "https://api.paystack.co/refund");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer " + secretKey);
      const body = JSON.parse(options.body);
      assert.equal(body.transaction, "PAY-REF-1");
      assert.equal(body.amount, 4300);
      return { ok: true, json: async () => ({ status: true, message: "Refund queued", data: { id: 98765, status: "pending", amount: 4300, currency: "NGN" } }) };
    },
  });
  const result = await service.processRefund({ refundId: "refund-1", actor: { id: "admin-1", role: "ADMIN" } });
  assert.equal(providerCalls, 1);
  assert.equal(saved.providerReference, "98765");
  assert.equal(saved.actorUserId, "admin-1");
  assert.equal(result.providerReference, "98765");
  assert.equal(result.amountMinor, "4300");
});

test("refund processing does not resubmit a request already linked to a provider refund", async () => {
  let providerCalls = 0;
  const refund = { id: "refund-1", publicReference: "RF-TEST", amountMinor: 4300n, status: "PROCESSING", providerReference: "98765" };
  const service = serviceWith({
    prepareRefundProcessing: async () => ({ refund, replay: true }),
  }, { refundsEnabled: true, fetchImpl: async () => { providerCalls += 1; } });
  const result = await service.processRefund({ refundId: "refund-1", actor: { id: "admin-1", role: "ADMIN" } });
  assert.equal(result.replay, true);
  assert.equal(providerCalls, 0);
});

test("uncertain provider submission remains locked for manual reconciliation", async () => {
  let markedUnknown = false;
  const refund = { id: "refund-1", amountMinor: 4300n, paymentAttempt: { providerReference: "PAY-REF-1", status: "SUCCEEDED" } };
  const service = serviceWith({
    prepareRefundProcessing: async () => ({ refund, replay: false }),
    markRefundSubmissionUnknown: async () => { markedUnknown = true; },
  }, { refundsEnabled: true, fetchImpl: async () => { throw new Error("socket timeout"); } });
  await assert.rejects(
    () => service.processRefund({ refundId: "refund-1", actor: { id: "admin-1", role: "ADMIN" } }),
    error => error.code === "REFUND_SUBMISSION_OUTCOME_UNKNOWN",
  );
  assert.equal(markedUnknown, true);
});

test("refund webhooks can be verified independently of new payment initialization", async () => {
  let received;
  const repository = {
    updateRefundFromWebhook: async input => { received = input; return { count: 1 }; },
  };
  const service = serviceWith(repository, { refundsEnabled: true, enabled: false });
  const payload = { event: "refund.processed", data: { id: 98765, reference: "PAY-REF-1" } };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const result = await service.handleWebhook({ payload, rawBody, signature });
  assert.deepEqual(received, {
    providerReference: "98765", status: "PROCESSED",
    providerResponse: { event: "refund.processed", id: "98765" },
  });
  assert.equal(result.updatedCount, 1);
});
