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
