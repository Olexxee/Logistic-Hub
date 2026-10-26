import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createPaymentsService } from "../src/modules/payments/payments.service.js";

const secret = "test-paystack-secret";
const config = { PAYMENTS_ENABLED: true, PAYSTACK_SECRET_KEY: secret, PAYSTACK_CALLBACK_URL: "http://localhost:3000/return" };

test("Paystack webhook verifies the exact raw body before processing a successful charge", async () => {
  let received;
  const repository = {
    async processSuccessfulWebhook(input) { received = input; return { duplicate: true, paymentAttemptId: "pa-1" }; },
  };
  const service = createPaymentsService({ repository, config, clock: () => new Date("2026-10-26T00:00:00.000Z") });
  const event = { event: "charge.success", data: { status: "success", reference: "LH-REF-1", amount: 4300, currency: "NGN", fees: 100 } };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha512", secret).update(rawBody).digest("hex");
  const result = await service.handleWebhook({ rawBody, signature, event });
  assert.equal(result.duplicate, true);
  assert.equal(received.reference, "LH-REF-1");
  assert.equal(received.amountMinor, 4300n);
  assert.equal(received.providerFeeMinor, 100n);
});

test("Paystack webhook rejects invalid signatures", async () => {
  const service = createPaymentsService({ repository: {}, config });
  const rawBody = Buffer.from(JSON.stringify({ event: "charge.success", data: {} }));
  await assert.rejects(
    () => service.handleWebhook({ rawBody, signature: "0".repeat(128), event: { event: "charge.success", data: {} } }),
    { code: "UNAUTHORIZED" },
  );
});
