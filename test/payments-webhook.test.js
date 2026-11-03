import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createPaymentsService } from "../src/modules/payments/payments.service.js";

const secretKey = "test-paystack-secret";

function makeService({ repository = {}, fetchImpl = async () => ({ ok: true, json: async () => ({ status: true, data: { status: "success", amount: 4300, currency: "NGN", channel: "card" } }) }) } = {}) {
  return createPaymentsService({
    prismaClient: {},
    repository,
    notifications: { createAndDeliver: async () => ({ emailStatus: "NOT_REQUESTED" }) },
    secretKey,
    enabled: true,
    fetchImpl,
  });
}

test("Paystack webhook verifies the exact raw body and verifies the transaction before settlement", async () => {
  let received;
  let verifyUrl;
  const repository = {
    async settle(input) { received = input; return { replay: false, status: "settled", reference: input.reference }; },
  };
  const fetchImpl = async (url, options) => {
    verifyUrl = url;
    assert.equal(options.headers.Authorization, "Bearer " + secretKey);
    return { ok: true, json: async () => ({ status: true, data: { status: "success", amount: 4300, currency: "NGN", channel: "card" } }) };
  };
  const service = makeService({ repository, fetchImpl });
  const payload = { event: "charge.success", data: { status: "success", reference: "LH-REF-1", id: 12345 } };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const result = await service.handleWebhook({ rawBody, signature, payload });
  assert.equal(result.status, "settled");
  assert.equal(verifyUrl, "https://api.paystack.co/transaction/verify/LH-REF-1");
  assert.equal(received.reference, "LH-REF-1");
  assert.equal(received.amountMinor, 4300);
  assert.equal(received.providerFeeMinor, undefined);
  assert.equal(received.currency, "NGN");
});

test("Paystack webhook rejects invalid signatures before provider verification", async () => {
  let called = false;
  const service = makeService({ fetchImpl: async () => { called = true; throw new Error("must not be called"); } });
  const rawBody = Buffer.from(JSON.stringify({ event: "charge.success", data: {} }));
  await assert.rejects(
    () => service.handleWebhook({ rawBody, signature: "0".repeat(128), payload: { event: "charge.success", data: {} } }),
    { code: "INVALID_WEBHOOK_SIGNATURE", statusCode: 401 },
  );
  assert.equal(called, false);
});

test("refund webhook can be processed while new payment collection remains disabled", async () => {
  let received;
  const service = createPaymentsService({
    prismaClient: {},
    repository: {
      updateRefundFromWebhook: async input => { received = input; return { count: 1 }; },
    },
    notifications: { createAndDeliver: async () => ({}) },
    secretKey,
    enabled: false,
    refundsEnabled: true,
  });
  const payload = { event: "refund.processed", data: { refund_reference: "87654" } };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const result = await service.handleWebhook({ payload, rawBody, signature });
  assert.equal(result.updatedCount, 1);
  assert.equal(received.providerReference, "87654");
  assert.equal(received.status, "PROCESSED");
});

test("refund webhook remains disabled unless REFUNDS_ENABLED is explicitly enabled", async () => {
  const service = createPaymentsService({
    prismaClient: {},
    repository: { updateRefundFromWebhook: async () => { throw new Error("must not be called"); } },
    notifications: { createAndDeliver: async () => ({}) },
    secretKey,
    enabled: false,
    refundsEnabled: false,
  });
  const payload = { event: "refund.processed", data: { id: 87654 } };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  await assert.rejects(
    () => service.handleWebhook({ payload, rawBody, signature }),
    error => error.code === "REFUNDS_DISABLED" && error.statusCode === 503,
  );
});
