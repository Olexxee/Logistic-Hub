import test from "node:test";
import assert from "node:assert/strict";
import { createResendEmailService } from "../src/shared/email/resend-email.service.js";

test("Resend service sends a validated request and returns provider id", async () => {
  let request;
  const service = createResendEmailService({
    apiKey: "test_key",
    from: "Logistic Hub <noreply@example.com>",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, status: 200, json: async () => ({ id: "email_123" }) };
    },
  });

  const result = await service.send({
    to: "customer@example.com",
    subject: "Verify your email",
    html: "<p>Verify your email</p>",
    idempotencyKey: "verification-token-123",
  });

  assert.deepEqual(result, { id: "email_123", accepted: true });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test_key");
  assert.equal(request.options.headers["Idempotency-Key"], "verification-token-123");
  assert.deepEqual(JSON.parse(request.options.body).to, ["customer@example.com"]);
});

test("Resend service rejects sends when provider configuration is missing", async () => {
  const service = createResendEmailService();
  await assert.rejects(
    service.send({ to: "customer@example.com", subject: "Hello", text: "Hello" }),
    (error) => error.code === "EMAIL_NOT_CONFIGURED",
  );
});

test("Resend provider failures are sanitized", async () => {
  const service = createResendEmailService({
    apiKey: "test_key",
    from: "noreply@example.com",
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: "private provider response" }),
    }),
  });

  await assert.rejects(
    service.send({ to: "customer@example.com", subject: "Hello", text: "Hello" }),
    (error) => error.code === "EMAIL_DELIVERY_FAILED"
      && error.status === 422
      && !error.message.includes("private provider response"),
  );
});

test("Resend service does not leak provider credentials in network errors", async () => {
  const service = createResendEmailService({
    apiKey: "test_key",
    from: "noreply@example.com",
    fetchImpl: async () => { throw new Error("Bearer test_key connection failed"); },
  });

  await assert.rejects(
    service.send({ to: "customer@example.com", subject: "Hello", text: "Hello" }),
    (error) => error.code === "EMAIL_PROVIDER_UNAVAILABLE"
      && !error.message.includes("test_key"),
  );
});
