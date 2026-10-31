import test from "node:test";
import assert from "node:assert/strict";
import { encryptJobPayload } from "../src/shared/jobs/outbox-crypto.js";
import { createOutboxWorker } from "../src/shared/jobs/outbox-worker.service.js";

const key = Buffer.alloc(32, 5).toString("base64");

test("worker sends an encrypted email job and marks it successful", async () => {
  const payload = { to: "customer@example.com", subject: "Hello", text: "World", notificationId: "notification_1" };
  const calls = { sent: [], jobUpdates: [], notificationUpdates: [] };
  const prismaClient = {
    $queryRaw: async () => [{
      id: "job_1", topic: "email.send", encryptedPayload: encryptJobPayload(payload, key),
      idempotencyKey: "email-1", attempts: 1,
    }],
    outboxJob: { updateMany: async (input) => { calls.jobUpdates.push(input); return { count: 1 }; } },
    notification: { updateMany: async (input) => { calls.notificationUpdates.push(input); return { count: 1 }; } },
  };
  const worker = createOutboxWorker({
    prismaClient,
    email: { send: async (input) => { calls.sent.push(input); return { id: "resend_1" }; } },
    workerId: "worker_1",
  });
  const result = await worker.runOnce();
  assert.equal(result[0].status, "SUCCEEDED");
  assert.equal(calls.sent[0].idempotencyKey, "email-1");
  assert.equal(calls.notificationUpdates[0].data.emailStatus, "SENT");
  assert.equal(calls.jobUpdates[0].data.status, "SUCCEEDED");
});

test("worker retries provider failures and does not expose email payloads in logs", async () => {
  const payload = { to: "customer@example.com", subject: "Hello", text: "private body" };
  const logged = [];
  const prismaClient = {
    $queryRaw: async () => [{
      id: "job_2", topic: "email.send", encryptedPayload: encryptJobPayload(payload, key),
      idempotencyKey: "email-2", attempts: 1,
    }],
    outboxJob: { updateMany: async (input) => { logged.push(input); return { count: 1 }; } },
    notification: { updateMany: async () => ({ count: 1 }) },
  };
  const worker = createOutboxWorker({
    prismaClient,
    email: { send: async () => { const error = new Error("provider down"); error.code = "EMAIL_PROVIDER_UNAVAILABLE"; throw error; } },
    logger: { error: (entry) => logged.push(entry) },
    workerId: "worker_2",
  });
  const result = await worker.runOnce();
  assert.equal(result[0].status, "PENDING");
  assert.equal(logged.some((entry) => JSON.stringify(entry).includes("private body")), false);
  assert.equal(logged.find((entry) => entry.data)?.data.status, "PENDING");
});
